import type { Knex } from 'knex';

const UNIQUE_INDEX_NAME = 'uq_comments_user_post_comment_hash';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('comments', (table) => {
    table.string('comment_hash', 32).notNullable().defaultTo('');
  });

  await knex.raw('UPDATE comments SET comment_hash = MD5(comment)');

  await knex.schema.alterTable('comments', (table) => {
    table.unique(['user_id', 'post_id', 'comment_hash'], {
      indexName: UNIQUE_INDEX_NAME,
    });
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('comments', (table) => {
    table.dropUnique(['user_id', 'post_id', 'comment_hash'], UNIQUE_INDEX_NAME);
    table.dropColumn('comment_hash');
  });
}
