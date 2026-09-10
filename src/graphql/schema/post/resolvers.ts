import { checkIsLoggedIn } from '../login/utils/login-functions';
import type { Context } from '../../context/types';
import type { Post, CreatePostInput, UpdatePostInput } from './sql-datasource';
import type { ApiFiltersInput } from '../api-filters/types';
import type { User } from '../user/sql-datasource';
import type { Comment } from '../comment/datasources';

// Query resolvers
const post = async (
  _: unknown,
  { id }: { id: string },
  { dataSources }: Context,
): Promise<Post | null> => {
  return dataSources.postDb.getPost(id);
};

const posts = async (
  _: unknown,
  { input }: { input?: ApiFiltersInput },
  { dataSources, loggedUserId }: Context,
): Promise<Post[]> => {
  checkIsLoggedIn(loggedUserId);
  return dataSources.postDb.getPosts(input);
};

// Mutation resolvers
const createPost = async (
  _: unknown,
  { data }: { data: Omit<CreatePostInput, 'userId'> },
  { dataSources, loggedUserId }: Context,
): Promise<Post | null> => {
  checkIsLoggedIn(loggedUserId);
  return dataSources.postDb.createPost({ ...data, userId: loggedUserId });
};

const updatePost = async (
  _: unknown,
  { postId, data }: { postId: string; data: UpdatePostInput },
  { dataSources, loggedUserId }: Context,
): Promise<Post | null> => {
  checkIsLoggedIn(loggedUserId);
  return dataSources.postDb.updatePost(postId, data, loggedUserId);
};

const deletePost = async (
  _: unknown,
  { postId }: { postId: string },
  { dataSources, loggedUserId }: Context,
): Promise<boolean> => {
  checkIsLoggedIn(loggedUserId);
  return dataSources.postDb.deletePost(postId, loggedUserId);
};

// Field resolver
const user = async (
  { userId }: Pick<Post, 'userId'>,
  _: unknown,
  { dataSources }: Context,
): Promise<User | null> => {
  return dataSources.userDb.batchLoadById(userId);
};

const comments = async (
  { id: post_id }: Pick<Post, 'id'>,
  _: unknown,
  { dataSources }: Context,
): Promise<Comment[]> => {
  return dataSources.commentDb.batchLoad(post_id);
};

const unixTimestamp = ({ createdAt }: Pick<Post, 'createdAt'>): number => {
  return Math.floor(new Date(createdAt).getTime() / 1000);
};

export const postResolvers = {
  Query: { post, posts },
  Mutation: { createPost, updatePost, deletePost },
  Post: { user, comments, unixTimestamp },
};
