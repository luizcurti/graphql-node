import bcrypt from 'bcrypt';
import DataLoader from 'dataloader';
import type { Knex } from 'knex';
import { UserInputError, ValidationError } from '../../errors';
import { SQLDatasource } from '../../datasources/sql/sql-datasource';
import { isDuplicateEntryError } from '../../datasources/sql/db-errors';
import {
  validateUserName,
  validateUserPassword,
} from './utils/user-repository';
import { MAX_PAGE_LIMIT, type ApiFiltersInput } from '../api-filters/types';

export interface UserRow {
  id: number;
  first_name: string;
  last_name: string;
  user_name: string;
  password_hash: string;
  token: string;
  index_ref: number;
  created_at: Date | string;
}

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  userName: string;
  passwordHash: string;
  token: string;
  indexRef: number;
  createdAt: string;
}

export interface CreateUserInput {
  firstName: string;
  lastName: string;
  userName: string;
  password: string;
}

export interface UpdateUserInput {
  firstName?: string;
  lastName?: string;
  userName?: string;
  password?: string;
}

const ALLOWED_SORT_COLUMNS = new Set([
  'id',
  'first_name',
  'last_name',
  'user_name',
  'index_ref',
  'created_at',
]);

const SORT_COLUMN_MAP: Record<string, string> = {
  id: 'id',
  firstName: 'first_name',
  lastName: 'last_name',
  userName: 'user_name',
  indexRef: 'index_ref',
  createdAt: 'created_at',
};

const resolveSort = (sort: string): string => SORT_COLUMN_MAP[sort] ?? sort;

const userReducer = (row: UserRow): User => ({
  id: String(row.id),
  firstName: row.first_name,
  lastName: row.last_name,
  userName: row.user_name,
  passwordHash: row.password_hash,
  token: row.token,
  indexRef: row.index_ref,
  createdAt: new Date(row.created_at).toISOString(),
});

export class UserSQLDataSource extends SQLDatasource<string, User | null> {
  tableName = 'users';
  private _byIdLoader: DataLoader<string, User | null>;
  private _byUserNameLoader: DataLoader<string, UserRow | null>;

  constructor(dbConnection: Knex, readConnection?: Knex) {
    super(dbConnection, readConnection);
    this._byIdLoader = new DataLoader(async (ids: readonly string[]) => {
      const rows: UserRow[] = await this.readDb(this.tableName).whereIn(
        'id',
        ids as string[],
      );
      return ids.map((id) => {
        const row = rows.find((r) => String(r.id) === String(id));
        return row ? userReducer(row) : null;
      });
    });
    this._byUserNameLoader = new DataLoader(
      async (userNames: readonly string[]) => {
        const rows: UserRow[] = await this.readDb(this.tableName).whereIn(
          'user_name',
          userNames as string[],
        );
        return userNames.map(
          (un) => rows.find((r) => r.user_name === un) || null,
        );
      },
    );
  }

  // Query.users — a list read with no write dependency in the same request,
  // so it's safe to serve from the replica.
  async getUsers({
    _sort,
    _order,
    _start,
    _limit,
  }: ApiFiltersInput = {}): Promise<User[]> {
    let query = this.readDb(this.tableName);
    if (_sort) {
      const col = resolveSort(_sort);
      if (!ALLOWED_SORT_COLUMNS.has(col)) {
        throw new UserInputError(`Invalid sort column: ${_sort}`);
      }
      query = query.orderBy(col, _order || 'asc');
    }
    if (_start) query = query.offset(Number(_start));
    if (_limit) query = query.limit(Math.min(Number(_limit), MAX_PAGE_LIMIT));
    const rows: UserRow[] = await query;
    return rows.map(userReducer);
  }

  // Stays on the write connection (not this.readDb): createUser/updateUser
  // call this right after an insert/update and need to see it immediately,
  // which a lagging replica isn't guaranteed to.
  async getUser(id: string | number): Promise<User | null> {
    const row: UserRow | undefined = await this.db(this.tableName)
      .where('id', id)
      .first();
    if (!row) return null;
    return userReducer(row);
  }

  async getUserByUserName(userName: string): Promise<User | null> {
    const row = await this._byUserNameLoader.load(userName);
    if (!row) return null;
    return userReducer(row);
  }

  batchLoadById(id: string | number): Promise<User | null> {
    return this._byIdLoader.load(String(id));
  }

  async createUser({
    firstName,
    lastName,
    userName,
    password,
  }: CreateUserInput): Promise<User | null> {
    validateUserName(userName);
    validateUserPassword(password);

    const passwordHash = await bcrypt.hash(password, 12);

    // Uniqueness is enforced by the DB-level unique index on user_name
    // (see the create-users-table migration), not a check-then-insert
    // query, which would race under two concurrent signups for the same
    // name (both could pass a pre-check before either insert commits).
    let id: number;
    try {
      [id] = await this.db(this.tableName).insert({
        first_name: firstName,
        last_name: lastName,
        user_name: userName,
        password_hash: passwordHash,
      });
    } catch (err) {
      if (isDuplicateEntryError(err)) {
        throw new ValidationError(
          `userName ${userName} has already been taken`,
        );
      }
      throw err;
    }

    // index_ref mirrors the new row's own auto-increment id, assigned as a
    // follow-up update rather than computed from MAX(index_ref)+1 beforehand
    // — the old approach raced under concurrent creates (two inserts could
    // read the same MAX before either committed); id is already guaranteed
    // unique and monotonic by MySQL, so there's nothing left to race on.
    await this.db(this.tableName).where('id', id).update({ index_ref: id });

    return this.getUser(id);
  }

  async updateUser(
    userId: string,
    { firstName, lastName, userName, password }: UpdateUserInput,
  ): Promise<User | null> {
    const updates: Record<string, string> = {};

    if (typeof firstName !== 'undefined') updates.first_name = firstName;
    if (typeof lastName !== 'undefined') updates.last_name = lastName;

    if (typeof userName !== 'undefined') {
      validateUserName(userName);
      updates.user_name = userName;
    }

    if (typeof password !== 'undefined') {
      validateUserPassword(password);
      updates.password_hash = await bcrypt.hash(password, 12);
    }

    if (Object.keys(updates).length === 0) {
      throw new ValidationError('No fields to update');
    }

    // Same DB-level uniqueness enforcement as createUser above — a
    // check-then-update here would race the same way under two concurrent
    // renames to the same userName.
    try {
      await this.db(this.tableName).where('id', userId).update(updates);
    } catch (err) {
      if (isDuplicateEntryError(err)) {
        throw new ValidationError(
          `userName ${userName} has already been taken`,
        );
      }
      throw err;
    }
    return this.getUser(userId);
  }

  async deleteUser(userId: string): Promise<boolean> {
    const deleted = await this.db(this.tableName).where('id', userId).delete();
    return deleted > 0;
  }

  async setToken(userId: string | number, token: string): Promise<void> {
    await this.db(this.tableName).where('id', userId).update({ token });
  }

  async clearToken(userId: string | number): Promise<void> {
    await this.db(this.tableName).where('id', userId).update({ token: '' });
  }
}
