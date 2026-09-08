// k6 load test — exercises the read path (DataLoader batching + depth limit)
// and the write path (createComment → Kafka/PubSub) under concurrent load,
// plus a "sad path" scenario that deliberately sends requests the API is
// supposed to reject, to confirm it keeps rejecting them cleanly while busy.
//
// Requires k6 (https://k6.io/docs/get-started/installation/) and a running,
// seeded server (`npm run db:setup` first). See ../docs/load-testing.md.
//
// Usage: k6 run loadtest/graphql-load-test.js
//        BASE_URL=http://localhost:4003 k6 run loadtest/graphql-load-test.js
//
// SMOKE_TEST=true shrinks the scenarios to a few seconds each — CI runs this
// after every push (see .github/workflows/ci.yml) purely to catch the script
// itself breaking (a schema change invalidating a query, a JS error), not to
// gate on performance. The full run above is the real benchmark, run
// manually — see docs/load-testing.md.
const SMOKE_TEST = __ENV.SMOKE_TEST === 'true';

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4003';
const LOAD_TEST_USER = __ENV.LOAD_TEST_USER || 'elisa.pereira';
const LOAD_TEST_PASSWORD = __ENV.LOAD_TEST_PASSWORD || 'Senha123';

// Unexpected failures on the happy path — should stay at ~0.
const happyPathErrors = new Rate('happy_path_unexpected_errors');
// The sad-path scenario asserts these are *high* (close to 1): every
// deliberately-bad request should be rejected, not silently succeed.
const unauthenticatedRequestsRejected = new Rate('sad_path_auth_rejected');
const oversizedQueriesRejected = new Rate('sad_path_depth_limit_rejected');
const duplicateCommentsRejected = new Rate('sad_path_duplicate_rejected');

function gql(query, variables, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return http.post(
    `${BASE_URL}/`,
    JSON.stringify({ query, variables }),
    { headers },
  );
}

const hasGraphQLErrors = (res) => {
  const body = res.json();
  return Boolean(body && body.errors && body.errors.length > 0);
};

export const options = {
  scenarios: SMOKE_TEST
    ? {
        happy_path_reads: {
          executor: 'constant-vus',
          exec: 'happyPathReads',
          vus: 1,
          duration: '3s',
        },
        happy_path_writes: {
          executor: 'constant-vus',
          exec: 'happyPathWrites',
          vus: 1,
          duration: '3s',
        },
        sad_path: {
          executor: 'constant-vus',
          exec: 'sadPath',
          vus: 1,
          duration: '3s',
        },
      }
    : {
        happy_path_reads: {
          executor: 'ramping-vus',
          exec: 'happyPathReads',
          startVUs: 0,
          stages: [
            { duration: '10s', target: 20 },
            { duration: '20s', target: 20 },
            { duration: '5s', target: 0 },
          ],
        },
        happy_path_writes: {
          executor: 'constant-vus',
          exec: 'happyPathWrites',
          vus: 5,
          duration: '30s',
          startTime: '5s',
        },
        sad_path: {
          executor: 'constant-vus',
          exec: 'sadPath',
          vus: 3,
          duration: '30s',
          startTime: '5s',
        },
      },
  thresholds: {
    happy_path_unexpected_errors: ['rate<0.02'],
    sad_path_auth_rejected: ['rate>0.99'],
    sad_path_depth_limit_rejected: ['rate>0.99'],
    sad_path_duplicate_rejected: ['rate>0.99'],
    ...(SMOKE_TEST
      ? {}
      : { 'http_req_duration{scenario:happy_path_reads}': ['p(95)<500'] }),
  },
};

export function setup() {
  const loginRes = gql(
    `mutation Login($u: String!, $p: String!) {
      login(data: { userName: $u, password: $p }) { userId token }
    }`,
    { u: LOAD_TEST_USER, p: LOAD_TEST_PASSWORD },
  );
  const token = loginRes.json('data.login.token');
  if (!token) {
    throw new Error(
      `setup() could not log in as "${LOAD_TEST_USER}" — run npm run db:setup first, ` +
        `or set LOAD_TEST_USER/LOAD_TEST_PASSWORD to a seeded user.`,
    );
  }

  const postsRes = gql(
    `query { posts(input: { _limit: 20 }) { id } }`,
    {},
    token,
  );
  const postIds = (postsRes.json('data.posts') || []).map((p) => p.id);
  if (postIds.length === 0) {
    throw new Error('setup() found no posts — run npm run db:setup first.');
  }

  return { token, postIds };
}

const randomPostId = (postIds) =>
  postIds[Math.floor(Math.random() * postIds.length)];

export function happyPathReads(data) {
  const id = randomPostId(data.postIds);
  const res = gql(
    `query GetPost($id: ID!) {
      post(id: $id) { id title comments { id comment } }
    }`,
    { id },
    data.token,
  );

  const ok = check(res, {
    'status is 200': (r) => r.status === 200,
    'no graphql errors': (r) => !hasGraphQLErrors(r),
  });
  happyPathErrors.add(!ok);

  sleep(0.2);
}

export function happyPathWrites(data) {
  const id = randomPostId(data.postIds);
  const uniqueComment = `load test comment vu=${__VU} iter=${__ITER} t=${Date.now()}`;

  const res = gql(
    `mutation Comment($postId: String!, $comment: String!) {
      createComment(data: { postId: $postId, comment: $comment }) { id }
    }`,
    { postId: id, comment: uniqueComment },
    data.token,
  );

  const ok = check(res, {
    'status is 200': (r) => r.status === 200,
    'no graphql errors': (r) => !hasGraphQLErrors(r),
  });
  happyPathErrors.add(!ok);

  sleep(0.5);
}

export function sadPath(data) {
  // 1. A protected field with no Authorization header must be rejected.
  const noAuthRes = gql(`query { users { id } }`);
  unauthenticatedRequestsRejected.add(hasGraphQLErrors(noAuthRes));

  // 2. A query nine levels deep must be rejected — depthLimit(7) in
  // src/index.ts caps it at seven (an 8-level query lands exactly at the
  // limit and is allowed; verified directly against the running server —
  // see docs/load-testing.md).
  const tooDeepQuery = `query TooDeep($id: ID!) {
    post(id: $id) {
      user { posts {
        user { posts {
          user { posts {
            user { id }
          } }
        } }
      } }
    } }
  }`;
  const deepRes = gql(tooDeepQuery, { id: randomPostId(data.postIds) });
  oversizedQueriesRejected.add(
    deepRes.status === 400 || hasGraphQLErrors(deepRes),
  );

  // 3. The exact same comment twice must be rejected the second time —
  // stable across iterations so it reliably collides with itself.
  const dupeComment = `load test duplicate-detection probe (vu=${__VU})`;
  const postId = randomPostId(data.postIds);
  gql(
    `mutation($postId: String!, $comment: String!) {
      createComment(data: { postId: $postId, comment: $comment }) { id }
    }`,
    { postId, comment: dupeComment },
    data.token,
  );
  const secondAttempt = gql(
    `mutation($postId: String!, $comment: String!) {
      createComment(data: { postId: $postId, comment: $comment }) { id }
    }`,
    { postId, comment: dupeComment },
    data.token,
  );
  duplicateCommentsRejected.add(hasGraphQLErrors(secondAttempt));

  sleep(0.5);
}
