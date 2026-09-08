import bcrypt from 'bcrypt';
import { LoginApi } from '../graphql/schema/login/datasources';
import { loginResolvers } from '../graphql/schema/login/resolvers';
import { AuthenticationError, UserInputError } from '../graphql/errors';
import { getRedisClient } from '../redis';
import type { Context } from '../graphql/context/types';

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(() => 'mock-jwt-token'),
}));

// Defaults every test to the in-memory rate limiter (REDIS_URL unset in
// practice); individual tests below override this to exercise the
// Redis-backed path instead.
jest.mock('../redis', () => ({
  getRedisClient: jest.fn(() => null),
  disconnectRedisClient: jest.fn(),
}));

const mockUserDb = {
  getUserByUserName: jest.fn(),
  setToken: jest.fn(),
  clearToken: jest.fn(),
};

const mockRes = {
  cookie: jest.fn(),
  clearCookie: jest.fn(),
};

const makeApi = (loggedUserId = ''): LoginApi => {
  const api = new LoginApi();
  api.initialize({
    context: {
      loggedUserId,
      res: mockRes,
      dataSources: { userDb: mockUserDb },
    } as unknown as Context,
  });
  return api;
};

beforeEach(() => {
  jest.clearAllMocks();
  (getRedisClient as jest.Mock).mockReturnValue(null);
});

// ─── Login ───────────────────────────────────────────────────────────────────

describe('LoginApi.login — user does not exist', () => {
  it('throws AuthenticationError', async () => {
    mockUserDb.getUserByUserName.mockResolvedValue(null);

    await expect(makeApi().login('ghost', 'Pass1!')).rejects.toThrow(
      AuthenticationError,
    );
  });
});

describe('LoginApi.login — wrong password', () => {
  it('throws AuthenticationError', async () => {
    const hash = await bcrypt.hash('CorrectPass1', 1);
    mockUserDb.getUserByUserName.mockResolvedValue({
      id: '1',
      passwordHash: hash,
    });

    await expect(makeApi().login('alice_login', 'WrongPass1')).rejects.toThrow(
      AuthenticationError,
    );
  });
});

describe('LoginApi.login — valid credentials', () => {
  it('returns userId and token, and sets an httpOnly cookie', async () => {
    const hash = await bcrypt.hash('ValidPass1', 1);
    mockUserDb.getUserByUserName.mockResolvedValue({
      id: '42',
      passwordHash: hash,
    });
    mockUserDb.setToken.mockResolvedValue(undefined);

    const result = await makeApi().login('alice_ok', 'ValidPass1');

    expect(result).toEqual({ userId: '42', token: 'mock-jwt-token' });
    expect(mockUserDb.setToken).toHaveBeenCalledWith('42', 'mock-jwt-token');
    expect(mockRes.cookie).toHaveBeenCalledWith(
      'jwtToken',
      'mock-jwt-token',
      expect.objectContaining({ httpOnly: true, secure: true }),
    );
  });
});

describe('LoginApi.login — rate limiting', () => {
  it('blocks the 6th attempt with UserInputError', async () => {
    // Uses a unique username so it doesn't interfere with other tests
    const username = `rate_limit_test_${Date.now()}`;
    mockUserDb.getUserByUserName.mockResolvedValue(null);

    // 5 attempts allowed (fail with AuthenticationError — user not found)
    for (let i = 0; i < 5; i++) {
      await expect(makeApi().login(username, 'Pass1!')).rejects.toThrow(
        AuthenticationError,
      );
    }

    // 6th attempt: blocked by rate limiting
    await expect(makeApi().login(username, 'Pass1!')).rejects.toThrow(
      UserInputError,
    );
  });

  it('resets the counter after a successful login', async () => {
    const username = `rate_reset_${Date.now()}`;
    const hash = await bcrypt.hash('ValidPass1', 1);

    // Simulates a few failed attempts
    mockUserDb.getUserByUserName.mockResolvedValueOnce(null);
    mockUserDb.getUserByUserName.mockResolvedValueOnce(null);
    // Third: success
    mockUserDb.getUserByUserName.mockResolvedValue({
      id: '5',
      passwordHash: hash,
    });
    mockUserDb.setToken.mockResolvedValue(undefined);

    await expect(makeApi().login(username, 'Pass1!')).rejects.toThrow(
      AuthenticationError,
    );
    await expect(makeApi().login(username, 'Pass1!')).rejects.toThrow(
      AuthenticationError,
    );

    // Logging in with the correct password resets the counter
    await expect(makeApi().login(username, 'ValidPass1')).resolves.toEqual({
      userId: '5',
      token: 'mock-jwt-token',
    });

    // Can now try again normally (counter reset)
    mockUserDb.getUserByUserName.mockResolvedValue(null);
    await expect(makeApi().login(username, 'Pass1!')).rejects.toThrow(
      AuthenticationError,
    );
  });
});

describe('LoginApi.login — rate limiting (Redis-backed)', () => {
  const makeRedisClient = () => ({
    incr: jest.fn(),
    pexpire: jest.fn().mockResolvedValue(1),
    pttl: jest.fn().mockResolvedValue(120000),
    del: jest.fn().mockResolvedValue(1),
  });

  it('sets an expiry on the first attempt and blocks after 5', async () => {
    const redis = makeRedisClient();
    (getRedisClient as jest.Mock).mockReturnValue(redis);
    mockUserDb.getUserByUserName.mockResolvedValue(null);

    redis.incr.mockResolvedValueOnce(1);
    await expect(makeApi().login('redis_user', 'x')).rejects.toThrow(
      AuthenticationError,
    );
    expect(redis.pexpire).toHaveBeenCalledWith(
      'login-attempts:redis_user',
      15 * 60 * 1000,
    );

    for (const attempt of [2, 3, 4, 5]) {
      redis.incr.mockResolvedValueOnce(attempt);
      await expect(makeApi().login('redis_user', 'x')).rejects.toThrow(
        AuthenticationError,
      );
    }
    expect(redis.pexpire).toHaveBeenCalledTimes(1); // only on the 1st attempt

    redis.incr.mockResolvedValueOnce(6);
    await expect(makeApi().login('redis_user', 'x')).rejects.toThrow(
      UserInputError,
    );
    expect(redis.pttl).toHaveBeenCalledWith('login-attempts:redis_user');
  });

  it('clears the Redis counter after a successful login', async () => {
    const redis = makeRedisClient();
    redis.incr.mockResolvedValue(1);
    (getRedisClient as jest.Mock).mockReturnValue(redis);

    const hash = await bcrypt.hash('ValidPass1', 1);
    mockUserDb.getUserByUserName.mockResolvedValue({
      id: '7',
      passwordHash: hash,
    });
    mockUserDb.setToken.mockResolvedValue(undefined);

    await makeApi().login('redis_ok', 'ValidPass1');

    expect(redis.del).toHaveBeenCalledWith('login-attempts:redis_ok');
  });
});

// ─── Logout ──────────────────────────────────────────────────────────────────

describe('LoginApi.logout — not authenticated', () => {
  it('throws AuthenticationError', async () => {
    await expect(makeApi('').logout('alice')).rejects.toThrow(
      AuthenticationError,
    );
  });
});

describe('LoginApi.logout — user different from the logged-in one', () => {
  it('throws AuthenticationError', async () => {
    mockUserDb.getUserByUserName.mockResolvedValue({ id: '99' });

    await expect(makeApi('1').logout('other')).rejects.toThrow(
      AuthenticationError,
    );
  });
});

describe('LoginApi.logout — success', () => {
  it('clears the token in the DB and the cookie', async () => {
    mockUserDb.getUserByUserName.mockResolvedValue({ id: '1' });
    mockUserDb.clearToken.mockResolvedValue(undefined);

    const result = await makeApi('1').logout('alice');

    expect(result).toBe(true);
    expect(mockUserDb.clearToken).toHaveBeenCalledWith('1');
    expect(mockRes.clearCookie).toHaveBeenCalledWith('jwtToken');
  });
});

// ─── Login Resolvers (delegation to LoginApi) ────────────────────────────────

describe('Mutation.login (resolver)', () => {
  it('delegates to loginApi.login with userName and password', async () => {
    const mockLoginApi = {
      login: jest.fn().mockResolvedValue({ userId: '1' }),
    };
    const ctx = {
      dataSources: { loginApi: mockLoginApi },
    } as unknown as Context;

    const result = await loginResolvers.Mutation.login(
      null,
      { data: { userName: 'alice', password: 'Pass1!' } },
      ctx,
    );

    expect(mockLoginApi.login).toHaveBeenCalledWith('alice', 'Pass1!');
    expect(result).toEqual({ userId: '1' });
  });
});

describe('Mutation.logout (resolver)', () => {
  it('delegates to loginApi.logout with userName', async () => {
    const mockLoginApi = { logout: jest.fn().mockResolvedValue(true) };
    const ctx = {
      dataSources: { loginApi: mockLoginApi },
    } as unknown as Context;

    const result = await loginResolvers.Mutation.logout(
      null,
      { userName: 'alice' },
      ctx,
    );

    expect(mockLoginApi.logout).toHaveBeenCalledWith('alice');
    expect(result).toBe(true);
  });
});
