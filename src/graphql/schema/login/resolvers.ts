import type { Context } from '../../context/types';
import type { LoginResult } from './datasources';

export const login = async (
  _: unknown,
  { data }: { data: { userName: string; password: string } },
  { dataSources }: Context,
): Promise<LoginResult> => {
  const { userName, password } = data;
  return dataSources.loginApi!.login(userName, password);
};

export const logout = async (
  _: unknown,
  { userName }: { userName: string },
  { dataSources }: Context,
): Promise<boolean> => {
  return dataSources.loginApi!.logout(userName);
};

export const loginResolvers = {
  Mutation: { login, logout },
};
