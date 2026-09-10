export const COMMENT_CREATED_TOPIC = 'comment.created';

// Malformed comment.created messages the consumer can't parse are
// republished here instead of just being logged and dropped — see
// ./consumer.ts — so they can be inspected/replayed rather than lost.
export const COMMENT_CREATED_DLQ_TOPIC = 'comment.created.dlq';
