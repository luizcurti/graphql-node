import bcrypt from 'bcrypt';
import type { Knex } from 'knex';
import { UserInputError, ValidationError } from '../graphql/errors';
import { UserSQLDataSource } from '../graphql/schema/user/sql-datasource';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeRow = (overrides = {}) => ({
  id: 1,
  first_name: 'Alice',
  last_name: 'Silva',
  user_name: 'alice.silva',
  password_hash: 'hash',
  token: '',
  index_ref: 1,
  created_at: new Date('2024-01-01T00:00:00Z'),
  ...overrides,
});

const makeDb = (overrides = {}) => {
  const queryBuilder = {
    where: jest.fn().mockReturnThis(),
    whereIn: jest.fn().mockReturnThis(),
    whereNot: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    offset: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    first: jest.fn().mockResolvedValue(null),
    insert: jest.fn().mockResolvedValue([1]),
    update: jest.fn().mockResolvedValue(1),
    delete: jest.fn().mockResolvedValue(1),
    max: jest.fn().mockResolvedValue([{ val: 0 }]),
  };

  const db = jest.fn(() => ({ ...queryBuilder, ...overrides }));
  db.mockImplementation(() => ({ ...queryBuilder, ...overrides }));
  return { db: db as unknown as Knex, queryBuilder };
};

const makeDs = (dbOverrides = {}) => {
  const { db } = makeDb(dbOverrides);
  const ds = new UserSQLDataSource(db);
  ds.initialize({ context: {}, cache: undefined });
  return { ds, db };
};

// ─── userReducer (via getUser) ────────────────────────────────────────────────

describe('UserSQLDataSource — userReducer', () => {
  it('maps snake_case fields to camelCase and converts id to string', async () => {
    const row = makeRow();
    const { db, queryBuilder } = makeDb();
    queryBuilder.first.mockResolvedValue(row);
    const ds = new UserSQLDataSource(db);
    ds.initialize({ context: {}, cache: undefined });

    const result = await ds.getUser(1);

    expect(result?.id).toBe('1');
    expect(result?.firstName).toBe('Alice');
    expect(result?.lastName).toBe('Silva');
    expect(result?.userName).toBe('alice.silva');
    expect(result?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('getUser returns null when the row does not exist', async () => {
    const { db, queryBuilder } = makeDb();
    queryBuilder.first.mockResolvedValue(null);
    const ds = new UserSQLDataSource(db);
    ds.initialize({ context: {}, cache: undefined });

    const result = await ds.getUser(999);

    expect(result).toBeNull();
  });
});

// ─── getUsers / _sort whitelist ──────────────────────────────────────────────

describe('UserSQLDataSource.getUsers', () => {
  it('returns the list of users with no filters', async () => {
    // direct approach: mock db returning rows
    const mockDb = jest.fn(() => {
      const q = {
        orderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
      };
      // makes it thenable (await q returns the rows)
      return Object.assign(Promise.resolve([makeRow(), makeRow({ id: 2 })]), q);
    });

    const ds2 = new UserSQLDataSource(mockDb as unknown as Knex);
    ds2.initialize({ context: {}, cache: undefined });

    const results = await ds2.getUsers({});
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('1');
    expect(results[1].id).toBe('2');
  });

  it('throws UserInputError for a disallowed sort column', () => {
    const { ds } = makeDs();
    return expect(ds.getUsers({ _sort: 'password_hash' })).rejects.toThrow(
      UserInputError,
    );
  });

  it('throws UserInputError for an injection attempt in _sort', () => {
    const { ds } = makeDs();
    return expect(
      ds.getUsers({ _sort: 'id; DROP TABLE users; --' }),
    ).rejects.toThrow(UserInputError);
  });

  it('applies _start and _limit when provided', async () => {
    const qb = {
      orderBy: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
    };
    const mockDb = jest.fn(() => Object.assign(Promise.resolve([]), qb));
    const ds = new UserSQLDataSource(mockDb as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    await ds.getUsers({ _start: 5, _limit: 10 });

    expect(qb.offset).toHaveBeenCalledWith(5);
    expect(qb.limit).toHaveBeenCalledWith(10);
  });

  it('works when called with no arguments (uses the default {})', async () => {
    const mockDb = jest.fn(() =>
      Object.assign(Promise.resolve([]), {
        orderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
      }),
    );
    const ds = new UserSQLDataSource(mockDb as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    await expect(ds.getUsers()).resolves.toEqual([]);
  });

  it('accepts every column in the whitelist', async () => {
    const allowed = [
      'id',
      'first_name',
      'last_name',
      'user_name',
      'index_ref',
      'created_at',
    ];

    for (const col of allowed) {
      const mockDb = jest.fn(() =>
        Object.assign(Promise.resolve([]), {
          orderBy: jest.fn().mockReturnThis(),
          offset: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
        }),
      );
      const ds = new UserSQLDataSource(mockDb as unknown as Knex);
      ds.initialize({ context: {}, cache: undefined });

      await expect(ds.getUsers({ _sort: col })).resolves.not.toThrow();
    }
  });
});

// ─── createUser ──────────────────────────────────────────────────────────────

describe('UserSQLDataSource.createUser', () => {
  it('throws ValidationError for an invalid userName', () => {
    const { ds } = makeDs();
    return expect(
      ds.createUser({
        firstName: 'A',
        lastName: 'B',
        userName: '1invalid',
        password: 'Senha123',
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('throws UserInputError for a weak password', () => {
    const { ds } = makeDs();
    return expect(
      ds.createUser({
        firstName: 'A',
        lastName: 'B',
        userName: 'valid.user',
        password: '123',
      }),
    ).rejects.toThrow();
  });

  it('throws ValidationError when the userName already exists', async () => {
    const existingRow = makeRow();
    const qb = {
      where: jest.fn().mockReturnThis(),
      whereNot: jest.fn().mockReturnThis(),
      whereIn: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue(existingRow),
      insert: jest.fn(),
      max: jest.fn().mockResolvedValue([{ val: 5 }]),
      update: jest.fn(),
      delete: jest.fn(),
      orderBy: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
    };
    const db = jest.fn(() => qb);
    const ds = new UserSQLDataSource(db as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    await expect(
      ds.createUser({
        firstName: 'Alice',
        lastName: 'Silva',
        userName: 'alice.silva',
        password: 'Senha123',
      }),
    ).rejects.toThrow(ValidationError);

    expect(qb.insert).not.toHaveBeenCalled();
  });

  it('hashes the password with bcrypt before saving', async () => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      whereNot: jest.fn().mockReturnThis(),
      whereIn: jest.fn().mockReturnThis(),
      first: jest
        .fn()
        .mockResolvedValueOnce(null) // duplicate check
        .mockResolvedValueOnce(makeRow()), // getUser after insert
      insert: jest.fn().mockResolvedValue([10]),
      max: jest.fn().mockResolvedValue([{ val: 5 }]),
      update: jest.fn(),
      delete: jest.fn(),
      orderBy: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
    };
    const db = jest.fn(() => qb);
    const ds = new UserSQLDataSource(db as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    await ds.createUser({
      firstName: 'Alice',
      lastName: 'Silva',
      userName: 'alice.silva',
      password: 'Senha123',
    });

    const insertCall = qb.insert.mock.calls[0][0];
    expect(insertCall).toHaveProperty('password_hash');
    expect(insertCall.password_hash).not.toBe('Senha123');
    // validates that it's a real bcrypt hash
    const isValid = await bcrypt.compare('Senha123', insertCall.password_hash);
    expect(isValid).toBe(true);
  });

  it('does not save the password in plain text', async () => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      whereNot: jest.fn().mockReturnThis(),
      whereIn: jest.fn().mockReturnThis(),
      first: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeRow()),
      insert: jest.fn().mockResolvedValue([10]),
      max: jest.fn().mockResolvedValue([{ val: 5 }]),
      update: jest.fn(),
      delete: jest.fn(),
      orderBy: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
    };
    const db = jest.fn(() => qb);
    const ds = new UserSQLDataSource(db as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    await ds.createUser({
      firstName: 'Alice',
      lastName: 'Silva',
      userName: 'alice.silva',
      password: 'Senha123',
    });

    const insertCall = qb.insert.mock.calls[0][0];
    expect(insertCall).not.toHaveProperty('password');
    expect(insertCall.password_hash).not.toBe('Senha123');
  });

  it('uses 0 as the base index_ref when MAX returns null (empty table)', async () => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      whereNot: jest.fn().mockReturnThis(),
      whereIn: jest.fn().mockReturnThis(),
      first: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeRow({ index_ref: 1 })),
      insert: jest.fn().mockResolvedValue([10]),
      max: jest.fn().mockResolvedValue([{ val: null }]),
      update: jest.fn(),
      delete: jest.fn(),
      orderBy: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
    };
    const db = jest.fn(() => qb);
    const ds = new UserSQLDataSource(db as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    await ds.createUser({
      firstName: 'Alice',
      lastName: 'Silva',
      userName: 'alice.silva',
      password: 'Senha123',
    });

    const insertCall = qb.insert.mock.calls[0][0];
    expect(insertCall.index_ref).toBe(1); // 0 (fallback) + 1
  });

  it('computes index_ref as MAX + 1', async () => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      whereNot: jest.fn().mockReturnThis(),
      whereIn: jest.fn().mockReturnThis(),
      first: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeRow({ index_ref: 8 })),
      insert: jest.fn().mockResolvedValue([10]),
      max: jest.fn().mockResolvedValue([{ val: 7 }]),
      update: jest.fn(),
      delete: jest.fn(),
      orderBy: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
    };
    const db = jest.fn(() => qb);
    const ds = new UserSQLDataSource(db as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    await ds.createUser({
      firstName: 'Alice',
      lastName: 'Silva',
      userName: 'alice.silva',
      password: 'Senha123',
    });

    const insertCall = qb.insert.mock.calls[0][0];
    expect(insertCall.index_ref).toBe(8); // MAX(7) + 1
  });
});

// ─── updateUser ──────────────────────────────────────────────────────────────

describe('UserSQLDataSource.updateUser', () => {
  it('throws ValidationError when no field is passed', async () => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      whereNot: jest.fn().mockReturnThis(),
      whereIn: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue(makeRow()),
      insert: jest.fn(),
      max: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      orderBy: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
    };
    const db = jest.fn(() => qb);
    const ds = new UserSQLDataSource(db as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    await expect(ds.updateUser('1', {})).rejects.toThrow(ValidationError);
    expect(qb.update).not.toHaveBeenCalled();
  });

  it('updates only firstName when it is the only field provided', async () => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      whereNot: jest.fn().mockReturnThis(),
      whereIn: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue(makeRow({ first_name: 'New' })),
      insert: jest.fn(),
      max: jest.fn(),
      update: jest.fn().mockResolvedValue(1),
      delete: jest.fn(),
      orderBy: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
    };
    const db = jest.fn(() => qb);
    const ds = new UserSQLDataSource(db as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    await ds.updateUser('1', { firstName: 'New' });

    expect(qb.update).toHaveBeenCalledWith({ first_name: 'New' });
  });

  it('updates only lastName when it is the only field provided', async () => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      whereNot: jest.fn().mockReturnThis(),
      whereIn: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue(makeRow({ last_name: 'New' })),
      insert: jest.fn(),
      max: jest.fn(),
      update: jest.fn().mockResolvedValue(1),
      delete: jest.fn(),
      orderBy: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
    };
    const db = jest.fn(() => qb);
    const ds = new UserSQLDataSource(db as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    await ds.updateUser('1', { lastName: 'New' });

    expect(qb.update).toHaveBeenCalledWith({ last_name: 'New' });
  });

  it('hashes the new password when updating', async () => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      whereNot: jest.fn().mockReturnThis(),
      whereIn: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue(makeRow()),
      insert: jest.fn(),
      max: jest.fn(),
      update: jest.fn().mockResolvedValue(1),
      delete: jest.fn(),
      orderBy: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
    };
    const db = jest.fn(() => qb);
    const ds = new UserSQLDataSource(db as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    await ds.updateUser('1', { password: 'NewPass1' });

    const updateCall = qb.update.mock.calls[0][0];
    expect(updateCall).toHaveProperty('password_hash');
    expect(updateCall.password_hash).not.toBe('NewPass1');
    const isValid = await bcrypt.compare('NewPass1', updateCall.password_hash);
    expect(isValid).toBe(true);
  });
});

// ─── deleteUser ──────────────────────────────────────────────────────────────

describe('UserSQLDataSource.deleteUser', () => {
  it('returns true when the row is deleted', async () => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      whereIn: jest.fn().mockReturnThis(),
      first: jest.fn(),
      insert: jest.fn(),
      max: jest.fn(),
      update: jest.fn(),
      delete: jest.fn().mockResolvedValue(1),
      orderBy: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
    };
    const db = jest.fn(() => qb);
    const ds = new UserSQLDataSource(db as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    expect(await ds.deleteUser('1')).toBe(true);
  });

  it('returns false when the user does not exist', async () => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      whereIn: jest.fn().mockReturnThis(),
      first: jest.fn(),
      insert: jest.fn(),
      max: jest.fn(),
      update: jest.fn(),
      delete: jest.fn().mockResolvedValue(0),
      orderBy: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
    };
    const db = jest.fn(() => qb);
    const ds = new UserSQLDataSource(db as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    expect(await ds.deleteUser('999')).toBe(false);
  });
});

// ─── batchLoadById / getUserByUserName (DataLoader batch functions) ─────────

describe('UserSQLDataSource.batchLoadById (via DataLoader)', () => {
  it('returns the user when found', async () => {
    const row = makeRow({ id: 5 });
    const db = jest.fn(() =>
      Object.assign(Promise.resolve([row]), {
        whereIn: jest.fn().mockReturnThis(),
      }),
    );
    const ds = new UserSQLDataSource(db as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    const result = await ds.batchLoadById(5);
    expect(result?.id).toBe('5');
  });

  it('returns null when the user is not found', async () => {
    const db = jest.fn(() =>
      Object.assign(Promise.resolve([]), {
        whereIn: jest.fn().mockReturnThis(),
      }),
    );
    const ds = new UserSQLDataSource(db as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    const result = await ds.batchLoadById(999);
    expect(result).toBeNull();
  });
});

describe('UserSQLDataSource.getUserByUserName (via DataLoader)', () => {
  it('returns the user when the userName exists', async () => {
    const row = makeRow({ user_name: 'bob.silva' });
    const db = jest.fn(() =>
      Object.assign(Promise.resolve([row]), {
        whereIn: jest.fn().mockReturnThis(),
      }),
    );
    const ds = new UserSQLDataSource(db as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    const result = await ds.getUserByUserName('bob.silva');
    expect(result?.userName).toBe('bob.silva');
  });

  it('returns null when the userName does not exist', async () => {
    const db = jest.fn(() =>
      Object.assign(Promise.resolve([]), {
        whereIn: jest.fn().mockReturnThis(),
      }),
    );
    const ds = new UserSQLDataSource(db as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    const result = await ds.getUserByUserName('nobody');
    expect(result).toBeNull();
  });
});

// ─── updateUser — userName ───────────────────────────────────────────────────

describe('UserSQLDataSource.updateUser — userName', () => {
  it('throws ValidationError when the new userName already belongs to another user', async () => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      whereNot: jest.fn().mockReturnThis(),
      whereIn: jest.fn().mockReturnThis(),
      first: jest
        .fn()
        .mockResolvedValue(makeRow({ id: 2, user_name: 'taken' })),
      update: jest.fn(),
    };
    const db = jest.fn(() => qb);
    const ds = new UserSQLDataSource(db as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    await expect(ds.updateUser('1', { userName: 'taken' })).rejects.toThrow(
      ValidationError,
    );
    expect(qb.update).not.toHaveBeenCalled();
  });

  it('updates the userName when it is available', async () => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      whereNot: jest.fn().mockReturnThis(),
      whereIn: jest.fn().mockReturnThis(),
      first: jest
        .fn()
        .mockResolvedValueOnce(null) // duplicate check — available
        .mockResolvedValueOnce(makeRow({ user_name: 'new.name' })), // final getUser
      update: jest.fn().mockResolvedValue(1),
    };
    const db = jest.fn(() => qb);
    const ds = new UserSQLDataSource(db as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    const result = await ds.updateUser('1', { userName: 'new.name' });

    expect(qb.update).toHaveBeenCalledWith({ user_name: 'new.name' });
    expect(result?.userName).toBe('new.name');
  });
});

// ─── setToken / clearToken ────────────────────────────────────────────────────

describe('UserSQLDataSource.setToken / clearToken', () => {
  it("setToken updates the user's token", async () => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      update: jest.fn().mockResolvedValue(1),
    };
    const db = jest.fn(() => qb);
    const ds = new UserSQLDataSource(db as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    await ds.setToken('1', 'abc123');
    expect(qb.update).toHaveBeenCalledWith({ token: 'abc123' });
  });

  it("clearToken clears the user's token", async () => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      update: jest.fn().mockResolvedValue(1),
    };
    const db = jest.fn(() => qb);
    const ds = new UserSQLDataSource(db as unknown as Knex);
    ds.initialize({ context: {}, cache: undefined });

    await ds.clearToken('1');
    expect(qb.update).toHaveBeenCalledWith({ token: '' });
  });
});

// ─── read replica routing ─────────────────────────────────────────────────────

describe('UserSQLDataSource — read replica routing', () => {
  it('routes getUsers, batchLoadById and getUserByUserName to the read connection', async () => {
    const writeDb = jest.fn(() => {
      throw new Error('write connection should not be used for pure reads');
    });
    const readRows = [makeRow({ id: 1 }), makeRow({ id: 2, user_name: 'bob' })];
    const readQb = {
      orderBy: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      whereIn: jest.fn().mockReturnThis(),
    };
    const readDb = jest.fn(() =>
      Object.assign(Promise.resolve(readRows), readQb),
    );

    const ds = new UserSQLDataSource(
      writeDb as unknown as Knex,
      readDb as unknown as Knex,
    );
    ds.initialize({ context: {}, cache: undefined });

    await expect(ds.getUsers({})).resolves.toHaveLength(2);
    await expect(ds.batchLoadById(1)).resolves.toEqual(
      expect.objectContaining({ id: '1' }),
    );
    await expect(ds.getUserByUserName('bob')).resolves.toEqual(
      expect.objectContaining({ userName: 'bob' }),
    );

    expect(writeDb).not.toHaveBeenCalled();
    expect(readDb).toHaveBeenCalled();
  });

  it('keeps getUser (point read by id) on the write connection', async () => {
    const row = makeRow({ id: 7 });
    const writeDb = jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      first: jest.fn().mockResolvedValue(row),
    }));
    const readDb = jest.fn(() => {
      throw new Error('read connection should not be used here');
    });

    const ds = new UserSQLDataSource(
      writeDb as unknown as Knex,
      readDb as unknown as Knex,
    );
    ds.initialize({ context: {}, cache: undefined });

    await expect(ds.getUser(7)).resolves.toEqual(
      expect.objectContaining({ id: '7' }),
    );
    expect(readDb).not.toHaveBeenCalled();
  });

  it('defaults the read connection to the write connection when not provided', () => {
    const db = jest.fn();
    const ds = new UserSQLDataSource(db as unknown as Knex);
    expect(ds.readDb).toBe(db);
  });
});
