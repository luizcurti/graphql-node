import { commentResolvers } from '../graphql/schema/comment/resolvers';
import { AuthenticationError } from '../graphql/errors';
import { pubSub, CREATED_COMMENT_TRIGGER } from '../graphql/pubsub';
import type { Context } from '../graphql/context/types';

const mockCommentDb = {
  create: jest.fn(),
};

const mockPostDb = {
  getPost: jest.fn(),
};

const mockUserDb = {
  batchLoadById: jest.fn(),
};

const makeCtx = (loggedUserId = ''): Context =>
  ({
    loggedUserId,
    dataSources: {
      commentDb: mockCommentDb,
      postDb: mockPostDb,
      userDb: mockUserDb,
    },
  }) as unknown as Context;

beforeEach(() => jest.clearAllMocks());

// ─── Mutations ───────────────────────────────────────────────────────────────

describe('Mutation.createComment', () => {
  it('throws AuthenticationError when not authenticated', async () => {
    await expect(
      commentResolvers.Mutation.createComment(
        null,
        { data: { postId: '1', comment: 'Hello' } },
        makeCtx(''),
      ),
    ).rejects.toThrow(AuthenticationError);

    expect(mockPostDb.getPost).not.toHaveBeenCalled();
    expect(mockCommentDb.create).not.toHaveBeenCalled();
  });

  it('creates a comment and passes postOwner when the post exists', async () => {
    const post = { id: '1', userId: 'owner123' };
    const created = {
      id: '10',
      comment: 'Hello',
      user_id: 'user1',
      post_id: '1',
    };
    mockPostDb.getPost.mockResolvedValue(post);
    mockCommentDb.create.mockResolvedValue(created);

    const result = await commentResolvers.Mutation.createComment(
      null,
      { data: { postId: '1', comment: 'Hello' } },
      makeCtx('user1'),
    );

    expect(mockPostDb.getPost).toHaveBeenCalledWith('1');
    expect(mockCommentDb.create).toHaveBeenCalledWith({
      postId: '1',
      comment: 'Hello',
      userId: 'user1',
      postOwner: 'owner123',
    });
    expect(result).toEqual(created);
  });

  it('passes postOwner as null when the post is not found', async () => {
    mockPostDb.getPost.mockResolvedValue(null);
    mockCommentDb.create.mockResolvedValue({ id: '10' });

    await commentResolvers.Mutation.createComment(
      null,
      { data: { postId: '999', comment: 'Hello' } },
      makeCtx('user1'),
    );

    const callArg = mockCommentDb.create.mock.calls[0][0];
    expect(callArg.postOwner).toBeNull();
  });

  it('injects the userId from the context, not from the request', async () => {
    mockPostDb.getPost.mockResolvedValue({ id: '1', userId: 'owner123' });
    mockCommentDb.create.mockResolvedValue({ id: '10' });

    await commentResolvers.Mutation.createComment(
      null,
      { data: { postId: '1', comment: 'Hello' } },
      makeCtx('logged-in-user'),
    );

    const callArg = mockCommentDb.create.mock.calls[0][0];
    expect(callArg.userId).toBe('logged-in-user');
  });
});

// ─── Field Resolvers ─────────────────────────────────────────────────────────

describe('Comment.user (field resolver)', () => {
  it("loads the comment's author via DataLoader by user_id", async () => {
    const user = { id: 'user1', userName: 'alice' };
    mockUserDb.batchLoadById.mockResolvedValue(user);

    const result = await commentResolvers.Comment.user(
      { user_id: 'user1' },
      null,
      makeCtx(),
    );

    expect(mockUserDb.batchLoadById).toHaveBeenCalledWith('user1');
    expect(result).toEqual(user);
  });
});

// ─── Subscription ────────────────────────────────────────────────────────────

describe('Subscription.createdComment (filter logic)', () => {
  // The filter function passed to withFilter encapsulates the business rule:
  // only notify the owner of the post that received the comment.
  // We test the logic directly, without needing the subscriptions server.

  const filterFn = (
    payload: { postOwner: string | null },
    _: unknown,
    context: { loggedUserId: string },
  ): boolean => {
    const hasPostOwner = payload.postOwner !== null;
    const postOwnerIsLoggedUser = payload.postOwner === context.loggedUserId;
    return hasPostOwner && postOwnerIsLoggedUser;
  };

  it('notifies when the logged-in user is the owner of the post', () => {
    const payload = { postOwner: 'user1' };
    const context = { loggedUserId: 'user1' };
    expect(filterFn(payload, null, context)).toBe(true);
  });

  it('does not notify when the logged-in user is not the owner of the post', () => {
    const payload = { postOwner: 'another-user' };
    const context = { loggedUserId: 'user1' };
    expect(filterFn(payload, null, context)).toBe(false);
  });

  it('does not notify when postOwner is null (orphan post)', () => {
    const payload = { postOwner: null };
    const context = { loggedUserId: 'user1' };
    expect(filterFn(payload, null, context)).toBe(false);
  });
});

describe('Subscription.createdComment.subscribe (real integration with pubsub + withFilter)', () => {
  it('delivers the published payload when the logged-in user is the owner of the post', async () => {
    const iterator =
      await commentResolvers.Subscription.createdComment.subscribe(
        undefined,
        undefined,
        { loggedUserId: 'owner-1' } as Context,
      );

    const payload = { createdComment: { id: 1 }, postOwner: 'owner-1' };
    const nextPromise = iterator.next();
    pubSub.publish(CREATED_COMMENT_TRIGGER, payload);

    const result = await nextPromise;
    expect(result.done).toBe(false);
    expect(result.value).toEqual(payload);

    await iterator.return?.();
  });

  it('does not deliver the payload when the logged-in user is not the owner of the post', async () => {
    const iterator =
      await commentResolvers.Subscription.createdComment.subscribe(
        undefined,
        undefined,
        { loggedUserId: 'someone-else' } as Context,
      );

    let resolved = false;
    const nextPromise = iterator.next().then((r) => {
      resolved = true;
      return r;
    });

    pubSub.publish(CREATED_COMMENT_TRIGGER, {
      createdComment: { id: 2 },
      postOwner: 'owner-1',
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(resolved).toBe(false);

    await iterator.return?.();
    // drain the pending promise so it doesn't leak between tests
    await nextPromise.catch(() => undefined);
  });
});
