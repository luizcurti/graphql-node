import {
  checkIsLoggedIn,
  checkOwner,
} from '../graphql/schema/login/utils/login-functions';
import { AuthenticationError } from '../graphql/errors';

describe('checkIsLoggedIn', () => {
  it('throws AuthenticationError when loggedUserId is empty string', () => {
    expect(() => checkIsLoggedIn('')).toThrow(AuthenticationError);
  });

  it('throws AuthenticationError when loggedUserId is null', () => {
    expect(() => checkIsLoggedIn(null)).toThrow(AuthenticationError);
  });

  it('throws AuthenticationError when loggedUserId is undefined', () => {
    expect(() => checkIsLoggedIn(undefined)).toThrow(AuthenticationError);
  });

  it('does not throw when loggedUserId is a valid string', () => {
    expect(() => checkIsLoggedIn('user-123')).not.toThrow();
  });
});

describe('checkOwner', () => {
  it('throws AuthenticationError when user is not logged in', () => {
    expect(() => checkOwner('user-123', '')).toThrow(AuthenticationError);
  });

  it('throws AuthenticationError when logged user is not the resource owner', () => {
    expect(() => checkOwner('user-123', 'user-456')).toThrow(
      AuthenticationError,
    );
  });

  it('does not throw when logged user is the resource owner', () => {
    expect(() => checkOwner('user-123', 'user-123')).not.toThrow();
  });
});
