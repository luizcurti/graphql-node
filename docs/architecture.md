# Architecture Overview

High-level view of how a request flows through the system, from the client to
MySQL and back — including the real-time path via GraphQL subscriptions.

![Architecture overview diagram](./images/architecture.svg)

## Key points

- **Single Express app, two transports.** The same `context()` factory builds
  the per-request `dataSources` object for both the HTTP path (queries/mutations)
  and the WebSocket path (subscriptions) — the only difference is that WS
  connections skip `LoginApi` (`connection: true`), since login/logout only
  make sense over HTTP with cookies.
- **Stateful JWT.** Tokens aren't just verified cryptographically — `context()`
  also checks the token against the one stored on the user's row
  (`user.token !== token` invalidates it), so logout truly revokes a session
  instead of just deleting a client-side cookie.
- **DataLoader batching.** Every `*SQLDataSource` extends the generic
  `SQLDatasource<TKey, TValue>` base class, which wraps a `DataLoader` per
  access pattern (`batchLoadById`, `batchLoadByUserId`, `batchLoad` by
  `post_id`) — see [`datasources-class-diagram.md`](./datasources-class-diagram.md).
- **PubSub swaps transparently.** `createPubSub()` returns a Redis-backed
  `PubSubEngine` when `REDIS_URL` is set (required in production) and falls
  back to the in-memory `PubSub` otherwise — resolvers never know which one
  they're talking to.
- **Kafka is an optional event backbone in front of PubSub.** `CommentSQLDataSource.create()`
  never touches PubSub directly — it calls `publishCommentCreated()`
  (`src/kafka/producer.ts`). When `KAFKA_BROKERS` is set, that publishes onto
  the `comment.created` topic, and a separate consumer group
  (`src/kafka/consumer.ts`, started at boot) reads it back and republishes
  onto PubSub. When `KAFKA_BROKERS` is unset, the producer publishes to
  PubSub directly — same event, no broker required. Either way, the
  `createdComment` subscription resolver is unaware Kafka exists. See
  [`subscriptions-flow.md`](./subscriptions-flow.md).
- **Optional read replica.** Every `*SQLDataSource` holds two connections
  (`db` write, `readDb` read); list queries and DataLoader batch fetches use
  `readDb`, which defaults to `db` unless `DATABASE_REPLICA_HOST` is set.
  Point reads by id and everything inside a mutation always use `db`, to
  avoid read-your-writes bugs from replica lag. See
  [`database-scaling.md`](./database-scaling.md).
- **Observability.** `/metrics` (Prometheus) and `/health` + `/ready` are
  always on; OpenTelemetry tracing is opt-in via `OTEL_EXPORTER_OTLP_ENDPOINT`
  and, when enabled, stamps `trace_id`/`span_id` onto every log line. See
  [`observability.md`](./observability.md).
- **Defense in depth.** Query depth is capped at 7 (`graphql-depth-limit`),
  a query-complexity plugin caps total selected fields at 1000 (catches the
  wide-but-shallow queries depth limiting alone misses), introspection is
  disabled outside development, and every mutation that touches a specific
  user's data re-checks ownership (`checkOwner`) even though the caller is
  already authenticated.
- **Login rate limiting is Redis-backed, not per-process.** `REDIS_URL` is
  already required in production for PubSub, so
  `LoginApi`'s rate limiter (`src/graphql/schema/login/datasources.ts`)
  reuses it via `src/redis.ts` — necessary once there's more than one
  instance, or a per-pod in-memory counter lets a brute-force client get a
  multiple of the intended attempt budget by hitting different pods. See
  [`security-hardening.md`](./security-hardening.md).
