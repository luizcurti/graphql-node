import type { Request, Response } from 'express';
import {
  httpMetricsMiddleware,
  metricsHandler,
  register,
} from '../observability/metrics';

describe('httpMetricsMiddleware', () => {
  it('calls next() and records request duration when the response finishes', () => {
    const next = jest.fn();
    const handlers: Record<string, () => void> = {};
    const req = { method: 'GET', path: '/test' } as unknown as Request;
    const res = {
      statusCode: 200,
      on: jest.fn((event: string, cb: () => void) => {
        handlers[event] = cb;
      }),
    } as unknown as Response;

    httpMetricsMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));
    expect(() => handlers.finish()).not.toThrow();
  });
});

describe('metricsHandler', () => {
  it('writes the Prometheus content type and the registry body', async () => {
    const res = {
      set: jest.fn(),
      end: jest.fn(),
    } as unknown as Response;

    await metricsHandler({} as Request, res);

    expect(res.set).toHaveBeenCalledWith('Content-Type', register.contentType);
    expect(res.end).toHaveBeenCalledWith(expect.any(String));
  });
});
