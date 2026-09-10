import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('comments', (table) => {
    table.increments('id').primary();
    table.text('comment').notNullable();
    table.integer('post_id').unsigned().notNullable();
    table.integer('user_id').unsigned().notNullable();
    table.timestamps(true, true);
    table.index('post_id', 'idx_comments_post_id');
    table.index('user_id', 'idx_comments_user_id');
    table.index('created_at', 'idx_comments_created_at');
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('comments');
}
