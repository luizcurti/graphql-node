import { withFilter } from 'graphql-subscriptions';
import { checkIsLoggedIn } from '../login/utils/login-functions';
import { pubSub, CREATED_COMMENT_TRIGGER } from '../../pubsub';
import type { Context } from '../../context/types';
import type { Comment } from './datasources';
import type { User } from '../user/sql-datasource';

interface CreatedCommentPayload {
  createdComment: Comment;
  postOwner: string | null;
}

const createComment = async (
  _: unknown,
  { data }: { data: { postId: string; comment: string } },
  { dataSources, loggedUserId }: Context,
): Promise<Comment> => {
  checkIsLoggedIn(loggedUserId);
  const { postId, comment } = data;

  const post = await dataSources.postDb.getPost(postId);

  return dataSources.commentDb.create({
    postId,
    comment,
    userId: loggedUserId,
    postOwner: post?.userId || null,
  });
};

const user = async (
  { user_id }: Pick<Comment, 'user_id'>,
  _: unknown,
  { dataSources }: Context,
): Promise<User | null> => {
  return dataSources.userDb.batchLoadById(user_id);
};

const createdComment = {
  subscribe: withFilter(
    () => {
      return pubSub.asyncIterableIterator(CREATED_COMMENT_TRIGGER);
    },
    (payload?: CreatedCommentPayload, _?: unknown, context?: Context) => {
      const hasPostOwner =
        payload?.postOwner !== null && payload?.postOwner !== undefined;
      const postOwnerIsLoggedUser =
        payload?.postOwner === context?.loggedUserId;
      const shouldNotifyUser = hasPostOwner && postOwnerIsLoggedUser;
      return shouldNotifyUser;
    },
  ),
};

export const commentResolvers = {
  Mutation: { createComment },
  Subscription: { createdComment },
  Comment: { user },
};
