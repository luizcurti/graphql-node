import type { Request, Response } from 'express';
import type { Knex } from 'knex';
import { logger } from '../utils/logger';

// Liveness: the process is up and the event loop is responsive. No
// dependency checks — a flapping DB/Redis/Kafka should not make an
// orchestrator kill and restart an otherwise-healthy pod.
export const livenessHandler = (_req: Request, res: Response): void => {
  res.status(200).json({ status: 'ok' });
};

// Readiness: can this instance actually serve traffic right now? Checked
// against the primary write connection only — the one dependency every
// request needs regardless of which optional features (Redis/Kafka/replica)
// are configured.
export const makeReadinessHandler = (db: Knex) => {
  return async (_req: Request, res: Response): Promise<void> => {
    try {
      await db.raw('SELECT 1');
      res.status(200).json({ status: 'ok' });
    } catch (error) {
      logger.error({ err: (error as Error).message }, 'Readiness check failed');
      res.status(503).json({ status: 'unavailable' });
    }
  };
};
