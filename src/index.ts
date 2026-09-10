import http from 'http';
import express, { json } from 'express';
import cors from 'cors';
import helmet from 'helmet';
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
import { formatGraphQLError } from './graphql/format-error';
import { startCommentConsumer, stopCommentConsumer } from './kafka/consumer';
import { disconnectProducer } from './kafka/producer';
import { knex, destroyKnexConnections } from './knex';
import { disconnectRedisClient } from './redis';
import { shutdownTracing } from './observability/tracing';
import { metricsPlugin } from './observability/apollo-plugin';
import { httpMetricsMiddleware, metricsHandler } from './observability/metrics';
import { makeMetricsAuthMiddleware } from './observability/metrics-auth';
import { makeRateLimiter } from './observability/rate-limiter';
import { livenessHandler, makeReadinessHandler } from './observability/health';
import { complexityLimitPlugin } from './graphql/complexity-limit';

const QUERY_DEPTH_LIMIT = Number(process.env.QUERY_DEPTH_LIMIT) || 7;

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
  // Verified directly: both are rejected with a CSRF error.
  csrfPrevention: true,
  validationRules: [depthLimit(QUERY_DEPTH_LIMIT)],
  formatError: formatGraphQLError,
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
            await destroyKnexConnections();
          },
        };
      },
    },
  ],
});

const metricsAuth = makeMetricsAuthMiddleware(process.env.METRICS_TOKEN);

// Applied to every route (not just '/'), so ops endpoints don't quietly ship
// with no CORS policy at all.
const corsMiddleware = cors({
  origin: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : [],
  credentials: true,
});

const rateLimiter = makeRateLimiter();

const start = async (): Promise<void> => {
  await server.start();
  await startCommentConsumer();

  // A blanket `contentSecurityPolicy: false` (the previous approach here)
  // is flagged by CodeQL's insecure-helmet-configuration check, and for
  // good reason — it disables CSP for every response, including ones that
  // don't need the exception. The actual need is narrow: Apollo Server's
  // dev-only landing page (never served when NODE_ENV=production, see
  // `introspection` above) embeds a sandbox iframe from Apollo's own CDN,
  // which the default CSP would otherwise block. Allowlisting just those
  // origins (Apollo's own documented values for this) keeps CSP's default
  // protections everywhere else instead of switching it off entirely.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          'script-src': [
            "'self'",
            'https://embeddable-sandbox.cdn.apollographql.com',
          ],
          'frame-src': ["'self'", 'https://sandbox.embed.apollographql.com'],
          'img-src': [
            "'self'",
            'https://apollo-server-landing-page.cdn.apollographql.com',
            'data:',
          ],
          'manifest-src': [
            "'self'",
            'https://apollo-server-landing-page.cdn.apollographql.com',
          ],
        },
      },
    }),
  );
  app.use(corsMiddleware);
  app.use(httpMetricsMiddleware);
  app.use(rateLimiter);

  app.get('/health', livenessHandler);
  app.get('/ready', makeReadinessHandler(knex));
  app.get('/metrics', metricsAuth, metricsHandler);

  app.use(
    '/',
    cookieParser(),
    json({ limit: process.env.JSON_BODY_LIMIT || '100kb' }),
    expressMiddleware(server, {
      context: async ({ req, res }) => context({ req, res }),
    }),
  );

  const port = process.env.PORT || 4003;
  httpServer.listen(port, () => {
    logger.info(`Server listening on http://localhost:${port}/`);
  });
};

// Kubernetes/Docker send SIGTERM on a normal stop/redeploy; without handling
// it explicitly, nothing ever calls server.stop() — which is what actually
// runs ApolloServerPluginDrainHttpServer (stop accepting new connections,
// drain keep-alive ones, then close the HTTP server) and our own
// drainServer hook above (Kafka/Redis/knex cleanup). A bare, unhandled
// SIGTERM would instead let the OS kill the process mid-request and leak
// the DB pool(s).
let shuttingDown = false;
const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info(`${signal} received, shutting down gracefully`);
  try {
    await server.stop();
    process.exit(0);
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'Error during shutdown');
    process.exit(1);
  }
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

start();
