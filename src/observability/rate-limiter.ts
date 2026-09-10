import rateLimit from 'express-rate-limit';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

// Off by default (dev/test/CI all run with this unset) so it never
// interferes with the e2e/API/k6-smoke suites or a manual `npm run
// loadtest` run, all of which legitimately fire many requests from one IP
// in a short window. Set RATE_LIMIT_MAX/RATE_LIMIT_WINDOW_MS in production.
export const makeRateLimiter = (): RequestHandler => {
  const max = Number(process.env.RATE_LIMIT_MAX) || 0;
  const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000;

  if (max <= 0) {
    return (_req: Request, _res: Response, next: NextFunction): void => next();
  }

  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
  });
};
