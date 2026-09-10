import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('posts', (table) => {
    table.increments('id').primary();
    table.string('title', 255).notNullable();
    table.text('body').notNullable();
    table
      .integer('user_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    table.integer('index_ref').unsigned().notNullable().defaultTo(0);
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.index('user_id', 'idx_posts_user_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('posts');
}
