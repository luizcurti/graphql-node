// Stress test — 3000 concurrent virtual users for 60 seconds, all starting
// at once (a spike, not a ramp), split across the same three traffic shapes
// as graphql-load-test.js: happy-path reads, happy-path writes, and
// deliberately-bad "sad path" requests. The goal isn't to assert an SLA —
// at this concurrency the default DATABASE_POOL_MAX=10 (see .env.example)
// is the real bottleneck, not the app code — it's to confirm the server
// degrades (queues, slows down) instead of crashing, and that error
// handling that doesn't depend on acquiring a DB connection keeps working
// correctly throughout:
//   - "no Authorization header" is rejected by checkIsLoggedIn() before any
//     datasource call — see src/graphql/schema/login/utils/login-functions.ts
//   - depth-limit rejection happens during GraphQL validation, before the
//     resolver (and therefore before any DB call) even runs
// Both of those should stay fast and correctly rejected even while every
// DB-touching request is queued behind the connection pool. Duplicate-
// comment rejection *does* need a DB write, so it's expected to slow down
// (or occasionally time out) along with the rest of the write path — that's
// the bottleneck being demonstrated, not a bug in this script.
//
// Requires k6 (https://k6.io/docs/get-started/installation/) and a running,
// seeded server (`npm run db:setup` first). Run this manually — it is not
// wired into CI (see loadtest/graphql-load-test.js's SMOKE_TEST for the
// script that is).
//
// Usage: k6 run loadtest/stress-test.js
//        BASE_URL=http://localhost:4003 k6 run loadtest/stress-test.js
//
// STRESS_VUS / STRESS_DURATION override the defaults below (e.g. to shake
// the script out at a smaller scale before committing to a full 3000-VU run).
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4003';
const LOAD_TEST_USER = __ENV.LOAD_TEST_USER || 'elisa.pereira';
const LOAD_TEST_PASSWORD = __ENV.LOAD_TEST_PASSWORD || 'Senha123';

const TOTAL_VUS = Number(__ENV.STRESS_VUS) || 3000;
const DURATION = __ENV.STRESS_DURATION || '60s';
// 40% reads / 40% writes / 20% deliberately-bad requests — writes and reads
// both touch the DB, sad-path mostly doesn't, matching the split described
// above in miniature so the three scenarios still sum to TOTAL_VUS exactly.
const READ_VUS = Math.round(TOTAL_VUS * 0.4);
const WRITE_VUS = Math.round(TOTAL_VUS * 0.4);
const SAD_VUS = TOTAL_VUS - READ_VUS - WRITE_VUS;

// Every HTTP call below passes this instead of k6's 60s default — at 3000
// VUs against a 10-connection pool, a request stuck waiting the full
// default would make the whole run report almost nothing until the very
// end. Failing (or succeeding) within 15s keeps metrics flowing throughout
// the run instead of bunching up at t=60s.
const REQUEST_TIMEOUT = '15s';

const happyPathErrors = new Rate('happy_path_unexpected_errors');
const happyPathTimedOut = new Rate('happy_path_timed_out');
const unauthenticatedRequestsRejected = new Rate('sad_path_auth_rejected');
const oversizedQueriesRejected = new Rate('sad_path_depth_limit_rejected');
const duplicateCommentsRejected = new Rate('sad_path_duplicate_rejected');
const serverStayedUp = new Rate('server_stayed_up');

function gql(query, variables, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return http.post(`${BASE_URL}/`, JSON.stringify({ query, variables }), {
    headers,
    timeout: REQUEST_TIMEOUT,
  });
}

const hasGraphQLErrors = (res) => {
  const body = res.json();
  return Boolean(body && body.errors && body.errors.length > 0);
};

// k6 marks a request status 0 when it never got a response at all (timeout,
// connection refused/reset) — the two things we most want to tell apart at
// this concurrency: "queued and eventually answered" vs "never came back".
const timedOutOrDropped = (res) => res.status === 0;

export const options = {
  scenarios: {
    happy_path_reads: {
      executor: 'constant-vus',
      exec: 'happyPathReads',
      vus: READ_VUS,
      duration: DURATION,
    },
    happy_path_writes: {
      executor: 'constant-vus',
      exec: 'happyPathWrites',
      vus: WRITE_VUS,
      duration: DURATION,
    },
    sad_path: {
      executor: 'constant-vus',
      exec: 'sadPath',
      vus: SAD_VUS,
      duration: DURATION,
    },
    // Not part of the 3000 simulated users — a single steady probe against
    // /health so "did the process crash" and "is it just slow under load"
    // show up as two different, unambiguous metrics instead of one.
    health_probe: {
      executor: 'constant-vus',
      exec: 'healthProbe',
      vus: 1,
      duration: DURATION,
    },
  },
  thresholds: {
    // No hard threshold on happy_path_unexpected_errors: at 3000 VUs
    // against DATABASE_POOL_MAX=10, a meaningful failure/timeout rate on
    // DB-touching requests is the expected finding of this test, not a
    // regression to fail the build over. Reported, not gated.
    sad_path_auth_rejected: ['rate>0.95'],
    sad_path_depth_limit_rejected: ['rate>0.95'],
    server_stayed_up: ['rate>0.99'],
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

  console.log(
    `Stress test: ${TOTAL_VUS} VUs for ${DURATION} ` +
      `(reads=${READ_VUS} writes=${WRITE_VUS} sad=${SAD_VUS})`,
  );

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

  if (timedOutOrDropped(res)) {
    happyPathTimedOut.add(true);
    happyPathErrors.add(true);
  } else {
    happyPathTimedOut.add(false);
    const ok = check(res, {
      'status is 200': (r) => r.status === 200,
      'no graphql errors': (r) => !hasGraphQLErrors(r),
    });
    happyPathErrors.add(!ok);
  }

  sleep(0.2);
}

export function happyPathWrites(data) {
  const id = randomPostId(data.postIds);
  const uniqueComment = `stress test comment vu=${__VU} iter=${__ITER} t=${Date.now()}`;

  const res = gql(
    `mutation Comment($postId: String!, $comment: String!) {
      createComment(data: { postId: $postId, comment: $comment }) { id }
    }`,
    { postId: id, comment: uniqueComment },
    data.token,
  );

  if (timedOutOrDropped(res)) {
    happyPathTimedOut.add(true);
    happyPathErrors.add(true);
  } else {
    happyPathTimedOut.add(false);
    const ok = check(res, {
      'status is 200': (r) => r.status === 200,
      'no graphql errors': (r) => !hasGraphQLErrors(r),
    });
    happyPathErrors.add(!ok);
  }

  sleep(0.5);
}

export function sadPath(data) {
  // 1. No Authorization header at all — rejected by checkIsLoggedIn()
  // before any datasource/DB call, so this should stay correct and fast
  // regardless of how saturated the DB connection pool is.
  const noAuthRes = gql(`query { users { id } }`);
  unauthenticatedRequestsRejected.add(
    !timedOutOrDropped(noAuthRes) && hasGraphQLErrors(noAuthRes),
  );

  // 2. A query nine levels deep — rejected during GraphQL validation
  // (depthLimit), before execution ever reaches a resolver or the DB.
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
    !timedOutOrDropped(deepRes) &&
      (deepRes.status === 400 || hasGraphQLErrors(deepRes)),
  );

  // 3. The same comment twice — *does* need a DB write, so unlike the two
  // checks above this one is expected to slow down under saturation; it's
  // reported, not gated by a threshold (see options.thresholds above).
  const dupeComment = `stress test duplicate-detection probe (vu=${__VU})`;
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
  duplicateCommentsRejected.add(
    !timedOutOrDropped(secondAttempt) && hasGraphQLErrors(secondAttempt),
  );

  sleep(0.5);
}

export function healthProbe() {
  const res = http.get(`${BASE_URL}/health`, { timeout: REQUEST_TIMEOUT });
  serverStayedUp.add(res.status === 200);
  sleep(1);
}
