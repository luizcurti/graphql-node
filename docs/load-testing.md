# Load Testing

A [k6](https://k6.io/) script (`loadtest/graphql-load-test.js`) that puts
concurrent load on both the read path (DataLoader batching + query depth
limit) and the write path (`createComment` → Kafka/PubSub), and — just as
importantly — checks that the API keeps *rejecting* bad requests correctly
while busy, not just that it stays fast for good ones.

## Running it

Requires [k6](https://k6.io/docs/get-started/installation/) installed
locally (there's no npm package for it, same caveat as Newman for
`test:api`) and a running, seeded server:

```bash
npm run db:setup   # fresh seed data (fixes duplicate-comment collisions)
npm run build && npm start &
npm run loadtest
```

## Scenarios

| Scenario | Shape | What it exercises |
|---|---|---|
| `happy_path_reads` | Ramps 0→20 VUs over 35s | `post(id) { comments { ... } }` — DataLoader batching resolving nested comments |
| `happy_path_writes` | 5 constant VUs, 30s | `createComment` with a unique body per request → Kafka producer (or PubSub fallback) |
| `sad_path` | 3 constant VUs, 30s | Three requests that *must* be rejected every time (see below) |

### The sad path is the point, not an afterthought

Three deliberately-bad requests run continuously alongside the happy path,
each with its own threshold requiring a **>99% rejection rate**:

1. **No `Authorization` header** on a protected field (`users`) — must get
   a GraphQL error every time.
2. **A 9-level-deep query** — `depthLimit(7)` in `src/index.ts` caps queries
   at 7 levels. Verified directly against the running server before writing
   this into the script: an 8-level version of this same query pattern
   lands *exactly at* the limit and is allowed through; only at 9 levels
   does it fail with `'' exceeds maximum operation depth of 7`. The script
   uses the proven-failing 9-level shape, not a guessed one.
3. **The same comment sent twice** — `CommentSQLDataSource.create()`'s
   duplicate check must reject the second identical `(user, post, comment)`
   triple, under concurrent load, not just in a single-request unit test.

If any of these ever started silently succeeding under load — a race
condition in the duplicate check, an auth bypass, a depth-limit check that
only works when the server is idle — the corresponding threshold fails the
run.

## Example run

Captured on this machine (Node 24, local MySQL container, `KAFKA_BROKERS`
unset — comment events falling back to direct PubSub). Real numbers, not
illustrative ones:

```
  █ THRESHOLDS

    happy_path_unexpected_errors
    ✓ 'rate<0.02' rate=0.00%

    http_req_duration{scenario:happy_path_reads}
    ✓ 'p(95)<500' p(95)=14.76ms

    sad_path_auth_rejected
    ✓ 'rate>0.99' rate=100.00%

    sad_path_depth_limit_rejected
    ✓ 'rate>0.99' rate=100.00%

    sad_path_duplicate_rejected
    ✓ 'rate>0.99' rate=100.00%

  █ TOTAL RESULTS

    http_req_duration: avg=8.03ms med=7.39ms p(90)=13.91ms p(95)=16.24ms max=277.93ms
    http_reqs: 3634  101.77/s
    iterations: 3101  86.84/s
    vus_max: 28
```

`http_req_failed` reports `4.87%` (177/3634) in this run — that's *expected*:
it's k6 counting the depth-limit scenario's HTTP-level failures (which
return non-2xx), not a real error rate. The scenario-scoped
`happy_path_unexpected_errors` metric (0.00%) is the one that actually
gates the happy path.

`/metrics` immediately after this run (see
[`observability.md`](./observability.md)) showed the same three rejection
categories from the server's own side, confirming the load test's verdict
independently rather than just trusting k6's own accounting:

```
graphql_operations_total{operation_type="mutation",status="success"} 689
graphql_operations_total{operation_type="query",status="success"} 5441
graphql_operations_total{operation_type="query",status="error"} 354
graphql_operations_total{operation_type="mutation",status="error"} 611
graphql_operations_total{operation_type="unknown",status="error"} 178
```

Each label was checked in isolation (one request, `/metrics` diffed
before/after) to confirm what actually produces it, rather than guessing:

- **`query` / `error`** — the unauthenticated `users` query. It's
  well-formed and passes validation, so `didResolveOperation` runs and
  tags it `query`; the `AuthenticationError` is thrown later, during
  resolution.
- **`unknown` / `error`** — the 9-level-deep query. `depthLimit(7)` rejects
  it during **validation**, before `didResolveOperation` ever runs — so the
  plugin's `operation_type` default (`'unknown'`) is what actually gets
  recorded. This is also why an operation-type label can never be
  attacker-controlled: the one case where the real type is unavailable is
  exactly the case where the request never got far enough to resolve one.
- **`mutation` / `error`** — a duplicate `createComment`. The script's
  own repeated-comment probe reuses the same comment text across a VU's
  iterations, so beyond the deliberate immediate-duplicate check, some of
  the "first" attempts in later iterations land on a `(user, post, comment)`
  triple that VU already created earlier and get rejected too — a benign
  side effect of the script, still exercising the same duplicate-check code
  path either way.

The exact counts above are one concurrent run, not a guaranteed ratio —
scenario timing overlaps and the effect just described mean they won't
divide evenly by iteration count. What's meaningful is that all three
categories are present and non-zero, matching the three sad-path checks the
thresholds already gated on.
