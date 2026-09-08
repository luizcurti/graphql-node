import jwt from 'jsonwebtoken';
import type { Response } from 'express';
import { knex, knexRead } from '../../knex/';
import { UserSQLDataSource } from '../schema/user/sql-datasource';
import { PostSQLDataSource } from '../schema/post/sql-datasource';
import { CommentSQLDataSource } from '../schema/comment/datasources';
import { LoginApi } from '../schema/login/datasources';
import { logger } from '../../utils/logger';
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
    const { userId } = jwt.verify(token, process.env.JWT_SECRET as string, {
      algorithms: ['HS256'],
    }) as { userId: string };

    const userDb = makeUserDb();
    const foundUser = await userDb.getUser(userId);

    if (!foundUser || foundUser.token !== token) return '';
    return String(userId);
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'JWT verification failed');
    return '';
  }
};

const authorizeUserWithBearerToken = async (
  req: ReqLike | undefined,
): Promise<string> => {
  if (!req || !req.headers || !req.headers.authorization) return '';

  const { headers } = req;
  const { authorization } = headers;

  try {
    const [, token] = String(authorization).split(' ');
    return await verifyJwtToken(token);
  } catch (_e) {
    return '';
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
  let loggedUserId = await authorizeUserWithBearerToken(req);

  if (!loggedUserId && req && req.headers && req.headers.cookie) {
    const { jwtToken } = cookieParser(req.headers.cookie);
    loggedUserId = await verifyJwtToken(jwtToken);
  }

  const userDb = makeUserDb();
  const postDb = new PostSQLDataSource(knex, knexRead);
  const commentDb = new CommentSQLDataSource(knex, knexRead);

  const theContext: Context = {
    loggedUserId,
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
