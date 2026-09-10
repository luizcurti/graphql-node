import crypto from 'crypto';

// comments.comment is a TEXT column — MySQL can't put a plain unique index
// on it without a prefix length, and a prefix isn't reliable for dedup (two
// different long comments can share the first N bytes). Hashing it into a
// fixed-width column lets the DB enforce (user_id, post_id, comment_hash)
// uniqueness directly, replacing the old check-then-insert query that raced
// under concurrent identical requests.
export const hashComment = (comment: string): string =>
  crypto.createHash('md5').update(comment).digest('hex');
