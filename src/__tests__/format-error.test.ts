import { GraphQLError, type GraphQLFormattedError } from 'graphql';

jest.mock('../utils/logger', () => ({
  logger: { error: jest.fn() },
}));

import { logger } from '../utils/logger';
import { formatGraphQLError, SAFE_ERROR_CODES } from '../graphql/format-error';

beforeEach(() => jest.clearAllMocks());

describe('formatGraphQLError — happy path (known codes pass through)', () => {
  it.each([...SAFE_ERROR_CODES])(
    'returns the error unchanged for code %s',
    (code) => {
      const formattedError: GraphQLFormattedError = {
        message: 'A known, safe error message',
        extensions: { code },
      };

      const result = formatGraphQLError(
        formattedError,
        new Error('irrelevant'),
      );

      expect(result).toBe(formattedError);
      expect(logger.error).not.toHaveBeenCalled();
    },
  );
});

describe('formatGraphQLError — sad path (unknown/missing codes are masked)', () => {
  it('masks an error with an unrecognized code and logs the original', () => {
    const original = new Error('SQL syntax error near table users');
    const formattedError: GraphQLFormattedError = {
      message: original.message,
      extensions: { code: 'SOME_DRIVER_ERROR' },
    };

    const result = formatGraphQLError(formattedError, original);

    expect(result).toEqual({
      message: 'Internal server error',
      extensions: { code: 'INTERNAL_SERVER_ERROR' },
    });
    expect(logger.error).toHaveBeenCalledWith(
      { err: original.message },
      'Unhandled GraphQL error',
    );
  });

  it('masks an error with no extensions/code at all', () => {
    const formattedError: GraphQLFormattedError = {
      message: 'TypeError: Cannot read properties of undefined',
    };

    const result = formatGraphQLError(formattedError, new TypeError('boom'));

    expect(result.message).toBe('Internal server error');
    expect(result.extensions).toEqual({ code: 'INTERNAL_SERVER_ERROR' });
  });

  it('falls back to the formatted message when the raw error has no message', () => {
    const formattedError: GraphQLFormattedError = {
      message: 'formatted fallback message',
      extensions: { code: 'UNKNOWN' },
    };

    formatGraphQLError(formattedError, null);

    expect(logger.error).toHaveBeenCalledWith(
      { err: 'formatted fallback message' },
      'Unhandled GraphQL error',
    );
  });

  it('does not mistake a real GraphQLError instance for a safe one without a matching code', () => {
    const err = new GraphQLError('boom', { extensions: { code: 'WEIRD' } });
    const formattedError: GraphQLFormattedError = {
      message: err.message,
      extensions: err.extensions,
    };

    const result = formatGraphQLError(formattedError, err);

    expect(result.extensions?.code).toBe('INTERNAL_SERVER_ERROR');
  });
});
