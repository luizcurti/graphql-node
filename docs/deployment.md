# Deployment / Container Architecture

How the app and its database run together under Docker Compose.

![Deployment diagram](./images/deployment.svg)

## Key points

- **Two containers, one Compose file.** `graphql_mysql` (MySQL 8) and
  `graphql_app` (this API, built from the root `Dockerfile`) are defined in
  [`docker-compose.yml`](../docker-compose.yml). `graphql_app` waits for
  MySQL's healthcheck before starting.
- **Multi-stage build.** The `Dockerfile` compiles `src/` to `dist/` with
  Sucrase in a `builder` stage (test files excluded via
  `--exclude-dirs __tests__`), then a slim `runtime` stage installs only
  production dependencies and copies `dist/` — no source, tests, or dev
  tooling ship in the final image.
- **Migrations are a separate step.** The app image only serves GraphQL; it
  does not run migrations on boot. Run `npm run db:setup` from the host (or
  any environment with network access to the database) after the containers
  are up.
- **Persistent data via a named volume.** MySQL data lives in the
  `mysql_data` Docker-managed volume — not a hardcoded host path — so it's
  portable across machines and isolated per checkout.
- **Redis is required in production, not in this Compose file.** `REDIS_URL`
  must point at a real Redis instance for subscriptions once `NODE_ENV=production`;
  local/dev usage falls back to the in-memory PubSub (see
  [`subscriptions-flow.md`](./subscriptions-flow.md)).
