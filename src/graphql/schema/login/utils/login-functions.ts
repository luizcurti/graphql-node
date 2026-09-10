import { AuthenticationError } from '../../../errors';

export const checkIsLoggedIn = (
  loggedUserId: string | null | undefined,
): void => {
  if (!loggedUserId) {
    throw new AuthenticationError('You have to log in');
  }
};

export const checkOwner = (
  userId: string,
  loggedUserId: string | null | undefined,
): void => {
  checkIsLoggedIn(loggedUserId);

  if (loggedUserId !== userId) {
    throw new AuthenticationError('You cannot update this user.');
  }
};
