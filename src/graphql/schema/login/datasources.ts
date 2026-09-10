import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { AuthenticationError, UserInputError } from '../../errors';
import { getRedisClient } from '../../../redis';
import { logger } from '../../../utils/logger';
import { invalidateCachedToken } from '../../context/token-cache';
import type { Context } from '../../context/types';
import type { User } from '../user/sql-datasource';

export interface LoginResult {
  userId: string;
  token: string;
}

// Used to run bcrypt.compare() even when the username doesn't exist, so a
// login attempt against a non-existent user takes roughly the same time as
// one against a real user with a wrong password — otherwise the two cases
// are both timing- and message-distinguishable, letting an attacker
// enumerate valid usernames before ever guessing a password.
const DUMMY_PASSWORD_HASH =
  '$2b$12$OxEILoCFgkiOohIiOVnaw.OzDz91KGxYAu8g8b1oeO2aETumq8pAa';

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const rateLimitKey = (userName: string): string => `login-attempts:${userName}`;

// In-memory fallback — dev/test only. REDIS_URL is required in production
// (see graphql/pubsub.ts), so every production request already goes through
// Redis below; this Map is never the source of truth once there's more than
// one instance, which is exactly why it isn't used there.
interface LoginAttemptEntry {
  count: number;
  resetAt: number;
}

const loginAttemptsMemory = new Map<string, LoginAttemptEntry>();

const checkRateLimitInMemory = (userName: string): void => {
  const now = Date.now();
  const entry = loginAttemptsMemory.get(userName);

  if (entry && now < entry.resetAt) {
    if (entry.count >= MAX_ATTEMPTS) {
      throw new UserInputError(
        `Too many login attempts. Try again in ${Math.ceil(
          (entry.resetAt - now) / 60000,
        )} minute(s).`,
      );
    }
    entry.count += 1;
  } else {
    loginAttemptsMemory.set(userName, { count: 1, resetAt: now + WINDOW_MS });
  }
};

const clearRateLimitInMemory = (userName: string): void => {
  loginAttemptsMemory.delete(userName);
};

const checkRateLimit = async (userName: string): Promise<void> => {
  const redis = getRedisClient();
  if (!redis) return checkRateLimitInMemory(userName);

  try {
    const key = rateLimitKey(userName);
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.pexpire(key, WINDOW_MS);
    }

    if (count > MAX_ATTEMPTS) {
      const ttlMs = await redis.pttl(key);
      const minutes = Math.max(1, Math.ceil(ttlMs / 60000));
      throw new UserInputError(
        `Too many login attempts. Try again in ${minutes} minute(s).`,
      );
    }
  } catch (err) {
    if (err instanceof UserInputError) throw err;

    // Redis is unreachable (maxRetriesPerRequest exhausted, see ../../../
    // redis.ts) — fail open rather than blocking every login attempt on an
    // infrastructure outage unrelated to the login itself. Rate limiting is
    // defense-in-depth, not the primary auth check.
    logger.warn(
      { err: (err as Error).message },
      'Redis-backed login rate limiting unavailable — allowing the attempt through',
    );
  }
};

const clearRateLimit = async (userName: string): Promise<void> => {
  const redis = getRedisClient();
  if (!redis) return clearRateLimitInMemory(userName);

  try {
    await redis.del(rateLimitKey(userName));
  } catch (err) {
    // A successful login should not fail just because Redis couldn't clear
    // the counter — worst case, the next failed attempt sees a stale count.
    logger.warn(
      { err: (err as Error).message },
      'Failed to clear Redis-backed login rate limit counter',
    );
  }
};

export class LoginApi {
  context!: Context;

  initialize({ context }: { context: Context }): void {
    this.context = context;
  }

  get userDb() {
    return this.context.dataSources.userDb;
  }

  async getUser(userName: string): Promise<User> {
    const user = await this.userDb.getUserByUserName(userName);

    if (!user) {
      throw new AuthenticationError('User does not exist.');
    }

    return user;
  }

  async login(userName: string, password: string): Promise<LoginResult> {
    await checkRateLimit(userName);

    // Deliberately not using getUser() here: it throws a distinct "User
    // does not exist" error, which combined with the "Invalid password"
    // error below would let a caller enumerate valid usernames. Both
    // failure cases below share one message and one bcrypt.compare() call
    // (real or dummy hash) so they're indistinguishable by message or timing.
    const user = await this.userDb.getUserByUserName(userName);
    const isPasswordValid = await bcrypt.compare(
      password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );

    if (!user || !isPasswordValid) {
      throw new AuthenticationError('Invalid username or password.');
    }

    const userId = user.id;

    await clearRateLimit(userName);

    const token = this.createJwtToken({ userId });
    await this.userDb.setToken(userId, token);

    // The DB enforces a single active token per user (setToken above just
    // overwrote it), but the JWT cache doesn't know that on its own — an
    // older token's cache entry, if there was one, would otherwise still
    // resolve to a valid userId for up to its TTL even though a fresh DB
    // check would now correctly reject it (foundUser.token !== token).
    if (user.token) {
      await invalidateCachedToken(user.token);
    }

    this.context.res?.cookie('jwtToken', token, {
      secure: true,
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 7,
      path: '/',
      sameSite: 'none',
    });

    return { userId, token };
  }

  async logout(userName: string): Promise<boolean> {
    const { loggedUserId } = this.context;

    if (!loggedUserId) {
      throw new AuthenticationError('You have to log in');
    }

    const user = await this.getUser(userName);

    if (String(user.id) !== String(loggedUserId)) {
      throw new AuthenticationError('You are not this user.');
    }

    await this.userDb.clearToken(user.id);
    if (this.context.loggedUserToken) {
      await invalidateCachedToken(this.context.loggedUserToken);
    }
    this.context.res?.clearCookie('jwtToken');
    return true;
  }

  createJwtToken(payload: { userId: string }): string {
    return jwt.sign(payload, process.env.JWT_SECRET as string, {
      expiresIn: '7d',
    });
  }
}
