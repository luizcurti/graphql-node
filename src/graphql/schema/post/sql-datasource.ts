import DataLoader from 'dataloader';
import type { Knex } from 'knex';
import {
  AuthenticationError,
  UserInputError,
  ValidationError,
} from '../../errors';
import { SQLDatasource } from '../../datasources/sql/sql-datasource';
import type { ApiFiltersInput } from '../api-filters/types';

export interface PostRow {
  id: number;
  title: string;
  body: string;
  user_id: number | string;
  index_ref: number;
  created_at: Date | string;
}

export interface Post {
  id: string;
  title: string;
  body: string;
  userId: string;
  indexRef: number;
  createdAt: string;
}

export interface CreatePostInput {
  title: string;
  body: string;
  userId: string;
}

export interface UpdatePostInput {
  title?: string;
  body?: string;
}

const ALLOWED_SORT_COLUMNS = new Set([
  'id',
  'title',
  'user_id',
  'index_ref',
  'created_at',
]);

const SORT_COLUMN_MAP: Record<string, string> = {
  id: 'id',
  title: 'title',
  userId: 'user_id',
  indexRef: 'index_ref',
  createdAt: 'created_at',
};

const resolveSort = (sort: string): string => SORT_COLUMN_MAP[sort] ?? sort;

const postReducer = (row: PostRow): Post => ({
  id: String(row.id),
  title: row.title,
  body: row.body,
  userId: String(row.user_id),
  indexRef: row.index_ref,
  createdAt: new Date(row.created_at).toISOString(),
});

export class PostSQLDataSource extends SQLDatasource<string, Post[]> {
  tableName = 'posts';
  private _byUserIdLoader: DataLoader<string, Post[]>;

  constructor(dbConnection: Knex, readConnection?: Knex) {
    super(dbConnection, readConnection);
    this._byUserIdLoader = new DataLoader(
      async (userIds: readonly string[]) => {
        const rows: PostRow[] = await this.readDb(this.tableName).whereIn(
          'user_id',
          userIds as string[],
        );
        return userIds.map((uid) =>
          rows
            .filter((r) => String(r.user_id) === String(uid))
            .map(postReducer),
        );
      },
    );
  }

  // Query.posts — a list read with no write dependency in the same request,
  // so it's safe to serve from the replica.
  async getPosts({
    _sort,
    _order,
    _start,
    _limit,
  }: ApiFiltersInput = {}): Promise<Post[]> {
    let query = this.readDb(this.tableName);
    if (_sort) {
      const col = resolveSort(_sort);
      if (!ALLOWED_SORT_COLUMNS.has(col)) {
        throw new UserInputError(`Invalid sort column: ${_sort}`);
      }
      query = query.orderBy(col, _order || 'asc');
    }
    if (_start) query = query.offset(Number(_start));
    if (_limit) query = query.limit(Number(_limit));
    const rows: PostRow[] = await query;
    return rows.map(postReducer);
  }

  // Stays on the write connection (not this.readDb): createPost/updatePost/
  // deletePost call this right after a write and need to see it immediately,
  // which a lagging replica isn't guaranteed to.
  async getPost(id: string | number): Promise<Post | null> {
    const row: PostRow | undefined = await this.db(this.tableName)
      .where('id', id)
      .first();
    if (!row) return null;
    return postReducer(row);
  }

  batchLoadByUserId(userId: string | number): Promise<Post[]> {
    return this._byUserIdLoader.load(String(userId));
  }

  async createPost({
    title,
    body,
    userId,
  }: CreatePostInput): Promise<Post | null> {
    if (!title || !body) {
      throw new ValidationError('title and body are required');
    }

    const [maxIndexRef] = (await this.db(this.tableName).max(
      'index_ref as val',
    )) as { val: number | null }[];
    const indexRef = (maxIndexRef.val || 0) + 1;

    const [id] = await this.db(this.tableName).insert({
      title,
      body,
      user_id: userId,
      index_ref: indexRef,
    });

    return this.getPost(id);
  }

  async updatePost(
    postId: string,
    { title, body }: UpdatePostInput,
    loggedUserId: string,
  ): Promise<Post | null> {
    const post = await this.getPost(postId);
    if (!post) {
      throw new ValidationError('Post not found');
    }
    if (post.userId !== String(loggedUserId)) {
      throw new AuthenticationError('You cannot update this post.');
    }

    const updates: Record<string, string> = {};
    if (typeof title !== 'undefined') {
      if (!title) throw new ValidationError('title cannot be empty');
      updates.title = title;
    }
    if (typeof body !== 'undefined') {
      if (!body) throw new ValidationError('body cannot be empty');
      updates.body = body;
    }

    if (Object.keys(updates).length === 0) {
      throw new ValidationError('No fields to update');
    }

    await this.db(this.tableName).where('id', postId).update(updates);
    return this.getPost(postId);
  }

  async deletePost(postId: string, loggedUserId: string): Promise<boolean> {
    const post = await this.getPost(postId);
    if (!post) {
      throw new ValidationError('Post not found');
    }
    if (post.userId !== String(loggedUserId)) {
      throw new AuthenticationError('You cannot delete this post.');
    }
    const deleted = await this.db(this.tableName).where('id', postId).delete();
    return deleted > 0;
  }
}
