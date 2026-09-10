import { GraphQLError, type GraphQLErrorExtensions } from 'graphql';

abstract class ApolloServerErrorBase extends GraphQLError {
  constructor(
    message: string,
    code: string,
    extensions?: GraphQLErrorExtensions,
  ) {
    super(message, { extensions: { code, ...extensions } });
    this.name = this.constructor.name;
  }
}

export class AuthenticationError extends ApolloServerErrorBase {
  constructor(message: string, extensions?: GraphQLErrorExtensions) {
    super(message, 'UNAUTHENTICATED', extensions);
  }
}

export class UserInputError extends ApolloServerErrorBase {
  constructor(message: string, extensions?: GraphQLErrorExtensions) {
    super(message, 'BAD_USER_INPUT', extensions);
  }
}

export class ValidationError extends ApolloServerErrorBase {
  constructor(message: string, extensions?: GraphQLErrorExtensions) {
    super(message, 'GRAPHQL_VALIDATION_FAILED', extensions);
  }
}
