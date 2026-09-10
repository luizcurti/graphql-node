import { knex } from '../../knex';
import { resetDb } from './helpers/reset-db';

describe('[integration] database schema (migrations + seeds)', () => {
  beforeAll(async () => {
    await resetDb(knex);
  });

  afterAll(async () => {
    await knex.destroy();
  });

  it('creates the users table with the expected columns', async () => {
    const columns = await knex('information_schema.columns')
      .where({
        table_schema: knex.client.config.connection.database,
        table_name: 'users',
      })
      .pluck('COLUMN_NAME');

    expect(columns).toEqual(
      expect.arrayContaining([
        'id',
        'first_name',
        'last_name',
        'user_name',
        'password_hash',
        'index_ref',
        'created_at',
        'token',
      ]),
    );
  });

  it('creates the posts table with an FK to users (CASCADE)', async () => {
    const fk = await knex('information_schema.key_column_usage')
      .where({
        table_schema: knex.client.config.connection.database,
        table_name: 'posts',
        column_name: 'user_id',
      })
      .whereNotNull('referenced_table_name')
      .first();

    expect(fk).toBeDefined();
    expect(fk.REFERENCED_TABLE_NAME).toBe('users');
    expect(fk.REFERENCED_COLUMN_NAME).toBe('id');
  });

  it('creates the comments table with FKs to posts and users (CASCADE)', async () => {
    const fks = await knex('information_schema.key_column_usage')
      .where({
        table_schema: knex.client.config.connection.database,
        table_name: 'comments',
      })
      .whereNotNull('referenced_table_name')
      .select('COLUMN_NAME', 'REFERENCED_TABLE_NAME');

    const referencedTables = fks.map(
      (r: { REFERENCED_TABLE_NAME: string }) => r.REFERENCED_TABLE_NAME,
    );
    expect(referencedTables).toEqual(
      expect.arrayContaining(['posts', 'users']),
    );
  });

  it('seeds exactly 20 users, 24 posts, and 24 comments', async () => {
    const [{ count: userCount }] = await knex('users').count({ count: '*' });
    const [{ count: postCount }] = await knex('posts').count({ count: '*' });
    const [{ count: commentCount }] = await knex('comments').count({
      count: '*',
    });

    expect(Number(userCount)).toBe(20);
    expect(Number(postCount)).toBe(24);
    expect(Number(commentCount)).toBe(24);
  });

  it('has applied every registered migration (knex_migrations)', async () => {
    const applied = await knex('knex_migrations').pluck('name');
    expect(applied).toEqual(
      expect.arrayContaining([
        '20210529121742_create-comments-table.ts',
        '20260310130000_create-users-table.ts',
        '20260310130001_create-posts-table.ts',
        '20260310130002_add-fk-to-comments.ts',
      ]),
    );
  });
});
