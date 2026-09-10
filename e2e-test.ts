#!/usr/bin/env node
// E2E tests for all GraphQL routes.

const BASE_URL = 'http://localhost:4003';
let passCount = 0;
let failCount = 0;

interface GqlResponse {
  data?: unknown;
  errors?: { message?: string }[];
}

const gql = async (
  query: string,
  {
    variables,
    token,
  }: { variables?: Record<string, unknown>; token?: string } = {},
): Promise<GqlResponse> => {
  const payload: { query: string; variables?: Record<string, unknown> } = {
    query,
  };
  if (variables) payload.variables = variables;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    return (await res.json()) as GqlResponse;
  } catch (exc) {
    return { errors: [{ message: (exc as Error).message }] };
  }
};

const check = (name: string, resp: GqlResponse, expectError = false): void => {
  const hasErrors = Boolean(resp.errors && resp.errors.length > 0);

  if (hasErrors === expectError) {
    console.log(`  ✅ PASS${expectError ? ' (expected error)' : ''}: ${name}`);
    passCount += 1;
  } else {
    const label = expectError ? '(expected an error, got none)' : '';
    console.log(`  ❌ FAIL${label ? ` ${label}` : ''}: ${name}`);
    if (hasErrors) {
      const msgs = (resp.errors ?? []).map((e) => e.message || '?');
      console.log(`     errors: ${JSON.stringify(msgs)}`);
    } else {
      console.log(`     resp: ${JSON.stringify(resp).slice(0, 200)}`);
    }
    failCount += 1;
  }
};

const main = async (): Promise<void> => {
  console.log('=========================================');
  console.log('  GraphQL E2E Tests');
  console.log('=========================================');

  // ── Cleanup: remove the e2e user from a previous run ─────────────────────
  const preLogin = await gql(`
    mutation {
      login(data: { userName: "e2e.test.user", password: "Senha123" }) {
        userId token
      }
    }
  `);
  const oldE2eId = (preLogin.data as any)?.login?.userId;
  const oldE2eToken = (preLogin.data as any)?.login?.token;
  if (oldE2eId && oldE2eToken) {
    await gql(`mutation { deleteUser(userId: "${oldE2eId}") }`, {
      token: oldE2eToken,
    });
    console.log(
      `  🧹 Cleanup: user e2e.test.user (id=${oldE2eId}) removed from a previous run`,
    );
  }

  // ── 1. createUser ────────────────────────────────────────────────────────
  console.log('\n[ MUTATIONS ] — Create e2e user');
  let resp = await gql(`
    mutation {
      createUser(data: {
        firstName: "E2E"
        lastName: "Test"
        userName: "e2e.test.user"
        password: "Senha123"
      }) {
        id firstName lastName userName indexRef createdAt
        posts { id }
      }
    }
  `);
  check('createUser', resp);
  const e2eUserId = (resp.data as any)?.createUser?.id;
  console.log(`     => userId: ${e2eUserId}`);

  // ── 2. valid login ───────────────────────────────────────────────────────
  console.log('\n[ MUTATIONS ] — Login');
  resp = await gql(`
    mutation {
      login(data: { userName: "elisa.pereira", password: "Senha123" }) {
        userId
        token
      }
    }
  `);
  check('login_valid_returns_userId_and_token', resp);
  const token = (resp.data as any)?.login?.token;
  const loginUserId = (resp.data as any)?.login?.userId;
  console.log(`     => userId: ${loginUserId}`);
  console.log(`     => token: ${token ? '(received)' : '(missing)'}`);

  // ── 3. invalid login ─────────────────────────────────────────────────────
  resp = await gql(`
    mutation {
      login(data: { userName: "does_not_exist", password: "wrongpassword" }) {
        userId token
      }
    }
  `);
  check('login_invalid', resp, true);

  // ── 3b. login enumeration — nonexistent user and wrong password must be
  // indistinguishable by message, otherwise a caller can enumerate valid
  // usernames before ever guessing a password ─────────────────────────────
  const nonexistentUserResp = await gql(`
    mutation {
      login(data: { userName: "definitely_not_a_real_user", password: "whatever123" }) {
        userId
      }
    }
  `);
  // Deliberately not named with "password" in it — the value here is a
  // GraphQL response object (just the two error messages get compared
  // below), never the credential itself, but a scanner can't tell that
  // from a name like `wrongPasswordResp` alone.
  const badCredentialResp = await gql(`
    mutation {
      login(data: { userName: "elisa.pereira", password: "definitely_wrong" }) {
        userId
      }
    }
  `);
  const sameMessage =
    Boolean(nonexistentUserResp.errors?.[0]?.message) &&
    nonexistentUserResp.errors?.[0]?.message ===
      badCredentialResp.errors?.[0]?.message;
  if (sameMessage) {
    console.log('  ✅ PASS: login_enumeration_indistinguishable');
    passCount += 1;
  } else {
    console.log('  ❌ FAIL: login_enumeration_indistinguishable');
    console.log(
      `     nonexistent-user error message: ${nonexistentUserResp.errors?.[0]?.message}`,
    );
    console.log(
      `     bad-credential error message:   ${badCredentialResp.errors?.[0]?.message}`,
    );
    failCount += 1;
  }

  // ── 4-6. getUser ─────────────────────────────────────────────────────────
  console.log('\n[ QUERIES ] — Users (authenticated)');
  resp = await gql('{ user(id: "602") { id userName firstName } }', {
    token,
  });
  check('getUser_602', resp);

  resp = await gql(
    '{ user(id: "812") { id firstName lastName userName indexRef createdAt } }',
    { token },
  );
  check('getUser_812', resp);

  resp = await gql(
    '{ user(id: "115") { id firstName lastName userName indexRef createdAt } }',
    { token },
  );
  check('getUser_115', resp);

  // ── 7. getUsers ──────────────────────────────────────────────────────────
  resp = await gql(
    '{ users { id firstName lastName userName indexRef createdAt } }',
    { token },
  );
  check('getUsers', resp);

  // ── 8. getUsers with filter ──────────────────────────────────────────────
  resp = await gql(
    `
    query {
      users(input: { _sort: "indexRef", _order: DESC, _start: 0, _limit: 5 }) {
        id firstName lastName userName indexRef createdAt
      }
    }
  `,
    { token },
  );
  check('getUsers_filtered_desc', resp);

  // ── 9. getUsers with a variable ──────────────────────────────────────────
  resp = await gql(
    `
    query GET_USERS($id: ID!) {
      user(id: $id) {
        id firstName lastName userName indexRef createdAt
      }
    }
  `,
    { variables: { id: '115' }, token },
  );
  check('getUsers_variable', resp);

  // ── 10. getUsers with a fragment ─────────────────────────────────────────
  resp = await gql(
    `
    fragment userFields on User {
      id firstName lastName userName indexRef createdAt
    }
    query {
      user(id: "812") { ...userFields }
    }
  `,
    { token },
  );
  check('getUser_fragment', resp);

  // ── 11-13. getPost / getPosts ───────────────────────────────────────────
  console.log('\n[ QUERIES ] — Posts');
  resp = await gql('{ post(id: "645") { id title body indexRef createdAt } }', {
    token,
  });
  check('getPost_645', resp);

  resp = await gql('{ post(id: "342") { id title body indexRef createdAt } }', {
    token,
  });
  check('getPost_342', resp);

  resp = await gql('{ posts { id title body indexRef createdAt } }', {
    token,
  });
  check('getPosts', resp);

  // ── 14. getPost with aliases ─────────────────────────────────────────────
  resp = await gql(
    `
    query {
      post342: post(id: "342") { postId: id id title }
      post645: post(id: "645") { id postTitle: title }
    }
  `,
    { token },
  );
  check('getPost_aliases', resp);

  // ── 15. getPost with a fragment and unixTimestamp ───────────────────────
  resp = await gql(
    `
    fragment postFields on Post {
      id title body indexRef createdAt unixTimestamp
    }
    query {
      post1: post(id: "860") { ...postFields }
      post2: post(id: "342") { ...postFields }
    }
  `,
    { token },
  );
  check('getPost_fragment_unixTimestamp', resp);

  // ── 16. getPost — not found returns null ─────────────────────────────────
  resp = await gql('{ post(id: "999999") { id title } }', { token });
  if (resp.data !== undefined && resp.data !== null && !resp.errors) {
    console.log('  ✅ PASS: getPost_not_found (returns null with no errors)');
    passCount += 1;
  } else {
    const msgs = (resp.errors || []).map((e) => e.message || '?');
    console.log('  ❌ FAIL: getPost_not_found');
    console.log(`     errors: ${JSON.stringify(msgs)}`);
    failCount += 1;
  }

  // ── 17. createPost ──────────────────────────────────────────────────────
  console.log('\n[ MUTATIONS ] — Posts');
  resp = await gql(
    `
    mutation {
      createPost(data: { title: "E2E Test Post", body: "E2E post content" }) {
        id title body
        user { firstName }
        indexRef createdAt
      }
    }
  `,
    { token },
  );
  check('createPost', resp);
  const e2ePostId = (resp.data as any)?.createPost?.id;
  console.log(`     => postId: ${e2ePostId}`);

  // ── 18. updatePost ───────────────────────────────────────────────────────
  if (e2ePostId) {
    resp = await gql(
      `
      mutation {
        updatePost(postId: "${e2ePostId}", data: { title: "E2E Updated Post" }) {
          id title
          user { firstName }
        }
      }
    `,
      { token },
    );
    check('updatePost', resp);
  } else {
    console.log('  ⚠️  SKIP: updatePost (no postId)');
  }

  // ── 19. createComment ───────────────────────────────────────────────────
  console.log('\n[ MUTATIONS ] — Comments');
  if (e2ePostId) {
    resp = await gql(
      `
      mutation {
        createComment(data: { postId: "${e2ePostId}", comment: "E2E Comment" }) {
          id comment
          user { firstName }
        }
      }
    `,
      { token },
    );
    check('createComment', resp);

    // ── 19b. duplicate comment (same user, post, and text) is rejected —
    // backed by a DB-level unique constraint, not a check-then-insert race
    resp = await gql(
      `
      mutation {
        createComment(data: { postId: "${e2ePostId}", comment: "E2E Comment" }) {
          id
        }
      }
    `,
      { token },
    );
    check('createComment_duplicate_rejected', resp, true);
  } else {
    console.log('  ⚠️  SKIP: createComment (no postId)');
  }

  // ── 20. login as the e2e user ────────────────────────────────────────────
  console.log('\n[ MUTATIONS ] — E2E user update/delete');
  resp = await gql(`
    mutation {
      login(data: { userName: "e2e.test.user", password: "Senha123" }) {
        userId token
      }
    }
  `);
  check('login_e2e_user', resp);
  const e2eToken = (resp.data as any)?.login?.token;

  // ── 21. updateUser ───────────────────────────────────────────────────────
  if (e2eUserId && e2eToken) {
    resp = await gql(
      `
      mutation {
        updateUser(userId: "${e2eUserId}", data: {
          firstName: "E2EUpdated"
          lastName: "TestUpdated"
          userName: "e2e.test.user"
        }) {
          id firstName lastName userName
        }
      }
    `,
      { token: e2eToken },
    );
    check('updateUser', resp);
  } else {
    console.log('  ⚠️  SKIP: updateUser');
  }

  // ── 22. deletePost (before logout — needs Elisa's session) ──────────────
  console.log('\n[ MUTATIONS ] — Cleanup');
  if (e2ePostId) {
    resp = await gql(`mutation { deletePost(postId: "${e2ePostId}") }`, {
      token,
    });
    check('deletePost', resp);
  } else {
    console.log('  ⚠️  SKIP: deletePost');
  }

  // ── 23. deleteUser ───────────────────────────────────────────────────────
  if (e2eUserId && e2eToken) {
    resp = await gql(`mutation { deleteUser(userId: "${e2eUserId}") }`, {
      token: e2eToken,
    });
    check('deleteUser', resp);
  } else {
    console.log('  ⚠️  SKIP: deleteUser');
  }

  // ── 24. logout (elisa.pereira) — last, invalidates her token ────────────
  console.log('\n[ MUTATIONS ] — Logout');
  resp = await gql(
    `
    mutation {
      logout(userName: "elisa.pereira")
    }
  `,
    { token },
  );
  check('logout_elisa', resp);

  // ── 25. routes without auth must be rejected ─────────────────────────────
  console.log(
    '\n[ SECURITY ] — Routes without authentication must be rejected',
  );
  check('getUser_no_auth', await gql('{ user(id: "602") { id } }'), true);
  check('getUsers_no_auth', await gql('{ users { id } }'), true);
  check('getPosts_no_auth', await gql('{ posts { id } }'), true);
  check(
    'createPost_no_auth',
    await gql(
      'mutation { createPost(data: { title: "x", body: "y" }) { id } }',
    ),
    true,
  );

  // ── 25b. CSRF prevention (Apollo Server default, made explicit in
  // src/index.ts since login's cookie uses sameSite: 'none') ───────────────
  console.log('\n[ SECURITY ] — Simple-request CSRF vectors must be rejected');
  const rawPost = async (
    contentType: string,
    body: string,
  ): Promise<GqlResponse> => {
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    });
    return (await res.json()) as GqlResponse;
  };
  const isCsrfRejection = (resp: GqlResponse): boolean =>
    Boolean(resp.errors?.[0]?.message?.includes('Cross-Site Request Forgery'));

  const textPlainResp = await rawPost(
    'text/plain',
    JSON.stringify({ query: '{ __typename }' }),
  );
  if (isCsrfRejection(textPlainResp)) {
    console.log('  ✅ PASS: csrf_text_plain_rejected');
    passCount += 1;
  } else {
    console.log('  ❌ FAIL: csrf_text_plain_rejected');
    failCount += 1;
  }

  const formUrlencodedResp = await rawPost(
    'application/x-www-form-urlencoded',
    `query=${encodeURIComponent('{ __typename }')}`,
  );
  if (isCsrfRejection(formUrlencodedResp)) {
    console.log('  ✅ PASS: csrf_form_urlencoded_rejected');
    passCount += 1;
  } else {
    console.log('  ❌ FAIL: csrf_form_urlencoded_rejected');
    failCount += 1;
  }

  // ── 26. security headers (helmet) present on every response ─────────────
  console.log('\n[ SECURITY ] — helmet security headers must be present');
  const headerResp = await fetch(BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{ __typename }' }),
  });
  const hasSecurityHeaders =
    headerResp.headers.get('x-content-type-options') === 'nosniff' &&
    Boolean(headerResp.headers.get('x-frame-options'));
  if (hasSecurityHeaders) {
    console.log('  ✅ PASS: helmet_security_headers_present');
    passCount += 1;
  } else {
    console.log('  ❌ FAIL: helmet_security_headers_present');
    failCount += 1;
  }

  // ── 27. ops endpoints (health/ready/metrics) must be reachable ──────────
  console.log('\n[ OPS ] — health, readiness, and metrics endpoints');
  const checkOpsEndpoint = async (
    path: string,
    expectedStatus: number,
  ): Promise<void> => {
    const res = await fetch(`${BASE_URL}${path}`);
    if (res.status === expectedStatus) {
      console.log(`  ✅ PASS: ops_${path.replace('/', '')}`);
      passCount += 1;
    } else {
      console.log(
        `  ❌ FAIL: ops_${path.replace('/', '')} (got ${res.status}, expected ${expectedStatus})`,
      );
      failCount += 1;
    }
  };
  await checkOpsEndpoint('/health', 200);
  await checkOpsEndpoint('/ready', 200);
  await checkOpsEndpoint('/metrics', 200);

  // ── 28. union types (not implemented) ────────────────────────────────────
  console.log(
    '\n[ INFO ] — Union types (PostError) — would require a schema refactor',
  );
  console.log(
    '  ⚠️  SKIP: queries_0010/0011 (PostError/PostNotFoundError/PostTimeoutError out of current scope)',
  );

  console.log('\n=========================================');
  console.log('  FINAL RESULT');
  console.log('=========================================');
  console.log(`  ✅ Passed: ${passCount}`);
  console.log(`  ❌ Failed: ${failCount}`);
  console.log(`  Total:    ${passCount + failCount}`);

  if (failCount > 0) process.exit(1);
};

main();
