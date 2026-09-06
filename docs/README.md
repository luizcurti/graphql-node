# Documentation

Diagrams and deeper explanations of how the pieces of this API fit together.

| Doc | What it shows |
|---|---|
| [`architecture.md`](./architecture.md) | The whole system in one picture: Express, Apollo Server (HTTP + WS), `context()`, resolvers, datasources, MySQL, and PubSub. Start here. |
| [`data-model.md`](./data-model.md) | Entity-relationship diagram for `users` / `posts` / `comments`, including the `ON DELETE CASCADE` chains. |
| [`auth-flow.md`](./auth-flow.md) | Sequence diagrams for login and for how every request is authenticated — why a valid JWT signature alone isn't enough, and how logout actually revokes a session. |
| [`subscriptions-flow.md`](./subscriptions-flow.md) | How `createdComment` notifies only the post's owner, in real time, over `graphql-ws` + Redis/in-memory PubSub — and how the optional Kafka event backbone (producer → topic → consumer group) feeds that same PubSub. |
| [`datasources-class-diagram.md`](./datasources-class-diagram.md) | The `SQLDatasource` base class and its subclasses, and how DataLoader batching avoids N+1 queries. |
| [`deployment.md`](./deployment.md) | Container architecture: the app + MySQL Docker Compose stack, the multi-stage `Dockerfile`, and where Redis/Kafka fit in. |

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
