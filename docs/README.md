# Documentation

Diagrams and deeper explanations of how the pieces of this API fit together.

| Doc | What it shows |
|---|---|
| [`architecture.md`](./architecture.md) | The whole system in one picture: Express, Apollo Server (HTTP + WS), `context()`, resolvers, datasources, the primary/replica split, PubSub, Kafka, Redis, and OpenTelemetry. Start here. |
| [`data-model.md`](./data-model.md) | Entity-relationship diagram for `users` / `posts` / `comments`, including the `ON DELETE CASCADE` chains. |
| [`auth-flow.md`](./auth-flow.md) | Sequence diagrams for login (including Redis-backed rate limiting) and for how every request is authenticated — why a valid JWT signature alone isn't enough, and how logout actually revokes a session. |
| [`subscriptions-flow.md`](./subscriptions-flow.md) | How `createdComment` notifies only the post's owner, in real time, over `graphql-ws` + Redis/in-memory PubSub — and how the optional Kafka event backbone (producer → topic → consumer group) feeds that same PubSub. |
| [`datasources-class-diagram.md`](./datasources-class-diagram.md) | The `SQLDatasource` base class and its subclasses, and how DataLoader batching avoids N+1 queries. |
| [`database-scaling.md`](./database-scaling.md) | Connection pool sizing and the optional read-replica pattern — which reads route to a replica, which stay on the primary, and why. |
| [`observability.md`](./observability.md) | `/metrics` (Prometheus), `/health` + `/ready`, and opt-in OpenTelemetry tracing with trace-id log correlation. |
| [`load-testing.md`](./load-testing.md) | The k6 load test — concurrent read/write scenarios plus a sad-path scenario checking auth/depth-limit/duplicate rejection under load, with a captured example run. |
| [`security-hardening.md`](./security-hardening.md) | Rate limiting that didn't survive multiple replicas, a query-complexity check that broke on its first integration attempt, CSRF protection confirmed live (not assumed), and what gitleaks found scanning this repo's own history. |
| [`deployment.md`](./deployment.md) | Container architecture: the app + MySQL Docker Compose stack, the multi-stage `Dockerfile`, and the optional Kafka/Jaeger profiles. |
| [`../k8s/README.md`](../k8s/README.md) | Kubernetes manifests (Deployment/Service/ConfigMap/Secret/HPA) — built and verified against a real kind cluster, not just written. |

For setup instructions, available scripts, environment variables, and the API
surface itself, see the [main README](../readme.md).

## Regenerating the diagrams

Each image in [`images/`](./images/) is rendered from a
[Mermaid](https://mermaid.js.org/) source file in [`diagrams/`](./diagrams/).
To edit a diagram: change its `.mmd` file, then re-render with
[`@mermaid-js/mermaid-cli`](https://github.com/mermaid-js/mermaid-cli):

```bash
npx -y @mermaid-js/mermaid-cli -i docs/diagrams/architecture.mmd -o docs/images/architecture.svg -b white -w 1600
```

(swap the filename for whichever diagram changed).
