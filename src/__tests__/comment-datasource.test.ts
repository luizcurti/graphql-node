import type { Knex } from 'knex';
import { ValidationError } from '../graphql/errors';
import { CommentSQLDataSource } from '../graphql/schema/comment/datasources';

// mock the Kafka producer so tests don't need a real Kafka/Redis
jest.mock('../kafka/producer', () => ({
  publishCommentCreated: jest.fn(),
}));

import { publishCommentCreated } from '../kafka/producer';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeCommentRow = (overrides = {}) => ({
  id: 1,
  comment: 'Great post!',
  user_id: '10',
  post_id: '5',
  created_at: new Date('2024-01-01T00:00:00Z'),
  ...overrides,
});

const makeQb = (overrides = {}) => ({
  where: jest.fn().mockReturnThis(),
  whereIn: jest.fn().mockReturnThis(),
  insert: jest.fn().mockResolvedValue([1]),
  ...overrides,
});

beforeEach(() => jest.clearAllMocks());

// ─── commentReducer (via getByPostId) ────────────────────────────────────────

describe('CommentSQLDataSource — commentReducer', () => {
  it('maps fields and formats createdAt as an ISO string', async () => {
    const row = makeCommentRow();
    const qb = makeQb();
    // getByPostId awaits the query builder directly
    const db = jest.fn(() => Object.assign(Promise.resolve([row]), qb));
    const ds = new CommentSQLDataSource(db as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    const results = await ds.getByPostId('5');

    expect(results[0].id).toBe(1);
    expect(results[0].comment).toBe('Great post!');
    expect(results[0].user_id).toBe('10');
    expect(results[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ─── getById — bug fix: should return a single row ──────────────────────────

describe('CommentSQLDataSource.getById', () => {
  it('returns the correct comment (not the query builder)', async () => {
    const row = makeCommentRow();
    const qb = {
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue(row),
    };
    const db = jest.fn(() => qb);
    const ds = new CommentSQLDataSource(db as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    const result = await ds.getById(1);

    // after the fix, this should return the object — not a query builder
    expect(result).toEqual(row);
    expect(qb.first).toHaveBeenCalled();
  });
});

// ─── create ──────────────────────────────────────────────────────────────────

describe('CommentSQLDataSource.create', () => {
  it('throws ValidationError when a duplicate comment already exists', async () => {
    const qb = makeQb({
      where: jest.fn().mockReturnThis(),
      // simulates "exists" as an array with 1 item (already exists)
      then: undefined,
    });
    const db = jest.fn(() =>
      Object.assign(Promise.resolve([makeCommentRow()]), qb),
    );
    const ds = new CommentSQLDataSource(db as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    await expect(
      ds.create({ userId: '10', postId: '5', comment: 'Great post!' }),
    ).rejects.toThrow(ValidationError);

    expect(qb.insert).not.toHaveBeenCalled();
  });

  it('inserts and returns the comment when it is not a duplicate', async () => {
    let callCount = 0;
    const db = jest.fn(() => {
      callCount++;
      if (callCount === 1) {
        // first call: duplicate check — returns an empty array (doesn't exist)
        return Object.assign(Promise.resolve([]), {
          where: jest.fn().mockReturnThis(),
        });
      }
      // second call: insert
      return { insert: jest.fn().mockResolvedValue([99]) };
    });

    const ds = new CommentSQLDataSource(db as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    const result = await ds.create({
      userId: '10',
      postId: '5',
      comment: 'New comment',
      postOwner: 'owner1',
    });

    expect(result.id).toBe(99);
    expect(result.comment).toBe('New comment');
    expect(result.user_id).toBe('10');
    expect(result.post_id).toBe('5');
  });

  it('publishes a comment-created event after creating a comment', async () => {
    let callCount = 0;
    const db = jest.fn(() => {
      callCount++;
      if (callCount === 1) {
        return Object.assign(Promise.resolve([]), {
          where: jest.fn().mockReturnThis(),
        });
      }
      return { insert: jest.fn().mockResolvedValue([42]) };
    });

    const ds = new CommentSQLDataSource(db as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    await ds.create({
      userId: '10',
      postId: '5',
      comment: 'Hello',
      postOwner: 'owner1',
    });

    expect(publishCommentCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        createdComment: expect.objectContaining({ id: 42 }),
        postOwner: 'owner1',
      }),
    );
  });

  it('passes postOwner as null when not provided', async () => {
    let callCount = 0;
    const db = jest.fn(() => {
      callCount++;
      if (callCount === 1) {
        return Object.assign(Promise.resolve([]), {
          where: jest.fn().mockReturnThis(),
        });
      }
      return { insert: jest.fn().mockResolvedValue([43]) };
    });

    const ds = new CommentSQLDataSource(db as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    await ds.create({ userId: '10', postId: '5', comment: 'Hello' });

    expect(publishCommentCreated).toHaveBeenCalledWith(
      expect.objectContaining({ postOwner: null }),
    );
  });
});

// ─── batchLoaderCallback ─────────────────────────────────────────────────────

describe('CommentSQLDataSource.batchLoaderCallback', () => {
  it('groups comments by post_id correctly', async () => {
    const rows = [
      makeCommentRow({ id: 1, post_id: '5', comment: 'A' }),
      makeCommentRow({ id: 2, post_id: '5', comment: 'B' }),
      makeCommentRow({ id: 3, post_id: '7', comment: 'C' }),
    ];

    const db = jest.fn(() =>
      Object.assign(Promise.resolve(rows), {
        whereIn: jest.fn().mockReturnThis(),
      }),
    );
    const ds = new CommentSQLDataSource(db as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    const result = await ds.batchLoaderCallback(['5', '7', '99']);

    expect(result[0]).toHaveLength(2); // post_id '5' has 2 comments
    expect(result[1]).toHaveLength(1); // post_id '7' has 1 comment
    expect(result[2]).toHaveLength(0); // post_id '99' has no comments
  });
});

// ─── read replica routing ─────────────────────────────────────────────────────

describe('CommentSQLDataSource — read replica routing', () => {
  it('routes getByPostId and batchLoaderCallback to the read connection', async () => {
    const writeDb = jest.fn(() => {
      throw new Error('write connection should not be used for pure reads');
    });
    const readRows = [makeCommentRow({ id: 1, post_id: '5' })];
    const readQb = {
      where: jest.fn().mockReturnThis(),
      whereIn: jest.fn().mockReturnThis(),
    };
    const readDb = jest.fn(() =>
      Object.assign(Promise.resolve(readRows), readQb),
    );

    const ds = new CommentSQLDataSource(
      writeDb as unknown as Knex,
      readDb as unknown as Knex,
    );
    ds.initialize({ context: {}, cache: undefined });

    await expect(ds.getByPostId('5')).resolves.toHaveLength(1);
    await expect(ds.batchLoaderCallback(['5'])).resolves.toEqual([
      expect.arrayContaining([expect.objectContaining({ id: 1 })]),
    ]);

    expect(writeDb).not.toHaveBeenCalled();
    expect(readDb).toHaveBeenCalled();
  });

  it('keeps getById (point read) on the write connection', async () => {
    const row = makeCommentRow({ id: 9 });
    const writeDb = jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue(row),
    }));
    const readDb = jest.fn(() => {
      throw new Error('read connection should not be used here');
    });

    const ds = new CommentSQLDataSource(
      writeDb as unknown as Knex,
      readDb as unknown as Knex,
    );
    ds.initialize({ context: {}, cache: undefined });

    await expect(ds.getById(9)).resolves.toEqual(row);
    expect(readDb).not.toHaveBeenCalled();
  });

  it('defaults the read connection to the write connection when not provided', () => {
    const db = jest.fn();
    const ds = new CommentSQLDataSource(db as unknown as Knex);
    expect(ds.readDb).toBe(db);
  });
});
