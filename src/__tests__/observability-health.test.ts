import type { Request, Response } from 'express';
import type { Knex } from 'knex';
import { livenessHandler, makeReadinessHandler } from '../observability/health';

describe('livenessHandler', () => {
  it('always returns 200 ok', () => {
    const json = jest.fn();
    const res = { status: jest.fn(() => ({ json })) } as unknown as Response;

    livenessHandler({} as Request, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ status: 'ok' });
  });
});

describe('makeReadinessHandler', () => {
  it('returns 200 ok when the database responds', async () => {
    const raw = jest.fn().mockResolvedValue(undefined);
    const json = jest.fn();
    const res = { status: jest.fn(() => ({ json })) } as unknown as Response;

    await makeReadinessHandler({ raw } as unknown as Knex)({} as Request, res);

    expect(raw).toHaveBeenCalledWith('SELECT 1');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ status: 'ok' });
  });

  it('returns 503 unavailable when the database is unreachable', async () => {
    const raw = jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));
    const json = jest.fn();
    const res = { status: jest.fn(() => ({ json })) } as unknown as Response;

    await makeReadinessHandler({ raw } as unknown as Knex)({} as Request, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith({ status: 'unavailable' });
  });
});
