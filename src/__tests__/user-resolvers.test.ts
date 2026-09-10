import { userResolvers } from '../graphql/schema/user/resolvers';
import { AuthenticationError } from '../graphql/errors';
import type { Context } from '../graphql/context/types';

const mockUserDb = {
  getUser: jest.fn(),
  getUsers: jest.fn(),
  createUser: jest.fn(),
  updateUser: jest.fn(),
  deleteUser: jest.fn(),
};

const mockPostDb = {
  batchLoadByUserId: jest.fn(),
};

const makeCtx = (loggedUserId = ''): Context =>
  ({
    loggedUserId,
    dataSources: { userDb: mockUserDb, postDb: mockPostDb },
  }) as unknown as Context;

beforeEach(() => jest.clearAllMocks());

// ─── Query ──────────────────────────────────────────────────────────────────

describe('Query.user', () => {
  it('throws AuthenticationError when not authenticated', async () => {
    await expect(
      userResolvers.Query.user(null, { id: '1' }, makeCtx('')),
    ).rejects.toThrow(AuthenticationError);

    expect(mockUserDb.getUser).not.toHaveBeenCalled();
  });

  it('returns the user by id when authenticated', async () => {
    const user = { id: '1', userName: 'alice' };
    mockUserDb.getUser.mockResolvedValue(user);

    const result = await userResolvers.Query.user(
      null,
      { id: '1' },
      makeCtx('user1'),
    );

    expect(mockUserDb.getUser).toHaveBeenCalledWith('1');
    expect(result).toEqual(user);
  });

  it('returns null when the user does not exist', async () => {
    mockUserDb.getUser.mockResolvedValue(null);

    const result = await userResolvers.Query.user(
      null,
      { id: '999' },
      makeCtx('user1'),
    );

    expect(result).toBeNull();
  });
});

describe('Query.users', () => {
  it('throws AuthenticationError when not authenticated', async () => {
    await expect(
      userResolvers.Query.users(null, {}, makeCtx('')),
    ).rejects.toThrow(AuthenticationError);

    expect(mockUserDb.getUsers).not.toHaveBeenCalled();
  });

  it('returns the list of users with no filters when authenticated', async () => {
    const users = [{ id: '1' }, { id: '2' }];
    mockUserDb.getUsers.mockResolvedValue(users);

    const result = await userResolvers.Query.users(
      null,
      { input: {} },
      makeCtx('user1'),
    );

    expect(mockUserDb.getUsers).toHaveBeenCalledWith({});
    expect(result).toHaveLength(2);
  });

  it('passes pagination filters through to the datasource', async () => {
    mockUserDb.getUsers.mockResolvedValue([]);
    const input = {
      _sort: 'createdAt',
      _order: 'desc' as const,
      _start: 0,
      _limit: 10,
    };

    await userResolvers.Query.users(null, { input }, makeCtx('user1'));

    expect(mockUserDb.getUsers).toHaveBeenCalledWith(input);
  });

  it('returns an empty list when there are no users', async () => {
    mockUserDb.getUsers.mockResolvedValue([]);

    const result = await userResolvers.Query.users(null, {}, makeCtx('user1'));

    expect(result).toEqual([]);
  });
});

// ─── Mutations ───────────────────────────────────────────────────────────────

describe('Mutation.createUser', () => {
  it('creates and returns the new user', async () => {
    const data = {
      firstName: 'Alice',
      lastName: 'Silva',
      userName: 'alice',
      password: 'Pass1!',
    };
    const created = { id: '1', ...data };
    mockUserDb.createUser.mockResolvedValue(created);

    const result = await userResolvers.Mutation.createUser(
      null,
      { data },
      makeCtx(),
    );

    expect(mockUserDb.createUser).toHaveBeenCalledWith(data);
    expect(result).toEqual(created);
  });
});

describe('Mutation.updateUser', () => {
  it('throws AuthenticationError when not authenticated', async () => {
    await expect(
      userResolvers.Mutation.updateUser(
        null,
        { userId: '1', data: {} },
        makeCtx(''),
      ),
    ).rejects.toThrow(AuthenticationError);

    expect(mockUserDb.updateUser).not.toHaveBeenCalled();
  });

  it('throws AuthenticationError when the logged-in user is not the owner', async () => {
    await expect(
      userResolvers.Mutation.updateUser(
        null,
        { userId: '1', data: {} },
        makeCtx('2'),
      ),
    ).rejects.toThrow(AuthenticationError);

    expect(mockUserDb.updateUser).not.toHaveBeenCalled();
  });

  it('updates when the logged-in user is the owner', async () => {
    const updated = { id: '1', firstName: 'New' };
    mockUserDb.updateUser.mockResolvedValue(updated);

    const result = await userResolvers.Mutation.updateUser(
      null,
      { userId: '1', data: { firstName: 'New' } },
      makeCtx('1'),
    );

    expect(mockUserDb.updateUser).toHaveBeenCalledWith('1', {
      firstName: 'New',
    });
    expect(result).toEqual(updated);
  });
});

describe('Mutation.deleteUser', () => {
  it('throws AuthenticationError when not authenticated', async () => {
    await expect(
      userResolvers.Mutation.deleteUser(null, { userId: '1' }, makeCtx('')),
    ).rejects.toThrow(AuthenticationError);

    expect(mockUserDb.deleteUser).not.toHaveBeenCalled();
  });

  it('throws AuthenticationError when the logged-in user is not the owner', async () => {
    await expect(
      userResolvers.Mutation.deleteUser(null, { userId: '1' }, makeCtx('2')),
    ).rejects.toThrow(AuthenticationError);

    expect(mockUserDb.deleteUser).not.toHaveBeenCalled();
  });

  it('deletes and returns true when the logged-in user is the owner', async () => {
    mockUserDb.deleteUser.mockResolvedValue(true);

    const result = await userResolvers.Mutation.deleteUser(
      null,
      { userId: '1' },
      makeCtx('1'),
    );

    expect(mockUserDb.deleteUser).toHaveBeenCalledWith('1');
    expect(result).toBe(true);
  });
});

// ─── Field Resolvers ─────────────────────────────────────────────────────────

describe('User.posts (field resolver)', () => {
  it("loads the user's posts via DataLoader", async () => {
    const posts = [{ id: '10' }, { id: '11' }];
    mockPostDb.batchLoadByUserId.mockResolvedValue(posts);

    const result = await userResolvers.User.posts({ id: '1' }, null, makeCtx());

    expect(mockPostDb.batchLoadByUserId).toHaveBeenCalledWith('1');
    expect(result).toEqual(posts);
  });

  it('returns an empty array when the user has no posts', async () => {
    mockPostDb.batchLoadByUserId.mockResolvedValue([]);

    const result = await userResolvers.User.posts({ id: '1' }, null, makeCtx());

    expect(result).toEqual([]);
  });
});
