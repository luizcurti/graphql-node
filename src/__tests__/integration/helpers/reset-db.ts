import type { Knex } from 'knex';
import { seed as seedUsers } from '../../../knex/seeds/01_users';
import { seed as seedPosts } from '../../../knex/seeds/02_posts';
import { seed as seedComments } from '../../../knex/seeds/03_comments';

/**
 * Re-runs the official seeds (the same ones used by `npm run seed`) to
 * guarantee a deterministic baseline before each integration suite.
 */
export const resetDb = async (knex: Knex): Promise<void> => {
  await seedUsers(knex);
  await seedPosts(knex);
  await seedComments(knex);
};
