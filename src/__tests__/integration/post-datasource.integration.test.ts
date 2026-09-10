import { knex } from '../../knex';
import { PostSQLDataSource } from '../../graphql/schema/post/sql-datasource';
import { UserSQLDataSource } from '../../graphql/schema/user/sql-datasource';
import { AuthenticationError, UserInputError } from '../../graphql/errors';
import { resetDb } from './helpers/reset-db';

describe('[integration] PostSQLDataSource (real MySQL)', () => {
  let postDs: PostSQLDataSource;
  let userDs: UserSQLDataSource;

  beforeAll(async () => {
    await resetDb(knex);
  });

  afterAll(async () => {
    await knex.destroy();
  });

  beforeEach(() => {
    postDs = new PostSQLDataSource(knex);
    postDs.initialize({ context: {}, cache: undefined });
    userDs = new UserSQLDataSource(knex);
    userDs.initialize({ context: {}, cache: undefined });
  });

  it('getPost returns a seeded post (happy path)', async () => {
    const post = await postDs.getPost(645);
    expect(post?.title).toBe('Nemo rerum dolorem.');
  });

  it('getPost returns null for a nonexistent id (sad path)', async () => {
    const post = await postDs.getPost(999999);
    expect(post).toBeNull();
  });

  it('createPost + getPost: actually creates a row in the database', async () => {
    const created = await postDs.createPost({
      title: 'Integration test post',
      body: 'Body of the integration test post',
      userId: '602',
    });

    expect(created?.title).toBe('Integration test post');
    expect(created?.userId).toBe('602');

    const fetched = await postDs.getPost(created!.id);
    expect(fetched?.title).toBe('Integration test post');
  });

  it('updatePost rejects when the logged-in user is not the owner (sad path)', async () => {
    const created = await postDs.createPost({
      title: "Owner's post",
      body: 'Body',
      userId: '602',
    });

    await expect(
      postDs.updatePost(created!.id, { title: 'Takeover' }, '903'),
    ).rejects.toThrow(AuthenticationError);
  });

  it('updatePost persists the change when the owner is the one updating', async () => {
    const created = await postDs.createPost({
      title: 'Original title',
      body: 'Body',
      userId: '602',
    });

    const updated = await postDs.updatePost(
      created!.id,
      { title: 'Updated title' },
      '602',
    );

    expect(updated?.title).toBe('Updated title');
  });

  it('deletePost removes the row and rejects when not the owner (sad + happy path)', async () => {
    const created = await postDs.createPost({
      title: 'Post to delete',
      body: 'Body',
      userId: '602',
    });

    await expect(postDs.deletePost(created!.id, '903')).rejects.toThrow(
      AuthenticationError,
    );

    const deleted = await postDs.deletePost(created!.id, '602');
    expect(deleted).toBe(true);
    expect(await postDs.getPost(created!.id)).toBeNull();
  });

  it("batchLoadByUserId returns the user's real posts via DataLoader", async () => {
    const posts = await postDs.batchLoadByUserId(115); // talita.melo — owns several seeded posts
    expect(posts.length).toBeGreaterThan(0);
    expect(posts.every((p) => p.userId === '115')).toBe(true);
  });

  it('real ON DELETE CASCADE: deleting the user automatically deletes their posts', async () => {
    const user = await userDs.createUser({
      firstName: 'Cascade',
      lastName: 'Test',
      userName: 'cascade.posts.test',
      password: 'Senha123',
    });

    const post = await postDs.createPost({
      title: 'This post should disappear along with the user',
      body: 'Body',
      userId: user!.id,
    });

    await userDs.deleteUser(user!.id);

    const orphanCheck = await postDs.getPost(post!.id);
    expect(orphanCheck).toBeNull();
  });

  it('getPosts throws UserInputError for an invalid _sort (injection attempt), without touching MySQL', async () => {
    await expect(
      postDs.getPosts({ _sort: 'title; DROP TABLE posts; --' }),
    ).rejects.toThrow(UserInputError);

    // the real table remains intact
    const [{ count }] = await knex('posts').count({ count: '*' });
    expect(Number(count)).toBeGreaterThan(0);
  });
});
