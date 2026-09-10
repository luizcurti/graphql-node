# Kubernetes Manifests

Plain YAML (no Helm/Kustomize) demonstrating how this app maps onto
Kubernetes: `Deployment` + `Service` for the app, MySQL (primary + read
replica), Redis, and Kafka alongside it, `ConfigMap`/`Secret` for
configuration, liveness/readiness probes wired to the app's `/health` and
`/ready` endpoints, and an HPA.

| File | What it creates |
|---|---|
| `namespace.yaml` | The `graphql-node` namespace everything else lives in |
| `configmap.yaml` | Non-secret env vars (mirrors `.env.example`) |
| `secret.example.yaml` | **Template only** — see below before applying |
| `mysql.yaml` | MySQL primary `Deployment` + `PersistentVolumeClaim` + `Service`, with GTID replication enabled and an init script creating the replication account |
| `mysql-replica.yaml` | A read replica of the above — see [Read replica](#read-replica) below |
| `redis.yaml` | Redis `Deployment` + `Service` — required in production for PubSub, also backs the distributed login rate limiter and the JWT verification cache |
| `kafka.yaml` | Single-broker KRaft-mode Kafka `Deployment` + `Service` backing the `comment.created` event backbone |
| `app.yaml` | The app's `Deployment` (2 replicas) + `Service` |
| `hpa.yaml` | `HorizontalPodAutoscaler` targeting 70% CPU, 2–6 replicas |

An OpenTelemetry collector isn't included here — tracing is opt-in on the
app itself and adding collector infrastructure for a feature most people
evaluating this repo won't turn on isn't worth it. Point
`OTEL_EXPORTER_OTLP_ENDPOINT` at whatever you're already running instead.

## Secrets — read this before applying

`secret.example.yaml` has placeholder values and is safe to commit. Don't
edit it in place and apply it with real credentials. Generate the real
`Secret` imperatively instead:

```bash
kubectl create secret generic graphql-node-secrets -n graphql-node \
  --from-literal=JWT_SECRET="$(openssl rand -base64 48)" \
  --from-literal=DATABASE_USER=graphql_user \
  --from-literal=DATABASE_PASSWORD="$(openssl rand -base64 24)" \
  --from-literal=MYSQL_ROOT_PASSWORD="$(openssl rand -base64 24)"
```

`k8s/secret.yaml` and `k8s/*.local.yaml` are gitignored, in case you do save
a filled-in copy locally.

## Try it locally with kind

This is verified against a real [kind](https://kind.sigs.k8s.io/) cluster.
From the repo root:

```bash
# 1. Build the app image and load it into kind (no registry needed for kind)
docker build -t graphql-node-reference-architecture-app:latest .
kind create cluster --name graphql-node-test
kind load docker-image graphql-node-reference-architecture-app:latest --name graphql-node-test

# 2. Apply everything (secret.example.yaml is fine as-is for a throwaway
#    local cluster — don't do this for anything real, see above)
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secret.example.yaml
kubectl apply -f k8s/redis.yaml
kubectl apply -f k8s/kafka.yaml
kubectl apply -f k8s/mysql.yaml
kubectl apply -f k8s/mysql-replica.yaml
kubectl apply -f k8s/app.yaml
kubectl apply -f k8s/hpa.yaml

# 3. Watch it come up
kubectl -n graphql-node get pods -w
```

Migrations are a separate step here too, same as for Docker Compose — the
app image only serves GraphQL, it doesn't migrate on boot:

```bash
kubectl -n graphql-node port-forward svc/mysql 13306:3306 &
DATABASE_HOST=127.0.0.1 DATABASE_PORT=13306 DATABASE_NAME=graphql_mysql \
  DATABASE_USER=graphql_user DATABASE_PASSWORD=change-me \
  NODE_ENV=development npm run db:setup
```

Then hit the app:

```bash
kubectl -n graphql-node port-forward svc/graphql-node 14003:4003 &
curl http://localhost:14003/health
curl http://localhost:14003/ready
curl -X POST http://localhost:14003/ -H 'Content-Type: application/json' \
  -d '{"query":"{ post(id: \"15\") { id title } }"}'
```

### Behavior to expect

- `REDIS_URL` is enforced at startup: without `redis.yaml` applied and
  wired into the ConfigMap, the app crash-loops with
  `Error: REDIS_URL is required in production for GraphQL subscriptions`.
- Readiness is gated on a real DB check — `kubectl get pods` won't show
  `1/1 Ready` until the app can reach MySQL, and a `post` query through the
  `Service` (not a direct pod IP) returns real seeded data once it is.
- `/metrics` on any pod exposes real `http_request_duration_seconds`
  samples.
- Kafka is genuinely distributed across the app's 2 replicas, not just
  configured: verified directly by running a `createComment` mutation
  against one pod's `/metrics` (its `kafka_messages_produced_total` goes
  up) and finding `kafka_messages_consumed_total` incremented on the
  *other* pod instead — that pod's consumer group member owns the
  partition, so a subscriber connected to either replica gets the
  real-time push regardless of which one served the mutation.
- The HPA needs a metrics source to compute anything: without
  metrics-server, `kubectl describe hpa` reports `FailedGetResourceMetric
  ... the server could not find the requested resource
  (get pods.metrics.k8s.io)` and `kubectl get hpa` shows `<unknown>` — kind
  ships no metrics pipeline by default (see below).

## Read replica

`mysql-replica.yaml` sets up real GTID-based MySQL replication — not a
second copy of the schema, an actual streaming replica of `mysql.yaml`'s
primary. An init script on the primary creates a `repl` account
(`REPLICATION SLAVE` only); an init script on the replica points
`CHANGE REPLICATION SOURCE` at the primary with `SOURCE_AUTO_POSITION=1`
and starts replicating, then sets `read_only`/`super_read_only` via
`SET PERSIST` rather than a `--read-only` startup flag — a startup flag
would also apply to the entrypoint's own temporary bootstrap server and
block `CHANGE REPLICATION SOURCE` from running at all. An `initContainer`
blocks the replica pod from starting until the primary is actually
reachable, since the init script only ever runs once, at first start, with
no retry of its own.

Check it's actually replicating:

```bash
kubectl -n graphql-node exec deploy/mysql-replica -- \
  mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "SHOW REPLICA STATUS\G" | \
  grep -E "Replica_IO_Running|Replica_SQL_Running|Seconds_Behind"
# Replica_IO_Running: Yes / Replica_SQL_Running: Yes / Seconds_Behind_Source: 0
```

Verified directly, including that the app actually reads from it (not just
that replication is configured): logged in, ran `STOP REPLICA` on the
replica, created a post through the app (write path, goes to the primary),
queried the post list through the app (read path) and — with replication
frozen — the new post was missing from the results despite sorting by id
descending. `START REPLICA` again, same query, and it appeared. If the app
were reading the primary for that query instead, the post would have shown
up immediately in both cases.

This is a from-scratch pairing: the replica's `SOURCE_AUTO_POSITION=1`
replays the primary's binlog from GTID zero, which only works because
both start together (or the replica starts against a primary whose binlog
hasn't been purged yet). Adding a replica to an already-running primary
later would need a data snapshot (`mysqldump`/`XtraBackup`) first — out of
scope for this demo setup.

### HPA needs metrics-server

kind doesn't ship one. To make `hpa.yaml` actually compute something
instead of sitting at `<unknown>`:

```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
# kind's kubelet serving certs aren't verifiable by metrics-server's default
# TLS config — this is a kind-only workaround, not something you'd do
# against a real cluster with properly signed kubelet certs:
kubectl -n kube-system patch deployment metrics-server --type='json' \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
```

### Load-testing the HPA

The [k6 load test](../loadtest/graphql-load-test.js) used against Docker
Compose (see the root README's [Load
tests](../readme.md#load-tests-npm-run-loadtest) section) isn't specific to
any one deployment target — point it at the port-forwarded Service instead
of `localhost:4003` and it exercises the real k8s `Deployment`/`Service`/
probes/HPA instead of a single container:

```bash
kubectl -n graphql-node port-forward svc/graphql-node 14003:4003 &
BASE_URL=http://localhost:14003 k6 run ../loadtest/graphql-load-test.js
```

Watch it scale in another terminal while that runs:

```bash
kubectl -n graphql-node get hpa graphql-node -w
```

Verified against a real kind cluster (with metrics-server installed as
above): the full (non-`SMOKE_TEST`) run's `happy_path_reads` ramp pushed
both pods past the 70% CPU target within ~25s, the HPA added a third
replica within the next scrape interval, and all of k6's thresholds
(`happy_path_unexpected_errors`, the three `sad_path_*_rejected` rates,
`http_req_duration{scenario:happy_path_reads}`) still passed while it did —
i.e. the extra pod came up and started serving before the existing ones
were overwhelmed. Replicas stay up for the HPA's default 5-minute
scale-down stabilization window after load drops, so don't expect an
immediate scale-back to 2.

**This doesn't scale writes past MySQL.** More app pods means more
concurrent callers against `mysql.yaml`'s single primary, each pod
bringing its own `DATABASE_POOL_MAX` (10) connections. At 6 pods that's up
to 60 connections into one instance — the [root README's stress
test](../readme.md#stress-test-npm-run-stresstest) found that single
instance, not app CPU, was the ceiling under heavy concurrent load. The
HPA is a real, working answer to CPU-bound spikes; it isn't an answer to a
saturated *primary* on its own — apply `mysql-replica.yaml` (see [Read
replica](#read-replica) below) to move list/browse queries and DataLoader
batch reads off it, or raise `DATABASE_POOL_MAX` up to MySQL's own
`max_connections`. Writes still funnel through the one primary either
way — that's a sharding/multi-primary problem this manifest set doesn't
attempt to solve.

### Cleanup

```bash
kind delete cluster --name graphql-node-test
```

## CI validation

The `k8s-lint` job in [`../.github/workflows/ci.yml`](../.github/workflows/ci.yml)
runs [kubeconform](https://github.com/yannh/kubeconform) against every
manifest here on every push — schema-only, no cluster needed, so it
validates manifest correctness (wrong field type, unknown field in
`-strict` mode) but not runtime requirements like `REDIS_URL`, which only
a real cluster can exercise.

## Outside of kind

- Push the image to a real registry and change `app.yaml`'s `image:` (and
  drop `imagePullPolicy: IfNotPresent`, which is a kind-loaded-image
  convenience).
- A managed database (RDS, Cloud SQL, PlanetScale, ...) is a better fit
  than `mysql.yaml` for anything beyond a demo — swap `DATABASE_HOST` in
  `configmap.yaml` and drop the MySQL `Deployment`/PVC entirely.
- No `Ingress` is included — this is meant to be fronted by whatever your
  cluster already uses (nginx-ingress, a cloud load balancer, etc.); the
  `Service` here is deliberately just `ClusterIP`.
