# Security Hardening

Gaps closed and checks confirmed, mostly by asking "does this still hold
once there's more than one instance / a client that isn't playing nice /
history that's been sitting there for years," not by inspection alone.

## Login rate limiting is now Redis-backed

**The gap:** login rate limiting (`src/graphql/schema/login/datasources.ts`)
used an in-memory `Map`, fine for a single process. The
[k8s Deployment](../k8s/app.yaml) added in this same round of work runs
`replicas: 2` — meaning two independent maps, each enforcing "5 attempts per
15 minutes" *per pod*. A brute-force client hitting the `Service` gets
load-balanced across pods, so it could get roughly 2× (or more, scaled
further) the intended attempt budget, never once tripping a single pod's
counter past the threshold.

**The fix:** `src/redis.ts` adds a general-purpose Redis client — separate
from `graphql/pubsub.ts`'s dedicated publisher/subscriber connections,
since a connection in `SUBSCRIBE` mode can't run ordinary commands.
`checkRateLimit`/`clearRateLimit` now use `INCR` + `PEXPIRE` on
`login-attempts:<userName>` when Redis is configured, falling back to the
original in-memory `Map` only when it isn't (dev/test, since `REDIS_URL` is
already required in production for subscriptions — every production
request already goes through Redis for pub/sub, so this reuses that same
requirement rather than adding a new one).

**Verified against a real Redis, not just mocked:** six login attempts
against a running server with `REDIS_URL` pointed at a real container — the
6th was rejected with the expected message, and `redis-cli GET
login-attempts:<user>` showed `6` with a `PTTL` of ~15 minutes, confirming
the counter is genuinely shared state a second pod would see too, not a
per-process illusion.

## Query complexity limiting closes a gap depth limiting leaves open

**The gap:** `depthLimit(7)` only bounds *nesting*. A query that's shallow
but *wide* — the same expensive field requested hundreds of times via
aliases (`a0: post(id:"1"){title} a1: post(id:"1"){title} ...`) — sails
through with a depth of 2, while still forcing hundreds of resolver calls.

**The fix:** [`graphql/complexity-limit.ts`](../src/graphql/complexity-limit.ts)
adds a budget of 1000 total selected fields via `graphql-query-complexity`'s
`simpleEstimator` (1 point per field, summed over the whole query).
Aliasing the same field 1000+ times now gets rejected outright.

This is implemented as an **Apollo Server plugin**
(`didResolveOperation`), not a `validationRules` entry alongside
`depthLimit`, and that choice wasn't the first thing tried — it's the fix
for a real failure. Apollo Server 5's `validationRules` option only accepts
a static array, with no access to the request's actual variable values. The
first implementation built the check as a validation rule anyway, and the
project's own e2e suite caught it immediately: any query with a required
variable (`query($id: ID!) { user(id: $id) { ... } }`) failed with
`Variable "$id" of required type "ID!" was not provided.` —
`graphql-query-complexity` needs real variable values to coerce a query's
variable definitions, and a static rule never has them. `didResolveOperation`
does (`request.variables`), so the check moved there instead.

**Known limitation, stated rather than hidden:** `simpleEstimator` counts
*selections*, not list sizes or DB rows — it has no way to know `posts`
returns N rows. For this schema's scale that's an acceptable
simplification; a field-by-field DB-cost model would use
`fieldExtensionsEstimator` with per-field `extensions.complexity`
annotations instead.

**Verified two ways:**

- A 1001-field alias query against a running server was rejected with
  `The query exceeds the maximum complexity of 1000. Actual complexity is 2002`
  (2× field count, since each alias also selects a sub-field).
- A realistic heavy query — 24 posts with nested `user` and `comments`
  (each with their own `user`) — passed without issue, confirming the
  budget doesn't get in the way of legitimate usage this API actually makes.
- `complexity-limit.test.ts` includes a regression test that runs a query
  with a required variable through the plugin directly, so the
  variable-coercion failure above can't silently come back.

## CSRF: confirmed, made explicit, and regression-tested

**Why this was worth checking:** `login`'s cookie is set with
`sameSite: 'none'` (`src/graphql/schema/login/datasources.ts`), which is
unusually permissive — it lets the cookie ride along on cross-site
requests, the precondition for a CSRF attack against any cookie-authenticated
mutation.

**What was found:** Apollo Server 5 enables CSRF prevention by default
(`csrfPrevention` defaults to `true` when unset) — this repo was never
setting it explicitly, so protection was already active, just implicit.
`src/index.ts` now sets `csrfPrevention: true` outright, so the intent is
documented in the code instead of resting on a default that could
silently flip in a future major version.

**Verified against a running server**, not assumed from the Apollo docs:
a request with the valid session cookie but `Content-Type: text/plain`
(one of the "simple request" content types a plain HTML `<form>` can send
without triggering a CORS preflight) was rejected with
`This operation has been blocked as a potential Cross-Site Request Forgery`.
Same result for `application/x-www-form-urlencoded`. Both checks are now
permanent regression tests in `e2e-test.ts` (`csrf_text_plain_rejected`,
`csrf_form_urlencoded_rejected`), so a future change that accidentally
disables this can't pass CI silently.

## Secret scanning (gitleaks) — and what it found

Added a `secrets-scan` CI job
([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) running
[gitleaks](https://github.com/gitleaks/gitleaks) against the **full git
history** (`fetch-depth: 0`), not just the working tree — a secret removed
in a later commit is still a leaked secret.

Verified it has teeth before adding it to CI: a fake AWS example key
(`wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`, the well-known AWS docs
placeholder) was correctly *not* flagged, while a fake-but-realistic GitHub
token pattern was. Then it was pointed at this repo for real.

**It found something.** Two JWTs committed in `db.json` back in this
project's earliest history — a mock/prototype dataset predating the
migration to MySQL, with 2021 timestamps embedded in the tokens themselves
(expired since June 2021). `db.json` doesn't exist in the working tree
anymore, and the tokens couldn't be validated today regardless — this
app's JWT check also requires the token to match the one stored on the
corresponding user's row (see
[`subscriptions-flow.md`](./subscriptions-flow.md)), and that row hasn't
existed since the project moved off mock JSON data. Rewriting git history
to scrub two dead, four-year-expired tokens would force-push a repo's
worth of commit hash changes for zero remaining risk — disproportionate,
so instead: [`.gitleaksignore`](../.gitleaksignore) records both
fingerprints with the reasoning inline, and a third entry allowlists a
similarly-inert example JWT in `queries/query_with_authentication_0001.gql`
(a sample request-headers comment, not a live credential).

## Dependency updates (Dependabot)

[`.github/dependabot.yml`](../.github/dependabot.yml) covers all three
places this repo has pinned versions: npm packages, the `Dockerfile`'s base
image, and the GitHub Actions used in CI — weekly, so a CVE in a dependency
shows up as a PR instead of requiring someone to remember to check.
`@opentelemetry/*` and `@apollo/*` packages are grouped, since both ship as
many small packages that need to move together; ungrouped, a single minor
bump would arrive as a dozen individually-failing PRs.
