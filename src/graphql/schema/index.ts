import gql from 'graphql-tag';
import type { DocumentNode } from 'graphql';

import { apiFiltersResolvers } from './api-filters/resolvers';
import { apiFiltersTypeDefs } from './api-filters/typedefs';

import { commentResolvers } from './comment/resolvers';
import { commentTypedefs } from './comment/typedefs';

import { loginResolvers } from './login/resolvers';
import { loginTypedefs } from './login/typedefs';

import { postResolvers } from './post/resolvers';
import { postTypeDefs } from './post/typedefs';

import { userResolvers } from './user/resolvers';
import { userTypeDefs } from './user/typedefs';

const rootTypeDefs = gql`
  type Query {
    _empty: Boolean
  }

  type Mutation {
    _empty: Boolean
  }

  type Subscription {
    _empty: Boolean
  }
`;

const rootResolvers = {
  Query: {
    _empty: (): boolean => true,
  },

  Mutation: {
    _empty: (): boolean => true,
  },
};

export const typeDefs: DocumentNode[] = [
  rootTypeDefs,
  userTypeDefs,
  postTypeDefs,
  apiFiltersTypeDefs,
  loginTypedefs,
  commentTypedefs,
];
export const resolvers = [
  rootResolvers,
  userResolvers,
  postResolvers,
  apiFiltersResolvers,
  loginResolvers,
  commentResolvers,
];
