import type { ApolloServerPlugin } from '@apollo/server';
import { GraphQLError } from 'graphql';
import { getComplexity, simpleEstimator } from 'graphql-query-complexity';

// depthLimit(7) (see ../index.ts) only bounds *nesting* — a wide-but-shallow
// query that repeats an expensive field hundreds of times via aliases
// (`a0: post(id:"1"){title} a1: post(id:"1"){title} ...`) has low depth but
// can still force hundreds of resolver calls. This closes that gap by
// capping the total number of selected fields instead.
//
// simpleEstimator counts *selections*, not list sizes or DB rows — it can't
// tell that `posts` returns N rows. That's a deliberate simplification for
// this schema's scale; a field-by-field DB-cost model would use
// fieldExtensionsEstimator with per-field `extensions.complexity` instead.
//
// This is a plugin, not a validationRule (Apollo Server 5's
// `validationRules` option only accepts a static array — no access to the
// request's actual variable values). graphql-query-complexity needs real
// variables to coerce the query's variable definitions; without them it
// fails on any query with a required variable (`$id: ID!` etc.) before it
// ever gets to computing a complexity score. didResolveOperation has
// `request.variables`, so the check runs here instead.
export const MAX_QUERY_COMPLEXITY = 1000;

export const complexityLimitPlugin: ApolloServerPlugin = {
  async requestDidStart() {
    return {
      async didResolveOperation({ document, request, operationName, schema }) {
        const complexity = getComplexity({
          schema,
          query: document,
          variables: request.variables,
          operationName: operationName ?? undefined,
          estimators: [simpleEstimator({ defaultComplexity: 1 })],
        });

        if (complexity > MAX_QUERY_COMPLEXITY) {
          throw new GraphQLError(
            `The query exceeds the maximum complexity of ${MAX_QUERY_COMPLEXITY}. Actual complexity is ${complexity}`,
            { extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } },
          );
        }
      },
    };
  },
};
