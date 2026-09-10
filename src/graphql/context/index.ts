import jwt from 'jsonwebtoken';
import type { Response } from 'express';
import { knex, knexRead } from '../../knex/';
import { UserSQLDataSource } from '../schema/user/sql-datasource';
import { PostSQLDataSource } from '../schema/post/sql-datasource';
import { CommentSQLDataSource } from '../schema/comment/datasources';
import { LoginApi } from '../schema/login/datasources';
import { logger } from '../../utils/logger';
import { getCachedUserId, cacheUserId } from './token-cache';
import type { Context } from './types';

export type { Context } from './types';

interface ReqLike {
  headers?: Record<string, string | string[] | undefined>;
}

const makeUserDb = (): UserSQLDataSource => {
  const userDb = new UserSQLDataSource(knex, knexRead);
  userDb.initialize({ context: {}, cache: undefined });
  return userDb;
};

const verifyJwtToken = async (token: string | undefined): Promise<string> => {
  try {
    if (!token) return '';
    // Throws on a bad signature or expiry before any cache/DB lookup runs,
    // so a forged token can never produce a cache hit — the cache only
    // ever stores mappings for tokens that passed this check.
    const { userId } = jwt.verify(token, process.env.JWT_SECRET as string, {
      algorithms: ['HS256'],
    }) as { userId: string };

    const cachedUserId = await getCachedUserId(token);
    if (cachedUserId) return cachedUserId;

    const userDb = makeUserDb();
    const foundUser = await userDb.getUser(userId);

    if (!foundUser || foundUser.token !== token) return '';

    await cacheUserId(token, String(userId));
    return String(userId);
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'JWT verification failed');
    return '';
  }
};

const extractBearerToken = (req: ReqLike | undefined): string | undefined => {
  if (!req || !req.headers || !req.headers.authorization) return undefined;

  try {
    const [, token] = String(req.headers.authorization).split(' ');
    return token;
  } catch (_e) {
    // A crafted header value whose toString() throws shouldn't crash
    // context() — treat it the same as no header at all.
    return undefined;
  }
};

const cookieParser = (cookiesHeader: unknown): Record<string, string> => {
  if (typeof cookiesHeader !== 'string') return {};

  const cookies = cookiesHeader.split(/;\s*/);

  const parsedCookie: Record<string, string> = {};
  for (let i = 0; i < cookies.length; i++) {
    const [key, value] = cookies[i].split('=');
    parsedCookie[key] = value;
  }

  return parsedCookie;
};

export const context = async ({
  req,
  res,
  connection,
}: {
  req?: ReqLike;
  res?: Response;
  connection?: boolean;
}): Promise<Context> => {
  let loggedUserToken = extractBearerToken(req);
  let loggedUserId = await verifyJwtToken(loggedUserToken);

  if (!loggedUserId && req && req.headers && req.headers.cookie) {
    loggedUserToken = cookieParser(req.headers.cookie).jwtToken;
    loggedUserId = await verifyJwtToken(loggedUserToken);
  }

  const userDb = makeUserDb();
  const postDb = new PostSQLDataSource(knex, knexRead);
  const commentDb = new CommentSQLDataSource(knex, knexRead);

  const theContext: Context = {
    loggedUserId,
    // Only meaningful alongside a non-empty loggedUserId — kept so
    // LoginApi.logout() can invalidate this exact token's cache entry
    // (see ./token-cache.ts) without needing a separate DB round-trip to
    // look it up.
    loggedUserToken: loggedUserId ? loggedUserToken : undefined,
    res,
    dataSources: { userDb, postDb, commentDb },
  };

  postDb.initialize({ context: theContext, cache: undefined });
  commentDb.initialize({ context: theContext, cache: undefined });

  if (!connection) {
    const loginApi = new LoginApi();
    loginApi.initialize({ context: theContext });
    theContext.dataSources.loginApi = loginApi;
  }

  return theContext;
};
