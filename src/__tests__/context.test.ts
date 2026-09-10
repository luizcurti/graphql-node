import jwt from 'jsonwebtoken';

const mockGetUser = jest.fn();

jest.mock('../knex/', () => ({ knex: {} }));

jest.mock('../graphql/schema/user/sql-datasource', () => ({
  UserSQLDataSource: jest.fn().mockImplementation(() => ({
    initialize: jest.fn(),
    getUser: mockGetUser,
  })),
}));

jest.mock('jsonwebtoken');

const mockGetCachedUserId = jest.fn();
const mockCacheUserId = jest.fn();
jest.mock('../graphql/context/token-cache', () => ({
  getCachedUserId: (...args: unknown[]) => mockGetCachedUserId(...args),
  cacheUserId: (...args: unknown[]) => mockCacheUserId(...args),
}));

import { context } from '../graphql/context';

describe('context()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = 'test-secret-at-least-32-chars-long!!';
    mockGetCachedUserId.mockResolvedValue(null);
    mockCacheUserId.mockResolvedValue(undefined);
  });

  it('returns an empty loggedUserId when there is no req', async () => {
    const ctx = await context({});
    expect(ctx.loggedUserId).toBe('');
    expect(ctx.dataSources.userDb).toBeDefined();
    expect(ctx.dataSources.postDb).toBeDefined();
    expect(ctx.dataSources.commentDb).toBeDefined();
    expect(ctx.dataSources.loginApi).toBeDefined();
  });

  it('does not create loginApi when connection=true (websocket)', async () => {
    const ctx = await context({ connection: true });
    expect(ctx.dataSources.loginApi).toBeUndefined();
  });

  it('forwards res to the context when provided', async () => {
    const res = { cookie: jest.fn() };
    const ctx = await context({ res: res as never });
    expect(ctx.res).toBe(res);
  });

  it('authenticates via a valid Bearer token', async () => {
    (jwt.verify as jest.Mock).mockReturnValue({ userId: '42' });
    mockGetUser.mockResolvedValue({ id: '42', token: 'good-token' });

    const ctx = await context({
      req: { headers: { authorization: 'Bearer good-token' } },
    });

    expect(ctx.loggedUserId).toBe('42');
    expect(mockGetUser).toHaveBeenCalledWith('42');
  });

  it('exposes the raw token on the context, and caches it, once authenticated', async () => {
    (jwt.verify as jest.Mock).mockReturnValue({ userId: '42' });
    mockGetUser.mockResolvedValue({ id: '42', token: 'good-token' });

    const ctx = await context({
      req: { headers: { authorization: 'Bearer good-token' } },
    });

    expect(ctx.loggedUserToken).toBe('good-token');
    expect(mockCacheUserId).toHaveBeenCalledWith('good-token', '42');
  });

  it('does not expose a token on the context when unauthenticated', async () => {
    const ctx = await context({
      req: { headers: { authorization: 'Bearer whatever' } },
    });

    expect(ctx.loggedUserToken).toBeUndefined();
  });

  it('skips the DB lookup entirely on a JWT cache hit', async () => {
    (jwt.verify as jest.Mock).mockReturnValue({ userId: '42' });
    mockGetCachedUserId.mockResolvedValue('42');

    const ctx = await context({
      req: { headers: { authorization: 'Bearer good-token' } },
    });

    expect(ctx.loggedUserId).toBe('42');
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(mockCacheUserId).not.toHaveBeenCalled();
  });

  it('returns empty when the token stored in the database does not match the request token', async () => {
    (jwt.verify as jest.Mock).mockReturnValue({ userId: '42' });
    mockGetUser.mockResolvedValue({ id: '42', token: 'different-token' });

    const ctx = await context({
      req: { headers: { authorization: 'Bearer good-token' } },
    });

    expect(ctx.loggedUserId).toBe('');
  });

  it('returns empty when the user does not exist in the database', async () => {
    (jwt.verify as jest.Mock).mockReturnValue({ userId: '999' });
    mockGetUser.mockResolvedValue(null);

    const ctx = await context({
      req: { headers: { authorization: 'Bearer good-token' } },
    });

    expect(ctx.loggedUserId).toBe('');
  });

  it('returns empty when jwt.verify throws (invalid/expired token)', async () => {
    (jwt.verify as jest.Mock).mockImplementation(() => {
      throw new Error('invalid signature');
    });

    const ctx = await context({
      req: { headers: { authorization: 'Bearer bad-token' } },
    });

    expect(ctx.loggedUserId).toBe('');
  });

  it('returns empty when there is neither an authorization header nor a cookie', async () => {
    const ctx = await context({ req: { headers: {} } });
    expect(ctx.loggedUserId).toBe('');
  });

  it('returns empty when parsing the authorization header throws', async () => {
    const throwsOnToString = {
      toString() {
        throw new Error('boom');
      },
    };

    const ctx = await context({
      req: { headers: { authorization: throwsOnToString as never } },
    });

    expect(ctx.loggedUserId).toBe('');
  });

  it('authenticates via the jwtToken cookie when there is no Bearer token', async () => {
    (jwt.verify as jest.Mock).mockReturnValue({ userId: '7' });
    mockGetUser.mockResolvedValue({ id: '7', token: 'cookie-token' });

    const ctx = await context({
      req: { headers: { cookie: 'jwtToken=cookie-token; other=abc' } },
    });

    expect(ctx.loggedUserId).toBe('7');
  });

  it('ignores the cookie when already authenticated via Bearer', async () => {
    (jwt.verify as jest.Mock).mockReturnValue({ userId: '7' });
    mockGetUser.mockResolvedValue({ id: '7', token: 'bearer-token' });

    const ctx = await context({
      req: {
        headers: {
          authorization: 'Bearer bearer-token',
          cookie: 'jwtToken=other-token',
        },
      },
    });

    expect(ctx.loggedUserId).toBe('7');
    expect(mockGetUser).toHaveBeenCalledTimes(1);
  });

  it('handles a non-string cookie format by returning unauthenticated', async () => {
    const ctx = await context({
      req: { headers: { cookie: ['a=b'] as never } },
    });
    expect(ctx.loggedUserId).toBe('');
  });
});
