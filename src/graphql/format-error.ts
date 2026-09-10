import type { GraphQLFormattedError } from 'graphql';
import { logger } from '../utils/logger';

// Codes our own resolvers/plugins deliberately throw with (see ./errors.ts,
// ./complexity-limit.ts) plus the standard codes Apollo Server itself
// assigns to parse/validation/CSRF failures. Anything else (a raw driver
// error, a bug throwing a plain Error) is a leak of internal detail and
// gets masked below instead of reaching the client.
export const SAFE_ERROR_CODES = new Set([
  'UNAUTHENTICATED',
  'BAD_USER_INPUT',
  'GRAPHQL_VALIDATION_FAILED',
  'GRAPHQL_PARSE_FAILED',
  'BAD_REQUEST',
  'PERSISTED_QUERY_NOT_FOUND',
  'PERSISTED_QUERY_NOT_SUPPORTED',
]);

// Anything not in SAFE_ERROR_CODES is a driver error, a bug, or otherwise
// unclassified — the original is logged server-side and only a generic
// message reaches the client, so e.g. a raw MySQL constraint error never
// leaks column/table names.
export const formatGraphQLError = (
  formattedError: GraphQLFormattedError,
  error: unknown,
): GraphQLFormattedError => {
  const code = formattedError.extensions?.code;
  if (typeof code === 'string' && SAFE_ERROR_CODES.has(code)) {
    return formattedError;
  }

  logger.error(
    { err: (error as Error)?.message ?? formattedError.message },
    'Unhandled GraphQL error',
  );

  return {
    message: 'Internal server error',
    extensions: { code: 'INTERNAL_SERVER_ERROR' },
  };
};
