import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

// Optional shared-secret gate on /metrics — same additive-optional pattern
// as REDIS_URL/KAFKA_BROKERS elsewhere: unset in dev, so the endpoint stays
// open for a local Prometheus/curl check; set it in production so the
// process's Node version, memory, and request-rate fingerprint aren't
// world-readable. Prefer a network policy/reverse-proxy rule in addition to
// this where possible.
export const makeMetricsAuthMiddleware = (token: string | undefined) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!token) {
      next();
      return;
    }

    const provided = req.get('x-metrics-token') || '';
    const expected = Buffer.from(token);
    const actual = Buffer.from(provided);
    // Length check first: timingSafeEqual throws (rather than returning
    // false) when the buffers differ in length, so it can't be called
    // directly against attacker-controlled input.
    const isValid =
      expected.length === actual.length &&
      crypto.timingSafeEqual(expected, actual);

    if (!isValid) {
      res.status(401).json({ status: 'unauthorized' });
      return;
    }
    next();
  };
};
