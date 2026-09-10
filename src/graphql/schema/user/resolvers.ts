import { checkIsLoggedIn, checkOwner } from '../login/utils/login-functions';
import type { Context } from '../../context/types';
import type { User, CreateUserInput, UpdateUserInput } from './sql-datasource';
import type { ApiFiltersInput } from '../api-filters/types';
import type { Post } from '../post/sql-datasource';

// Query resolvers
const users = async (
  _: unknown,
  { input }: { input?: ApiFiltersInput },
  { dataSources, loggedUserId }: Context,
): Promise<User[]> => {
  checkIsLoggedIn(loggedUserId);
  return dataSources.userDb.getUsers(input);
};

const user = async (
  _: unknown,
  { id }: { id: string },
  { dataSources, loggedUserId }: Context,
): Promise<User | null> => {
  checkIsLoggedIn(loggedUserId);
  return dataSources.userDb.getUser(id);
};

// Mutation Resolvers
const createUser = async (
  _: unknown,
  { data }: { data: CreateUserInput },
  { dataSources }: Context,
): Promise<User | null> => {
  return dataSources.userDb.createUser(data);
};

const updateUser = async (
  _: unknown,
  { userId, data }: { userId: string; data: UpdateUserInput },
  { dataSources, loggedUserId }: Context,
): Promise<User | null> => {
  checkOwner(userId, loggedUserId);
  return dataSources.userDb.updateUser(userId, data);
};

const deleteUser = async (
  _: unknown,
  { userId }: { userId: string },
  { dataSources, loggedUserId }: Context,
): Promise<boolean> => {
  checkOwner(userId, loggedUserId);
  return dataSources.userDb.deleteUser(userId);
};

// Field Resolvers
const posts = (
  { id }: Pick<User, 'id'>,
  _: unknown,
  { dataSources }: Context,
): Promise<Post[]> => {
  return dataSources.postDb.batchLoadByUserId(id);
};

export const userResolvers = {
  Query: { user, users },
  Mutation: { createUser, updateUser, deleteUser },
  User: { posts },
};
