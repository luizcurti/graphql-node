import { postResolvers } from '../graphql/schema/post/resolvers';
import { AuthenticationError } from '../graphql/errors';
import type { Context } from '../graphql/context/types';

const mockPostDb = {
  getPost: jest.fn(),
  getPosts: jest.fn(),
  createPost: jest.fn(),
  updatePost: jest.fn(),
  deletePost: jest.fn(),
};

const mockUserDb = {
  batchLoadById: jest.fn(),
};

const mockCommentDb = {
  batchLoad: jest.fn(),
};

const makeCtx = (loggedUserId = ''): Context =>
  ({
    loggedUserId,
    dataSources: {
      postDb: mockPostDb,
      userDb: mockUserDb,
      commentDb: mockCommentDb,
    },
  }) as unknown as Context;

beforeEach(() => jest.clearAllMocks());

// ─── Query ──────────────────────────────────────────────────────────────────

describe('Query.post', () => {
  it('returns the post by id', async () => {
    const post = { id: '1', title: 'Title', body: 'Body' };
    mockPostDb.getPost.mockResolvedValue(post);

    const result = await postResolvers.Query.post(null, { id: '1' }, makeCtx());

    expect(mockPostDb.getPost).toHaveBeenCalledWith('1');
    expect(result).toEqual(post);
  });

  it('returns null when the post does not exist', async () => {
    mockPostDb.getPost.mockResolvedValue(null);

    const result = await postResolvers.Query.post(
      null,
      { id: '999' },
      makeCtx(),
    );

    expect(result).toBeNull();
  });

  it('can be accessed without authentication', async () => {
    mockPostDb.getPost.mockResolvedValue({ id: '1' });

    await expect(
      postResolvers.Query.post(null, { id: '1' }, makeCtx('')),
    ).resolves.not.toThrow();
  });
});

describe('Query.posts', () => {
  it('throws AuthenticationError when not authenticated', async () => {
    await expect(
      postResolvers.Query.posts(null, {}, makeCtx('')),
    ).rejects.toThrow(AuthenticationError);

    expect(mockPostDb.getPosts).not.toHaveBeenCalled();
  });

  it('returns the list of posts when authenticated', async () => {
    const posts = [{ id: '1' }, { id: '2' }, { id: '3' }];
    mockPostDb.getPosts.mockResolvedValue(posts);

    const result = await postResolvers.Query.posts(
      null,
      { input: {} },
      makeCtx('user1'),
    );

    expect(mockPostDb.getPosts).toHaveBeenCalledWith({});
    expect(result).toHaveLength(3);
  });

  it('passes pagination filters through to the datasource', async () => {
    mockPostDb.getPosts.mockResolvedValue([]);
    const input = {
      _sort: 'createdAt',
      _order: 'desc' as const,
      _start: 5,
      _limit: 10,
    };

    await postResolvers.Query.posts(null, { input }, makeCtx('user1'));

    expect(mockPostDb.getPosts).toHaveBeenCalledWith(input);
  });
});

// ─── Mutations ───────────────────────────────────────────────────────────────

describe('Mutation.createPost', () => {
  it('throws AuthenticationError when not authenticated', async () => {
    await expect(
      postResolvers.Mutation.createPost(
        null,
        { data: { title: 'T', body: 'B' } },
        makeCtx(''),
      ),
    ).rejects.toThrow(AuthenticationError);

    expect(mockPostDb.createPost).not.toHaveBeenCalled();
  });

  it('creates the post, injecting the userId from the context', async () => {
    const post = { id: '1', title: 'T', body: 'B', userId: 'user1' };
    mockPostDb.createPost.mockResolvedValue(post);

    const result = await postResolvers.Mutation.createPost(
      null,
      { data: { title: 'T', body: 'B' } },
      makeCtx('user1'),
    );

    expect(mockPostDb.createPost).toHaveBeenCalledWith({
      title: 'T',
      body: 'B',
      userId: 'user1',
    });
    expect(result).toEqual(post);
  });

  it('does not allow passing an external userId — always uses the one from the context', async () => {
    mockPostDb.createPost.mockResolvedValue({ id: '1', userId: 'user1' });

    await postResolvers.Mutation.createPost(
      null,
      { data: { title: 'T', body: 'B' } },
      makeCtx('user1'),
    );

    const callArg = mockPostDb.createPost.mock.calls[0][0];
    expect(callArg.userId).toBe('user1');
  });
});

describe('Mutation.updatePost', () => {
  it('throws AuthenticationError when not authenticated', async () => {
    await expect(
      postResolvers.Mutation.updatePost(
        null,
        { postId: '1', data: { title: 'X' } },
        makeCtx(''),
      ),
    ).rejects.toThrow(AuthenticationError);

    expect(mockPostDb.updatePost).not.toHaveBeenCalled();
  });

  it('calls the datasource with postId, data, and loggedUserId when authenticated', async () => {
    const updated = { id: '1', title: 'Updated' };
    mockPostDb.updatePost.mockResolvedValue(updated);

    const result = await postResolvers.Mutation.updatePost(
      null,
      { postId: '1', data: { title: 'Updated' } },
      makeCtx('user1'),
    );

    expect(mockPostDb.updatePost).toHaveBeenCalledWith(
      '1',
      { title: 'Updated' },
      'user1',
    );
    expect(result).toEqual(updated);
  });

  it('forwards AuthenticationError if the datasource rejects due to ownership', async () => {
    mockPostDb.updatePost.mockRejectedValue(
      new AuthenticationError('You cannot update this post.'),
    );

    await expect(
      postResolvers.Mutation.updatePost(
        null,
        { postId: '1', data: { title: 'X' } },
        makeCtx('user2'),
      ),
    ).rejects.toThrow(AuthenticationError);
  });
});

describe('Mutation.deletePost', () => {
  it('throws AuthenticationError when not authenticated', async () => {
    await expect(
      postResolvers.Mutation.deletePost(null, { postId: '1' }, makeCtx('')),
    ).rejects.toThrow(AuthenticationError);

    expect(mockPostDb.deletePost).not.toHaveBeenCalled();
  });

  it('calls the datasource with postId and loggedUserId when authenticated', async () => {
    mockPostDb.deletePost.mockResolvedValue(true);

    const result = await postResolvers.Mutation.deletePost(
      null,
      { postId: '1' },
      makeCtx('user1'),
    );

    expect(mockPostDb.deletePost).toHaveBeenCalledWith('1', 'user1');
    expect(result).toBe(true);
  });

  it('forwards AuthenticationError if the datasource rejects due to ownership', async () => {
    mockPostDb.deletePost.mockRejectedValue(
      new AuthenticationError('You cannot delete this post.'),
    );

    await expect(
      postResolvers.Mutation.deletePost(
        null,
        { postId: '1' },
        makeCtx('user2'),
      ),
    ).rejects.toThrow(AuthenticationError);
  });
});

// ─── Field Resolvers ─────────────────────────────────────────────────────────

describe('Post.user (field resolver)', () => {
  it("loads the post's author via DataLoader", async () => {
    const user = { id: 'user1', userName: 'alice' };
    mockUserDb.batchLoadById.mockResolvedValue(user);

    const result = await postResolvers.Post.user(
      { userId: 'user1' },
      null,
      makeCtx(),
    );

    expect(mockUserDb.batchLoadById).toHaveBeenCalledWith('user1');
    expect(result).toEqual(user);
  });
});

describe('Post.comments (field resolver)', () => {
  it("loads the post's comments via DataLoader", async () => {
    const comments = [{ id: '10' }, { id: '11' }];
    mockCommentDb.batchLoad.mockResolvedValue(comments);

    const result = await postResolvers.Post.comments(
      { id: 'post1' },
      null,
      makeCtx(),
    );

    expect(mockCommentDb.batchLoad).toHaveBeenCalledWith('post1');
    expect(result).toEqual(comments);
  });

  it('returns an empty array when the post has no comments', async () => {
    mockCommentDb.batchLoad.mockResolvedValue([]);

    const result = await postResolvers.Post.comments(
      { id: 'post1' },
      null,
      makeCtx(),
    );

    expect(result).toEqual([]);
  });
});

describe('Post.unixTimestamp (field resolver)', () => {
  it('converts createdAt (ISO string) to a unix timestamp in seconds', () => {
    const result = postResolvers.Post.unixTimestamp({
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    expect(result).toBe(1704067200);
  });
});
