import type { Response } from 'express';
import type { UserSQLDataSource } from '../schema/user/sql-datasource';
import type { PostSQLDataSource } from '../schema/post/sql-datasource';
import type { CommentSQLDataSource } from '../schema/comment/datasources';
import type { LoginApi } from '../schema/login/datasources';

export interface DataSources {
  userDb: UserSQLDataSource;
  postDb: PostSQLDataSource;
  commentDb: CommentSQLDataSource;
  loginApi?: LoginApi;
}

export interface Context {
  loggedUserId: string;
  loggedUserToken?: string;
  res?: Response;
  dataSources: DataSources;
}
