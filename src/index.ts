import http from 'http';
import express, { json } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@as-integrations/express5';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/use/ws';
import depthLimit from 'graphql-depth-limit';

import { logger } from './utils/logger';
import { context } from './graphql/context';
import type { Context } from './graphql/context/types';
import { resolvers, typeDefs } from './graphql/schema';
import { startCommentConsumer, stopCommentConsumer } from './kafka/consumer';
import { disconnectProducer } from './kafka/producer';
import { knex } from './knex';
import { disconnectRedisClient } from './redis';
import { shutdownTracing } from './observability/tracing';
import { metricsPlugin } from './observability/apollo-plugin';
import { httpMetricsMiddleware, metricsHandler } from './observability/metrics';
import { livenessHandler, makeReadinessHandler } from './observability/health';
import { complexityLimitPlugin } from './graphql/complexity-limit';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  logger.fatal(
    'JWT_SECRET is missing or too short (min 32 characters). Exiting.',
  );
  process.exit(1);
}

const schema = makeExecutableSchema({ typeDefs, resolvers });

const app = express();
const httpServer = http.createServer(app);

const wsServer = new WebSocketServer({ server: httpServer, path: '/' });

const serverCleanup = useServer(
  {
    schema,
    context: async (ctx) =>
      context({ req: ctx.extra.request, connection: true }),
  },
  wsServer,
);

const server = new ApolloServer<Context>({
  schema,
  introspection: process.env.NODE_ENV !== 'production',
  // Explicit, not just relying on the default: login sets its cookie with
  // sameSite: 'none' (see graphql/schema/login/datasources.ts), so this is
  // the thing standing between that cookie and a cross-site request forgery
  // using a "simple" request (text/plain or form-urlencoded body) that
  // skips the CORS preflight our origin allowlist would otherwise catch.
  // Verified directly: both are rejected with a CSRF error — see
  // docs/security-hardening.md.
  csrfPrevention: true,
  validationRules: [depthLimit(7)],
  plugins: [
    ApolloServerPluginDrainHttpServer({ httpServer }),
    metricsPlugin,
    complexityLimitPlugin,
    {
      async serverWillStart() {
        return {
          async drainServer() {
            await serverCleanup.dispose();
            await stopCommentConsumer();
            await disconnectProducer();
            await shutdownTracing();
            await disconnectRedisClient();
          },
        };
      },
    },
  ],
});

const start = async (): Promise<void> => {
  await server.start();
  await startCommentConsumer();

  app.use(httpMetricsMiddleware);
  app.get('/health', livenessHandler);
  app.get('/ready', makeReadinessHandler(knex));
  app.get('/metrics', metricsHandler);

  app.use(
    '/',
    cors({
      origin: process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(',')
        : [],
      credentials: true,
    }),
    cookieParser(),
    json(),
    expressMiddleware(server, {
      context: async ({ req, res }) => context({ req, res }),
    }),
  );

  const port = process.env.PORT || 4003;
  httpServer.listen(port, () => {
    logger.info(`Server listening on http://localhost:${port}/`);
  });
};

start();
