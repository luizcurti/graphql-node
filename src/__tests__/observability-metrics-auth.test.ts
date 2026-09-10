import { makeMetricsAuthMiddleware } from '../observability/metrics-auth';

const makeReqRes = (headerValue?: string) => {
  const req = { get: jest.fn().mockReturnValue(headerValue) } as any;
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as any;
  const next = jest.fn();
  return { req, res, next };
};

describe('makeMetricsAuthMiddleware — happy path', () => {
  it('calls next() unconditionally when no token is configured', () => {
    const middleware = makeMetricsAuthMiddleware(undefined);
    const { req, res, next } = makeReqRes();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('calls next() when the provided header matches the configured token', () => {
    const middleware = makeMetricsAuthMiddleware('super-secret-token');
    const { req, res, next } = makeReqRes('super-secret-token');

    middleware(req, res, next);

    expect(req.get).toHaveBeenCalledWith('x-metrics-token');
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('makeMetricsAuthMiddleware — sad path', () => {
  it('returns 401 when no header is sent but a token is configured', () => {
    const middleware = makeMetricsAuthMiddleware('super-secret-token');
    const { req, res, next } = makeReqRes(undefined);

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ status: 'unauthorized' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when the header value is wrong', () => {
    const middleware = makeMetricsAuthMiddleware('super-secret-token');
    const { req, res, next } = makeReqRes('wrong-token');

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when the header value has a different length than the token', () => {
    const middleware = makeMetricsAuthMiddleware('super-secret-token');
    const { req, res, next } = makeReqRes('short');

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
