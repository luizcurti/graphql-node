# Kubernetes Manifests

Plain YAML (no Helm/Kustomize) demonstrating how this app maps onto
Kubernetes: `Deployment` + `Service` for the app, a single-instance MySQL
and Redis alongside it, `ConfigMap`/`Secret` for configuration,
liveness/readiness probes wired to the endpoints in
[`../docs/observability.md`](../docs/observability.md), and an HPA.

| File | What it creates |
|---|---|
| `namespace.yaml` | The `graphql-node` namespace everything else lives in |
| `configmap.yaml` | Non-secret env vars (mirrors `.env.example`) |
| `secret.example.yaml` | **Template only** — see below before applying |
| `mysql.yaml` | MySQL `Deployment` + `PersistentVolumeClaim` + `Service` |
| `redis.yaml` | Redis `Deployment` + `Service` — required in production for PubSub, also backs the distributed login rate limiter (see `../docs/security-hardening.md`) |
| `app.yaml` | The app's `Deployment` (2 replicas) + `Service` |
| `hpa.yaml` | `HorizontalPodAutoscaler` targeting 70% CPU, 2–6 replicas |

Kafka, an OpenTelemetry collector, and a read replica aren't included here —
they're optional features of the app itself (see `configmap.yaml`'s
commented-out block) and adding cluster infrastructure for all of them would
triple this directory's size for features most people evaluating this repo
won't turn on. Point `KAFKA_BROKERS` / `OTEL_EXPORTER_OTLP_ENDPOINT` /
`DATABASE_REPLICA_HOST` at whatever you're already running instead.

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

This was built and verified against a real [kind](https://kind.sigs.k8s.io/)
cluster — not just written and assumed correct. From the repo root:

```bash
# 1. Build the app image and load it into kind (no registry needed for kind)
docker build -t apollo-graphql-starter-app:latest .
kind create cluster --name graphql-node-test
kind load docker-image apollo-graphql-starter-app:latest --name graphql-node-test

# 2. Apply everything (secret.example.yaml is fine as-is for a throwaway
#    local cluster — don't do this for anything real, see above)
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secret.example.yaml
kubectl apply -f k8s/redis.yaml
kubectl apply -f k8s/mysql.yaml
kubectl apply -f k8s/app.yaml
kubectl apply -f k8s/hpa.yaml

# 3. Watch it come up
kubectl -n graphql-node get pods -w
```

Migrations are a separate step here too, same as
[`../docs/deployment.md`](../docs/deployment.md) for Docker Compose — the
app image only serves GraphQL, it doesn't migrate on boot:

```bash
kubectl -n graphql-node port-forward svc/mysql 13306:3306 &
DATABASE_HOST=127.0.0.1 DATABASE_PORT=13306 DATABASE_USER=graphql_user \
  DATABASE_PASSWORD=change-me NODE_ENV=development npm run db:setup
```

Then hit the app:

```bash
kubectl -n graphql-node port-forward svc/graphql-node 14003:4003 &
curl http://localhost:14003/health
curl http://localhost:14003/ready
curl -X POST http://localhost:14003/ -H 'Content-Type: application/json' \
  -d '{"query":"{ post(id: \"15\") { id title } }"}'
```

### What was actually confirmed, not assumed

- `REDIS_URL` really is enforced: the app crash-looped with
  `Error: REDIS_URL is required in production for GraphQL subscriptions`
  until `redis.yaml` was applied and wired into the ConfigMap — the same
  check documented in [`../docs/subscriptions-flow.md`](../docs/subscriptions-flow.md)
  firing for real, not just in a unit test.
- Both app replicas reached `1/1 Ready` off the `/ready` probe, and a
  `post` query through the `Service` (not a direct pod IP) returned real
  seeded data.
- `/metrics` on the live pod showed real `http_request_duration_seconds`
  samples for the requests above.
- The HPA is genuinely inert without a metrics source: right after
  `kubectl apply`, `kubectl describe hpa` reported
  `FailedGetResourceMetric ... the server could not find the requested
  resource (get pods.metrics.k8s.io)` — expected, since kind ships no
  metrics pipeline by default. Installing metrics-server (below) fixed it;
  `kubectl get hpa` then reported a real value (`cpu: 9%/70%`) instead of
  `<unknown>`.

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

### Cleanup

```bash
kind delete cluster --name graphql-node-test
```

## CI validation

The `k8s-lint` job in [`../.github/workflows/ci.yml`](../.github/workflows/ci.yml)
runs [kubeconform](https://github.com/yannh/kubeconform) against every
manifest here on every push — schema-only, no cluster needed, so it can't
catch the `REDIS_URL` issue above (that only showed up against a real
kind cluster), but it does catch a manifest that's simply malformed
(wrong field type, unknown field in `-strict` mode) before anyone tries to
apply it.

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
