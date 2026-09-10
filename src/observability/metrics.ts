import {
  Registry,
  Counter,
  Histogram,
  collectDefaultMetrics,
} from '@prometheus-io/client';
import type { Request, Response, NextFunction } from 'express';

export const register = new Registry();
collectDefaultMetrics({ register });

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

// Labeled by operation *type* (query/mutation/subscription), not operation
// name — an unbounded/attacker-controlled label value would blow up
// Prometheus cardinality.
export const graphqlOperationsTotal = new Counter({
  name: 'graphql_operations_total',
  help: 'Total GraphQL operations executed, by type and outcome',
  labelNames: ['operation_type', 'status'],
  registers: [register],
});

export const graphqlOperationDuration = new Histogram({
  name: 'graphql_operation_duration_seconds',
  help: 'GraphQL operation execution duration in seconds, by type',
  labelNames: ['operation_type'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

export const kafkaMessagesProducedTotal = new Counter({
  name: 'kafka_messages_produced_total',
  help: 'Total messages published to Kafka, by topic',
  labelNames: ['topic'],
  registers: [register],
});

export const kafkaMessagesConsumedTotal = new Counter({
  name: 'kafka_messages_consumed_total',
  help: 'Total messages consumed from Kafka, by topic and outcome',
  labelNames: ['topic', 'status'],
  registers: [register],
});

// route is the raw path, not the id-bearing GraphQL path (there's only one
// GraphQL endpoint), so this stays low-cardinality without extra work.
export const httpMetricsMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const stopTimer = httpRequestDuration.startTimer({
    method: req.method,
    route: req.path,
  });

  res.on('finish', () => {
    stopTimer({ status_code: String(res.statusCode) });
  });

  next();
};

export const metricsHandler = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
};
