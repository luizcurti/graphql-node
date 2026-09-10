import { knex } from '../../knex';
import { UserSQLDataSource } from '../../graphql/schema/user/sql-datasource';
import { ValidationError } from '../../graphql/errors';
import { resetDb } from './helpers/reset-db';

describe('[integration] UserSQLDataSource (real MySQL)', () => {
  let ds: UserSQLDataSource;

  beforeAll(async () => {
    await resetDb(knex);
  });

  afterAll(async () => {
    await knex.destroy();
  });

  beforeEach(() => {
    ds = new UserSQLDataSource(knex);
    ds.initialize({ context: {}, cache: undefined });
  });

  it('getUser returns a seeded user (happy path)', async () => {
    const user = await ds.getUser(602);
    expect(user?.userName).toBe('elisa.pereira');
    expect(user?.firstName).toBe('Elisa');
  });

  it('getUser returns null for a nonexistent id (sad path)', async () => {
    const user = await ds.getUser(999999);
    expect(user).toBeNull();
  });

  it('createUser + getUser: actually creates a row and reads it back', async () => {
    const created = await ds.createUser({
      firstName: 'Integration',
      lastName: 'Test',
      userName: 'integration.test',
      password: 'Senha123',
    });

    expect(created?.userName).toBe('integration.test');

    const fetched = await ds.getUser(created!.id);
    expect(fetched?.userName).toBe('integration.test');

    // cleanup
    await ds.deleteUser(created!.id);
  });

  it('createUser rejects a duplicate userName against the real database constraint (sad path)', async () => {
    await expect(
      ds.createUser({
        firstName: 'Duplicate',
        lastName: 'Test',
        userName: 'elisa.pereira', // already exists in the seed
        password: 'Senha123',
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('updateUser persists the change to the database', async () => {
    const created = await ds.createUser({
      firstName: 'Before',
      lastName: 'Surname',
      userName: 'update.integration',
      password: 'Senha123',
    });

    const updated = await ds.updateUser(created!.id, { firstName: 'After' });
    expect(updated?.firstName).toBe('After');

    const reloaded = await ds.getUser(created!.id);
    expect(reloaded?.firstName).toBe('After');

    await ds.deleteUser(created!.id);
  });

  it('deleteUser actually removes the row from the database', async () => {
    const created = await ds.createUser({
      firstName: 'Delete',
      lastName: 'Me',
      userName: 'delete.integration',
      password: 'Senha123',
    });

    const deleted = await ds.deleteUser(created!.id);
    expect(deleted).toBe(true);

    const afterDelete = await ds.getUser(created!.id);
    expect(afterDelete).toBeNull();
  });

  it('getUsers honors real _sort/_order/_start/_limit against MySQL', async () => {
    const page1 = await ds.getUsers({
      _sort: 'indexRef',
      _order: 'desc',
      _start: 0,
      _limit: 3,
    });

    expect(page1).toHaveLength(3);
    const indexRefs = page1.map((u) => u.indexRef);
    expect(indexRefs).toEqual([...indexRefs].sort((a, b) => b - a));
  });

  it('setToken and getUser: the persisted token is read back correctly', async () => {
    await ds.setToken(602, 'integration-token');
    const user = await ds.getUser(602);
    expect(user?.token).toBe('integration-token');

    await ds.clearToken(602);
    const cleared = await ds.getUser(602);
    expect(cleared?.token).toBe('');
  });

  it('getUserByUserName finds an existing user and returns null for a nonexistent one', async () => {
    const found = await ds.getUserByUserName('talita.melo');
    expect(found?.id).toBe('115');

    const notFound = await ds.getUserByUserName('user-that-does-not-exist');
    expect(notFound).toBeNull();
  });
});
