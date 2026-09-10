import {
  validateUserName,
  validateUserPassword,
} from '../graphql/schema/user/utils/user-repository';
import { ValidationError, UserInputError } from '../graphql/errors';

describe('validateUserName', () => {
  it('throws ValidationError for userName starting with a digit', () => {
    expect(() => validateUserName('1user')).toThrow(ValidationError);
  });

  it('throws ValidationError for userName with spaces', () => {
    expect(() => validateUserName('user name')).toThrow(ValidationError);
  });

  it('throws ValidationError for single character userName', () => {
    expect(() => validateUserName('a')).toThrow(ValidationError);
  });

  it('accepts valid userName with dots', () => {
    expect(() => validateUserName('john.doe')).not.toThrow();
  });

  it('accepts valid userName with underscores and numbers', () => {
    expect(() => validateUserName('john_doe123')).not.toThrow();
  });
});

describe('validateUserPassword', () => {
  it('throws UserInputError for password without uppercase letter', () => {
    expect(() => validateUserPassword('lowercase1')).toThrow(UserInputError);
  });

  it('throws UserInputError for password without a number', () => {
    expect(() => validateUserPassword('NoNumbers!')).toThrow(UserInputError);
  });

  it('throws UserInputError for password shorter than 6 characters', () => {
    expect(() => validateUserPassword('Ab1')).toThrow(UserInputError);
  });

  it('accepts a strong password meeting all criteria', () => {
    expect(() => validateUserPassword('StrongPass1')).not.toThrow();
  });
});
