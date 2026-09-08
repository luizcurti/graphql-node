# GraphQL Node API

Live GraphQL subscriptions over Redis PubSub — with an optional Kafka event backbone in front of it — DataLoader batching to kill N+1 queries, and query depth/complexity limits to reject abusive queries before they run — a GraphQL API built with Apollo Server, Knex, and MySQL, with JWT auth via httpOnly cookies.

📊 **[Architecture diagrams and flow docs →](./docs/README.md)**

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 24+ |
| Language | TypeScript (strict mode) |
| GraphQL Server | @apollo/server 5 (Express 5 + graphql-ws) |
| Query Language | GraphQL 16 |
| Database ORM | Knex 3 + MySQL2 |
| Authentication | JWT (jsonwebtoken) + bcrypt |
| Subscriptions | graphql-ws over Redis PubSub (ioredis) · in-memory fallback in dev |
| Event backbone | Kafka (kafkajs) — optional producer/consumer group feeding PubSub · direct fallback when unconfigured |
| Observability | Prometheus metrics (`@prometheus-io/client`) + `/health`/`/ready` always on · OpenTelemetry tracing opt-in |
| Logging | Pino (pino-pretty in dev, JSON in prod) — trace-id correlated when tracing is on |
| Transpiler | Sucrase (types are stripped, not checked — see `npm run typecheck`) |
| Testing | Jest + @sucrase/jest-plugin |

## Project Structure

```
src/
├── index.ts                        # Apollo Server entry point
├── utils/
│   └── logger.ts                   # Pino structured logger
├── graphql/
│   ├── context/
│   │   ├── index.ts                # JWT verification, request context
│   │   └── types.ts                # Context / DataSources types
│   ├── pubsub.ts                    # Redis / in-memory PubSub
│   ├── complexity-limit.ts          # Query-complexity plugin (caps total selected fields)
│   ├── datasources/sql/            # Base SQLDatasource class (db + readDb connections)
│   └── schema/
│       ├── user/                   # User CRUD + DataLoader
│       ├── post/                   # Post CRUD + DataLoader
│       ├── comment/                # Comment mutations + Subscription
│       ├── login/                  # Login / Logout + Redis-backed rate limiting
│       └── api-filters/            # Pagination/sorting input types
├── kafka/
│   ├── client.ts                    # Kafka instance factory (null if KAFKA_BROKERS unset)
│   ├── producer.ts                  # publishCommentCreated() — Kafka or direct PubSub fallback
│   ├── consumer.ts                  # Consumer group → republishes onto PubSub
│   └── topics.ts                    # Topic name constants
├── observability/
│   ├── metrics.ts                   # Prometheus registry, HTTP + GraphQL + Kafka metrics
│   ├── health.ts                    # /health (liveness) and /ready (readiness) handlers
│   ├── tracing.ts                   # OpenTelemetry NodeSDK bootstrap (opt-in, loaded via -r)
│   └── apollo-plugin.ts             # Apollo Server plugin recording GraphQL operation metrics
├── redis.ts                        # General-purpose Redis client (login rate limiting)
└── knex/
    ├── index.ts                    # Knex connection factory (db + optional read replica)
    ├── knexfile.ts                 # DB config per environment
    ├── migrations/                 # Schema migrations
    └── seeds/                      # Development seed data
```

## Prerequisites

- [Node.js](https://nodejs.org/) v24+
- [Docker](https://www.docker.com/) (for the MySQL container)
- Redis (required in production — subscriptions PubSub and login rate limiting)
- Kafka (optional — event backbone for `comment.created`; see [Docker](#docker) below)
- [k6](https://k6.io/) (optional — for `npm run loadtest`)
- [kind](https://kind.sigs.k8s.io/) + `kubectl` (optional — for trying the [Kubernetes manifests](#kubernetes) locally)

## Getting Started

### 1. Clone and install

```bash
git clone https://github.com/luizcurti/graphql-node.git
cd graphql-node
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env and fill in DATABASE_USER, DATABASE_PASSWORD, MYSQL_ROOT_PASSWORD, and JWT_SECRET (min 32 chars)
```

### 3. Start the database

```bash
docker compose up -d
```

### 4. Run migrations and seed data

```bash
npm run db:setup
```

This runs all migrations and populates the database with 20 users, 24 posts, and 24 comments for development.

### 5. Start the development server

```bash
npm run dev
```

The GraphQL Playground will be available at:

```
http://localhost:4003/graphql
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | Yes | `development` or `production` |
| `PORT` | No | Server port (default: `4003`) |
| `JWT_SECRET` | Yes | Secret key — minimum 32 characters |
| `ALLOWED_ORIGINS` | Yes | Comma-separated list of allowed CORS origins |
| `DATABASE_CLIENT` | No | Knex client (default: `mysql2`) |
| `DATABASE_HOST` | Yes | MySQL host |
| `DATABASE_PORT` | Yes | MySQL port (default: `3306`) |
| `DATABASE_NAME` | Yes | Database name |
| `DATABASE_USER` | Yes | Database user |
| `DATABASE_PASSWORD` | Yes | Database password |
| `DATABASE_POOL_MIN` / `DATABASE_POOL_MAX` | No | Knex connection pool size (defaults: `2` / `10`) |
| `DATABASE_REPLICA_HOST` / `DATABASE_REPLICA_PORT` | No | Optional read replica for list/batch queries — see [`docs/database-scaling.md`](./docs/database-scaling.md) |
| `MYSQL_ROOT_PASSWORD` | Yes | MySQL root password (Docker only) |
| `REDIS_URL` | Prod only | Redis connection URL for subscriptions |
| `KAFKA_BROKERS` | No | Comma-separated Kafka broker list — enables the Kafka event backbone for `comment.created`; falls back to direct PubSub publish when unset |
| `KAFKA_CLIENT_ID` | No | Kafka client id (default: `graphql-node`) |
| `KAFKA_CONSUMER_GROUP` | No | Kafka consumer group id (default: `graphql-node-subscriptions`) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | Enables OpenTelemetry tracing, exported to this OTLP/HTTP collector — see [`docs/observability.md`](./docs/observability.md) |
| `OTEL_SERVICE_NAME` | No | Service name reported in traces (default: `graphql-node`) |
| `LOG_LEVEL` | No | Pino log level (default: `info`) |

## API

### Queries

```graphql
user(id: ID!): User!                        # requires authentication
users(input: ApiFiltersInput): [User!]!     # requires authentication

post(id: ID!): Post!
posts(input: ApiFiltersInput): [Post!]!     # requires authentication
```

### Mutations

```graphql
# Auth
login(data: LoginInput!): Login!
logout(userName: String!): Boolean!

# Users
createUser(data: CreateUserInput!): User!
updateUser(userId: ID!, data: UpdateUserInput!): User!   # owner only
deleteUser(userId: ID!): Boolean!                        # owner only

# Posts
createPost(data: CreatePostInput!): Post!                # requires authentication
updatePost(postId: ID!, data: UpdatePostInput!): Post!   # owner only
deletePost(postId: ID!): Boolean!                        # owner only

# Comments
createComment(data: CreateCommentInput!): Comment!       # requires authentication
```

### Subscriptions

```graphql
createdComment: Comment!   # notifies the post owner when a comment is created
```

### Pagination / Sorting (ApiFiltersInput)

```graphql
input ApiFiltersInput {
  _sort: String
  _order: ApiFilterOrder   # ASC | DESC
  _start: Int
  _limit: Int
}
```

## Authentication

Login sets a `jwtToken` **httpOnly cookie** for browser clients. The same
token is also returned as `token` in the mutation response — needed because
non-browser flows (WebSocket subscriptions, mobile/API clients) can't rely on
the cookie — so a client that only wants cookie-based auth should simply not
select that field:

```graphql
mutation {
  login(data: { userName: "alice_barros38", password: "Senha123" }) {
    userId
  }
}
```

To authenticate via Bearer token (e.g., WebSocket subscriptions):

```
Authorization: Bearer <token>
```

## Security Features

- JWT validated on every request against the database token (stateful sessions)
- `JWT_SECRET` must be ≥ 32 characters — server exits on startup if invalid
- Query depth limited to **7 levels**, query complexity capped at **1000 selected fields** (catches wide-but-shallow alias abuse depth limiting misses — see [`docs/security-hardening.md`](./docs/security-hardening.md))
- GraphQL introspection **disabled in production**
- Login rate limiting: **5 attempts per 15 minutes** per username — Redis-backed (shared across instances) when `REDIS_URL` is set, in-memory otherwise
- CSRF prevention enabled (Apollo Server default, set explicitly) — verified live against `text/plain` and `application/x-www-form-urlencoded` request forgery, both rejected; regression-tested in `e2e-test.ts`
- Tokens stored only in `httpOnly + secure` cookies
- All credentials via environment variables (never hardcoded)
- CI scans the full git history for secrets on every push ([gitleaks](https://github.com/gitleaks/gitleaks)) and Dependabot opens a PR weekly for any dependency with a known vulnerability — see [`docs/security-hardening.md`](./docs/security-hardening.md)

## Available Scripts

```bash
npm run dev              # Start development server with hot reload
npm start                # Start production server (requires build)
npm run build            # Compile src/ to dist/ via Sucrase

npm test                 # Run all tests
npm run test:watch       # Run tests in watch mode
npm run test:integration # Run integration tests against a real MySQL (needs db:setup first)
npm run test:e2e         # Run e2e-test.ts against a running server
npm run test:api         # Run the Postman collection (via `npx newman`) against a running server
npm run loadtest         # Run the k6 load test against a running server (requires k6 installed)
npm run test:ci          # lint:check + typecheck + test + build
npm run typecheck        # Type-check the project with tsc (no emit)

npm run migrate          # Run pending database migrations
npm run migrate:rollback # Roll back the last migration batch
npm run seed             # Populate database with development seed data
npm run db:setup         # migrate + seed in one command

npm run lint             # Run ESLint
npm run lint:fix         # Auto-fix ESLint issues
npm run format           # Format code with Prettier
npm run format:check     # Check formatting without writing

npm run security         # Run npm audit (high severity)
```

## Testing

Four independent layers, each covering the API from a different angle:

```bash
npm test                 # unit tests — mocked, no external services needed
npm run test:integration  # real MySQL — schema, constraints, cascades
npm run test:e2e          # black-box HTTP run against a live server
npm run test:api          # Postman collection (via newman) against a live server
```

### Unit tests (`npm test`)

208 tests across 24 suites, with **100% statement/branch/function/line
coverage** on every business-logic module (resolvers, datasources, auth
context, pubsub, kafka, observability, validators — see `npm test -- --coverage`).
Entry-point bootstrap (`src/index.ts`) and migrations/seeds are intentionally
excluded from that figure — they're covered by the integration suite
instead, which exercises them against a real database rather than mocks.

- `login-functions` — `checkIsLoggedIn`, `checkOwner`
- `user-validators` — `validateUserName`, `validateUserPassword`
- `user-resolvers` / `post-resolvers` / `comment-resolvers` — all Query, Mutation, field resolvers, and the real subscription filter (via `withFilter` + pubsub)
- `login-api` — full login/logout flow, rate limiting (both the in-memory fallback and the Redis-backed path), cookie behavior
- `user-datasource` / `post-datasource` / `comment-datasource` — reducers, whitelist validation, create/update/delete, DataLoader batch functions, publishing to the Kafka producer on comment creation, and read-replica routing (which methods use `readDb` vs. `db`)
- `context` — every branch of JWT/cookie authentication
- `kafka-client` / `kafka-producer` / `kafka-consumer` — Kafka-configured vs. unconfigured branches, connect-once memoization, and malformed-message handling
- `observability-metrics` / `observability-health` / `observability-apollo-plugin` / `observability-tracing` — HTTP/GraphQL/Kafka metric recording, liveness always-200, readiness happy/DB-down paths, and OTel SDK start/shutdown with tracing enabled/disabled
- `redis` — the same optional-additive pattern as `kafka-client`, applied to the general-purpose Redis client
- `complexity-limit` — under budget, over budget (many aliases, low depth), and the required-variable regression case that broke the first implementation
- `pubsub`, `sql-datasource`, `schema-index`, `logger`, `knex-config` — supporting modules (env-dependent branches, base class behavior, module wiring, read-replica connection building, trace-id log mixin)

### Integration tests (`npm run test:integration`)

28 tests against a real MySQL database (requires `npm run db:setup` first).
These exist specifically for what can't be meaningfully faked with mocks:
unique-constraint violations, and `ON DELETE CASCADE` actually deleting a
user's posts and a post's comments.

### End-to-end tests (`npm run test:e2e`)

30 checks that run real GraphQL requests against a running server — the
same happy-path and rejected-without-auth scenarios a real client would
hit, plus two CSRF-prevention checks that need raw HTTP requests with a
non-JSON content type, so they live here rather than in the mocked unit
suite.

### API / collection tests (`npm run test:api`)

Runs [`graphql-node.postman_collection.json`](./graphql-node.postman_collection.json)
headlessly via [Newman](https://github.com/postmanlabs/newman) (invoked with
`npx`, not a project dependency — its dependency tree carries known
vulnerabilities in transitive packages, so it's kept out of `package-lock.json`
and this project's own `npm audit`). Covers logins, ownership checks,
validation errors, SQL-injection and depth-limit rejection, and login rate
limiting — 65 assertions across 32 requests.

Like `test:e2e`, it expects a running server with freshly seeded data
(`npm run db:setup`); running it twice in a row without reseeding will fail
on requests that assert uniqueness (e.g. duplicate comment detection), since
the first run's data is still there.

### Load tests (`npm run loadtest`)

A separate exercise from the four correctness layers above — concurrent
load via [k6](https://k6.io/), checking not just that reads stay fast under
load but that auth rejection, the query depth limit, and duplicate-comment
detection all keep working correctly while the server is busy, not just
when idle. See [`docs/load-testing.md`](./docs/load-testing.md) for
scenarios, thresholds, and a captured example run.

The full run above isn't wired into CI (it's a performance benchmark, not a
correctness gate — run it manually before a release or when touching the
hot paths it covers). CI does run a `SMOKE_TEST=true` variant of the same
script after the `integration` job's e2e/API tests (3 seconds per scenario,
thresholds still enforced) purely so a broken query or schema change in the
script itself fails fast, instead of only being discovered the next time
someone runs the real benchmark by hand.

## Database

### Migrations

```bash
npm run migrate          # apply all pending migrations
npm run migrate:rollback # roll back last batch
```

Migrations in `src/knex/migrations/`:

| File | Description |
|---|---|
| `20210529121742_create-comments-table.ts` | Comments table (integer post_id / user_id) |
| `20260310130000_create-users-table.ts` | Users table with unique user_name |
| `20260310130001_create-posts-table.ts` | Posts table with FK → users (CASCADE DELETE) |
| `20260310130002_add-fk-to-comments.ts` | FK constraints on comments → posts and users (CASCADE DELETE) |

> **Upgrading a database that predates the TypeScript migration:** Knex
> records each applied migration by filename in `knex_migrations`. If your
> database already ran these migrations back when the source files were
> `.js` (before this project's JS→TS migration), `npm run migrate` will fail
> with `"the migration directory is corrupt"`, since the recorded `.js`
> names no longer match the `.ts` files on disk. Fix it once with:
>
> ```sql
> UPDATE knex_migrations SET name = REPLACE(name, '.js', '.ts');
> ```
>
> A fresh database (including the one created by `docker compose up` /
> `npm run db:setup` in this repo) is unaffected — it only happens when
> reusing pre-existing migration history from before the rewrite.

### Seeds

```bash
npm run seed             # truncate and repopulate all tables
```

Seed data (`src/knex/seeds/`):

| File | Records |
|---|---|
| `01_users.ts` | 20 users — all with password `Senha123` |
| `02_posts.ts` | 24 posts |
| `03_comments.ts` | 24 comments |

Seeds run in order and respect foreign key constraints.

## Docker

Run the whole stack — API + MySQL — with Docker Compose. The app image is
built from the root `Dockerfile` (multi-stage: Sucrase build, then a slim
production image with only `dist/` and production dependencies).

```bash
cp .env.example .env   # fill in the values, same as local development
docker compose up -d --build
npm run db:setup       # migrate + seed, run from the host against the containerized DB
```

The API is then available at `http://localhost:4003/graphql`, same as
`npm run dev`. See [`docs/deployment.md`](./docs/deployment.md) for the
container architecture diagram.

To run only the MySQL container (e.g. while running the API locally via
`npm run dev`):

```bash
docker compose up -d graphql_mysql
```

### Kafka (optional)

The Kafka broker is behind a Compose profile, so it's off by default. Bring
it up explicitly:

```bash
docker compose --profile kafka up -d kafka
```

Then set `KAFKA_BROKERS` in `.env` — `localhost:9092` if the app runs on the
host (`npm run dev`), or `kafka:19092` if the app also runs in Compose.
Without `KAFKA_BROKERS`, `createComment` publishes straight onto PubSub, so
subscriptions work identically either way — see
[`docs/subscriptions-flow.md`](./docs/subscriptions-flow.md#kafka-as-an-optional-event-backbone).

### Observability

```
http://localhost:4003/health   # liveness — always 200
http://localhost:4003/ready    # readiness — 200/503 based on a real DB check
http://localhost:4003/metrics  # Prometheus exposition format
```

Tracing is opt-in — bring up a local collector and point the app at it:

```bash
docker compose --profile observability up -d jaeger
# .env: OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

Jaeger's UI is then at `http://localhost:16686`. See
[`docs/observability.md`](./docs/observability.md) for what's always on vs.
opt-in, and how it was verified against a real collector.

## Kubernetes

Plain Deployment/Service/ConfigMap/Secret/HPA manifests in
[`k8s/`](./k8s/) — no Helm/Kustomize. Built and checked against a real
[kind](https://kind.sigs.k8s.io/) cluster (image loaded in, pods reaching
`Ready` off `/ready`, a GraphQL query answered through the `Service`, the
HPA computing a real value once metrics-server was added) rather than just
written and assumed correct. See [`k8s/README.md`](./k8s/README.md) for the
full walkthrough, including what broke on the first attempt (the app
crash-looping without `REDIS_URL`, exactly as `NODE_ENV=production`
requires — which is also why login rate limiting is Redis-backed now, see
[`docs/security-hardening.md`](./docs/security-hardening.md)) and how it
was fixed.

## CI

[`.github/workflows/ci.yml`](./.github/workflows/ci.yml) runs on every push
and pull request to `main`, as five jobs:

| Job | Runs |
|---|---|
| `secrets-scan` | [gitleaks](https://github.com/gitleaks/gitleaks) scans the full git history (not just the working tree) for committed secrets |
| `quality` | Install → ESLint → Prettier check → typecheck → unit tests → build → `npm audit` → outdated-dependency check |
| `integration` | Migrate + seed a real MySQL service container → integration tests → build → start the server → e2e tests → API/collection tests → k6 smoke test (`SMOKE_TEST=true`) |
| `k8s-lint` | [kubeconform](https://github.com/yannh/kubeconform) validates every manifest in `k8s/` against the Kubernetes 1.32 schema — no cluster needed |
| `docker` | Build the app image → `docker compose up` (app + MySQL) → migrate + seed against the containerized DB → e2e tests → API/collection tests, all against the running containers |

[`.github/dependabot.yml`](./.github/dependabot.yml) runs separately from
this workflow — weekly PRs for npm, Docker base image, and GitHub Actions
updates.

Any job failing fails the whole workflow. `quality` must pass before `docker`
starts, so a broken build or lint error fails fast without spending time on
the Docker build.