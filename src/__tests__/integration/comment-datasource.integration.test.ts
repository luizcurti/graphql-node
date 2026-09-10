import { knex } from '../../knex';
import { CommentSQLDataSource } from '../../graphql/schema/comment/datasources';
import { PostSQLDataSource } from '../../graphql/schema/post/sql-datasource';
import { ValidationError } from '../../graphql/errors';
import { resetDb } from './helpers/reset-db';
import { disconnectProducer } from '../../kafka/producer';

jest.mock('../../graphql/pubsub', () => ({
  pubSub: { publish: jest.fn() },
  CREATED_COMMENT_TRIGGER: 'CREATED_COMMENT',
}));

describe('[integration] CommentSQLDataSource (real MySQL)', () => {
  let commentDs: CommentSQLDataSource;
  let postDs: PostSQLDataSource;

  beforeAll(async () => {
    await resetDb(knex);
  });

  afterAll(async () => {
    // createComment() below goes through the real publishCommentCreated(),
    // which connects the module-level Kafka producer singleton when
    // KAFKA_BROKERS is set (it is, by default — see .env.example). Without
    // this, that TCP connection to the broker stays open after the last
    // test and Jest never exits on its own.
    await disconnectProducer();
    await knex.destroy();
  });

  beforeEach(() => {
    commentDs = new CommentSQLDataSource(knex);
    commentDs.initialize({ context: {}, cache: undefined });
    postDs = new PostSQLDataSource(knex);
    postDs.initialize({ context: {}, cache: undefined });
  });

  it('create + getById: actually creates a row in the database (happy path)', async () => {
    const created = await commentDs.create({
      userId: '602',
      postId: '645',
      comment: 'Unique integration test comment',
    });

    const fetched = await commentDs.getById(created.id);
    expect(fetched?.comment).toBe('Unique integration test comment');
  });

  it('create rejects a duplicate comment against the real database state (sad path)', async () => {
    await commentDs.create({
      userId: '602',
      postId: '645',
      comment: 'Unique comment to check for duplicates',
    });

    await expect(
      commentDs.create({
        userId: '602',
        postId: '645',
        comment: 'Unique comment to check for duplicates',
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('batchLoaderCallback correctly groups real comments by post_id', async () => {
    const grouped = await commentDs.batchLoaderCallback(['361', '999999']);
    expect(grouped[0].length).toBeGreaterThan(0);
    expect(grouped[1]).toEqual([]);
  });

  it('real ON DELETE CASCADE: deleting the post automatically deletes its comments', async () => {
    const post = await postDs.createPost({
      title: 'Post with a comment for the cascade test',
      body: 'Body',
      userId: '602',
    });

    const comment = await commentDs.create({
      userId: '602',
      postId: post!.id,
      comment: 'This comment should disappear along with the post',
    });

    await postDs.deletePost(post!.id, '602');

    const orphanComment = await commentDs.getById(comment.id);
    expect(orphanComment).toBeUndefined();
  });
});
