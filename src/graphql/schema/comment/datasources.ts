import type { Knex } from 'knex';
import { ValidationError } from '../../errors';
import { SQLDatasource } from '../../datasources/sql/sql-datasource';
import { publishCommentCreated } from '../../../kafka/producer';

export interface CommentRow {
  id: number;
  comment: string;
  user_id: string | number;
  post_id: string | number;
  created_at: Date | string;
}

export interface Comment {
  id: number;
  comment: string;
  user_id: string | number;
  createdAt: string;
}

export interface CreateCommentInput {
  userId: string;
  postId: string;
  comment: string;
  postOwner?: string | null;
}

const commentReducer = (comment: CommentRow): Comment => {
  return {
    id: comment.id,
    comment: comment.comment,
    user_id: comment.user_id,
    createdAt: new Date(comment.created_at).toISOString(),
  };
};

export class CommentSQLDataSource extends SQLDatasource<string, Comment[]> {
  tableName = 'comments';

  constructor(dbConnection: Knex, readConnection?: Knex) {
    super(dbConnection, readConnection);
  }

  async getById(id: string | number): Promise<CommentRow | undefined> {
    return this.db(this.tableName).where('id', '=', id).first();
  }

  // Field resolver for Post.comments — a list read with no write dependency
  // in the same request, so it's safe to serve from the replica.
  async getByPostId(post_id: string | number): Promise<Comment[]> {
    const query = this.readDb(this.tableName).where({ post_id });
    const comments: CommentRow[] = await query;
    return comments.map((comment) => commentReducer(comment));
  }

  async create({
    userId,
    postId,
    comment,
    postOwner = null,
  }: CreateCommentInput): Promise<Comment & { post_id: string }> {
    const partialComment = {
      user_id: userId,
      post_id: postId,
      comment,
    };

    const exists = await this.db(this.tableName).where(partialComment);
    if (exists.length > 0) {
      throw new ValidationError('Comment already created');
    }

    const created = await this.db(this.tableName).insert(partialComment);
    const commentToReturn = {
      id: created[0],
      createdAt: new Date().toISOString(),
      ...partialComment,
    };

    await publishCommentCreated({
      createdComment: commentToReturn,
      postOwner,
    });

    return commentToReturn;
  }

  async batchLoaderCallback(post_ids: readonly string[]): Promise<Comment[][]> {
    const query = this.readDb(this.tableName).whereIn(
      'post_id',
      post_ids as string[],
    );
    const comments: CommentRow[] = await query;
    const filteredComments = post_ids.map((post_id) => {
      return comments
        .filter((comment) => String(comment.post_id) === String(post_id))
        .map((comment) => commentReducer(comment));
    });
    return filteredComments;
  }
}
