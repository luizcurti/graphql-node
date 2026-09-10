import { UserInputError, ValidationError } from '../../../errors';

export const validateUserName = (userName: string): void => {
  // A single `+` here, not `([a-z0-9_.-]+)+` — that nested-quantifier form
  // matches the exact same strings but is catastrophically slow on a long
  // run of valid characters with no match at the end (each character can
  // be grouped in exponentially many ways between the two `+`s). CodeQL
  // flags this pattern (js/redos) for good reason: a ~30-character input
  // already takes seconds to reject; a longer one can hang the process.
  const userNameRegExp = /^[a-z][a-z0-9_.-]+$/i;

  if (!userNameRegExp.test(userName)) {
    throw new ValidationError(`userName must match ${userNameRegExp}`);
  }
};

export const validateUserPassword = (password: string): void => {
  const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{6,30}$/;

  if (!password.match(strongPasswordRegex)) {
    throw new UserInputError(
      'Password must contain at least: ' +
        'One lower case letter, one upper case letter and one number.',
    );
  }
};
