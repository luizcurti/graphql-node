import type { Knex } from 'knex';
import {
  AuthenticationError,
  UserInputError,
  ValidationError,
} from '../graphql/errors';
import { PostSQLDataSource } from '../graphql/schema/post/sql-datasource';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeRow = (overrides = {}) => ({
  id: 1,
  title: 'Title',
  body: 'Post body',
  user_id: 10,
  index_ref: 1,
  created_at: new Date('2024-01-01T00:00:00Z'),
  ...overrides,
});

const makeQb = (overrides = {}) => ({
  where: jest.fn().mockReturnThis(),
  whereIn: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  offset: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  first: jest.fn().mockResolvedValue(null),
  insert: jest.fn().mockResolvedValue([1]),
  update: jest.fn().mockResolvedValue(1),
  delete: jest.fn().mockResolvedValue(1),
  max: jest.fn().mockResolvedValue([{ val: 0 }]),
  ...overrides,
});

const makeDs = (qbOverrides = {}) => {
  const qb = makeQb(qbOverrides);
  const db = jest.fn(() => qb);
  const ds = new PostSQLDataSource(db as unknown as Knex);
  ds.initialize({ context: {}, cache: undefined });
  return { ds, db, qb };
};

// ─── postReducer (via getPost) ────────────────────────────────────────────────

describe('PostSQLDataSource — postReducer', () => {
  it('maps fields and converts id/userId to string', async () => {
    const { ds, qb } = makeDs();
    qb.first.mockResolvedValue(makeRow());

    const result = await ds.getPost(1);

    expect(result?.id).toBe('1');
    expect(result?.userId).toBe('10');
    expect(result?.title).toBe('Title');
    expect(result?.body).toBe('Post body');
    expect(result?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('getPost returns null when not found', async () => {
    const { ds, qb } = makeDs();
    qb.first.mockResolvedValue(null);

    expect(await ds.getPost(999)).toBeNull();
  });
});

// ─── getPosts / _sort whitelist ──────────────────────────────────────────────

describe('PostSQLDataSource.getPosts — filters', () => {
  it('works when called with no arguments (uses the default {})', async () => {
    const mockDb = jest.fn(() =>
      Object.assign(Promise.resolve([]), {
        orderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
      }),
    );
    const ds = new PostSQLDataSource(mockDb as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    await expect(ds.getPosts()).resolves.toEqual([]);
  });

  it('applies _start and _limit when provided', async () => {
    const qb = {
      orderBy: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
    };
    const mockDb = jest.fn(() => Object.assign(Promise.resolve([]), qb));
    const ds = new PostSQLDataSource(mockDb as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    await ds.getPosts({ _start: 2, _limit: 5 });

    expect(qb.offset).toHaveBeenCalledWith(2);
    expect(qb.limit).toHaveBeenCalledWith(5);
  });
});

describe('PostSQLDataSource.getPosts — _sort whitelist', () => {
  it('throws UserInputError for a disallowed column', () => {
    const { ds } = makeDs();
    return expect(ds.getPosts({ _sort: 'body' })).rejects.toThrow(
      UserInputError,
    );
  });

  it('throws UserInputError for an injection attempt', () => {
    const { ds } = makeDs();
    return expect(
      ds.getPosts({ _sort: 'title; DROP TABLE posts; --' }),
    ).rejects.toThrow(UserInputError);
  });

  it('accepts every column in the whitelist', async () => {
    const allowed = ['id', 'title', 'user_id', 'index_ref', 'created_at'];

    for (const col of allowed) {
      const mockDb = jest.fn(() =>
        Object.assign(Promise.resolve([]), {
          orderBy: jest.fn().mockReturnThis(),
          offset: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
        }),
      );
      const ds = new PostSQLDataSource(mockDb as unknown as Knex);
      ds.initialize({ context: {}, cache: undefined });

      await expect(ds.getPosts({ _sort: col })).resolves.not.toThrow();
    }
  });
});

// ─── createPost ──────────────────────────────────────────────────────────────

describe('PostSQLDataSource.createPost', () => {
  it('throws ValidationError when title is empty', () => {
    const { ds } = makeDs();
    return expect(
      ds.createPost({ title: '', body: 'Body', userId: '1' }),
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError when body is empty', () => {
    const { ds } = makeDs();
    return expect(
      ds.createPost({ title: 'Title', body: '', userId: '1' }),
    ).rejects.toThrow(ValidationError);
  });

  it('inserts with the correct fields and returns the created post', async () => {
    const qb = makeQb({
      first: jest.fn().mockResolvedValueOnce(makeRow()), // getPost after insert
      insert: jest.fn().mockResolvedValue([42]),
      max: jest.fn().mockResolvedValue([{ val: 9 }]),
    });
    const db = jest.fn(() => qb);
    const ds = new PostSQLDataSource(db as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    const result = await ds.createPost({
      title: 'Title',
      body: 'Body',
      userId: '10',
    });

    const insertCall = qb.insert.mock.calls[0][0];
    expect(insertCall.title).toBe('Title');
    expect(insertCall.body).toBe('Body');
    expect(insertCall.user_id).toBe('10');
    expect(insertCall.index_ref).toBe(10); // MAX(9) + 1
    expect(result).toBeDefined();
  });

  it('uses 0 as the base index_ref when MAX returns null (empty table)', async () => {
    const qb = makeQb({
      first: jest.fn().mockResolvedValueOnce(makeRow({ index_ref: 1 })),
      insert: jest.fn().mockResolvedValue([1]),
      max: jest.fn().mockResolvedValue([{ val: null }]),
    });
    const db = jest.fn(() => qb);
    const ds = new PostSQLDataSource(db as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    await ds.createPost({ title: 'Title', body: 'Body', userId: '1' });

    const insertCall = qb.insert.mock.calls[0][0];
    expect(insertCall.index_ref).toBe(1); // 0 (fallback) + 1
  });
});

// ─── updatePost ──────────────────────────────────────────────────────────────

describe('PostSQLDataSource.updatePost', () => {
  it('throws ValidationError when the post does not exist', () => {
    const { ds, qb } = makeDs();
    qb.first.mockResolvedValue(null);

    return expect(
      ds.updatePost('999', { title: 'X' }, 'user1'),
    ).rejects.toThrow(ValidationError);
  });

  it('throws AuthenticationError when loggedUserId is not the owner', () => {
    const { ds, qb } = makeDs();
    qb.first.mockResolvedValue(makeRow({ user_id: 10 }));

    return expect(ds.updatePost('1', { title: 'X' }, '99')).rejects.toThrow(
      AuthenticationError,
    );
  });

  it('throws ValidationError when no field is passed', () => {
    const { ds, qb } = makeDs();
    qb.first.mockResolvedValue(makeRow({ user_id: 10 }));

    return expect(ds.updatePost('1', {}, '10')).rejects.toThrow(
      ValidationError,
    );
  });

  it('throws ValidationError when title is an empty string', () => {
    const { ds, qb } = makeDs();
    qb.first.mockResolvedValue(makeRow({ user_id: 10 }));

    return expect(ds.updatePost('1', { title: '' }, '10')).rejects.toThrow(
      ValidationError,
    );
  });

  it('throws ValidationError when body is an empty string', () => {
    const { ds, qb } = makeDs();
    qb.first.mockResolvedValue(makeRow({ user_id: 10 }));

    return expect(ds.updatePost('1', { body: '' }, '10')).rejects.toThrow(
      ValidationError,
    );
  });

  it('updates only body when it is the only field provided', async () => {
    const qb = makeQb({
      first: jest
        .fn()
        .mockResolvedValueOnce(makeRow({ user_id: 10 }))
        .mockResolvedValueOnce(makeRow({ body: 'New body' })),
      update: jest.fn().mockResolvedValue(1),
    });
    const db = jest.fn(() => qb);
    const ds = new PostSQLDataSource(db as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    const result = await ds.updatePost('1', { body: 'New body' }, '10');

    expect(qb.update).toHaveBeenCalledWith({ body: 'New body' });
    expect(result?.body).toBe('New body');
  });

  it('updates only the fields provided', async () => {
    const qb = makeQb({
      first: jest
        .fn()
        .mockResolvedValueOnce(makeRow({ user_id: 10 })) // getPost for the ownership check
        .mockResolvedValueOnce(makeRow({ title: 'New' })), // getPost for the return value
      update: jest.fn().mockResolvedValue(1),
    });
    const db = jest.fn(() => qb);
    const ds = new PostSQLDataSource(db as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    const result = await ds.updatePost('1', { title: 'New' }, '10');

    const updateCall = qb.update.mock.calls[0][0];
    expect(updateCall).toEqual({ title: 'New' });
    expect(updateCall).not.toHaveProperty('body');
    expect(result?.title).toBe('New');
  });
});

// ─── deletePost ──────────────────────────────────────────────────────────────

describe('PostSQLDataSource.deletePost', () => {
  it('throws ValidationError when the post does not exist', () => {
    const { ds, qb } = makeDs();
    qb.first.mockResolvedValue(null);

    return expect(ds.deletePost('999', 'user1')).rejects.toThrow(
      ValidationError,
    );
  });

  it('throws AuthenticationError when loggedUserId is not the owner', () => {
    const { ds, qb } = makeDs();
    qb.first.mockResolvedValue(makeRow({ user_id: 10 }));

    return expect(ds.deletePost('1', '99')).rejects.toThrow(
      AuthenticationError,
    );
  });

  it('returns true when successfully deleted', async () => {
    const qb = makeQb({
      first: jest.fn().mockResolvedValue(makeRow({ user_id: 10 })),
      delete: jest.fn().mockResolvedValue(1),
    });
    const db = jest.fn(() => qb);
    const ds = new PostSQLDataSource(db as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    expect(await ds.deletePost('1', '10')).toBe(true);
  });

  it('returns false when delete affects 0 rows', async () => {
    const qb = makeQb({
      first: jest.fn().mockResolvedValue(makeRow({ user_id: 10 })),
      delete: jest.fn().mockResolvedValue(0),
    });
    const db = jest.fn(() => qb);
    const ds = new PostSQLDataSource(db as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    expect(await ds.deletePost('1', '10')).toBe(false);
  });
});

// ─── batchLoadByUserId (via DataLoader) ──────────────────────────────────────

describe('PostSQLDataSource.batchLoadByUserId', () => {
  it("returns the user's posts correctly grouped", async () => {
    const rows = [
      makeRow({ id: 1, user_id: 10 }),
      makeRow({ id: 2, user_id: 10 }),
      makeRow({ id: 3, user_id: 20 }),
    ];
    const db = jest.fn(() =>
      Object.assign(Promise.resolve(rows), {
        whereIn: jest.fn().mockReturnThis(),
      }),
    );
    const ds = new PostSQLDataSource(db as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    const result = await ds.batchLoadByUserId(10);
    expect(result).toHaveLength(2);
    expect(result.every((p) => p.userId === '10')).toBe(true);
  });

  it('returns an empty array when the user has no posts', async () => {
    const db = jest.fn(() =>
      Object.assign(Promise.resolve([]), {
        whereIn: jest.fn().mockReturnThis(),
      }),
    );
    const ds = new PostSQLDataSource(db as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    const result = await ds.batchLoadByUserId(999);
    expect(result).toEqual([]);
  });
});

// ─── read replica routing ─────────────────────────────────────────────────────

describe('PostSQLDataSource — read replica routing', () => {
  it('routes getPosts and batchLoadByUserId to the read connection', async () => {
    const writeDb = jest.fn(() => {
      throw new Error('write connection should not be used for pure reads');
    });
    const readRows = [makeRow({ id: 1, user_id: 10 })];
    const readQb = {
      orderBy: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      whereIn: jest.fn().mockReturnThis(),
    };
    const readDb = jest.fn(() =>
      Object.assign(Promise.resolve(readRows), readQb),
    );

    const ds = new PostSQLDataSource(
      writeDb as unknown as Knex,
      readDb as unknown as Knex,
    );
    ds.initialize({ context: {}, cache: undefined });

    await expect(ds.getPosts({})).resolves.toHaveLength(1);
    await expect(ds.batchLoadByUserId(10)).resolves.toHaveLength(1);

    expect(writeDb).not.toHaveBeenCalled();
    expect(readDb).toHaveBeenCalled();
  });

  it('keeps getPost (point read by id) on the write connection', async () => {
    const row = makeRow({ id: 3 });
    const writeDb = jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue(row),
    }));
    const readDb = jest.fn(() => {
      throw new Error('read connection should not be used here');
    });

    const ds = new PostSQLDataSource(
      writeDb as unknown as Knex,
      readDb as unknown as Knex,
    );
    ds.initialize({ context: {}, cache: undefined });

    await expect(ds.getPost(3)).resolves.toEqual(
      expect.objectContaining({ id: '3' }),
    );
    expect(readDb).not.toHaveBeenCalled();
  });

  it('defaults the read connection to the write connection when not provided', () => {
    const db = jest.fn();
    const ds = new PostSQLDataSource(db as unknown as Knex);
    expect(ds.readDb).toBe(db);
  });
});
