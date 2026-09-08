import type { ApolloServerPlugin } from '@apollo/server';
import { graphqlOperationsTotal, graphqlOperationDuration } from './metrics';

// Records GraphQL-level metrics (as opposed to the generic HTTP metrics in
// ./metrics.ts, which only see "POST /"). Labeled by operation *type*
// (query/mutation/subscription), never by operation name — the name is
// client-supplied and would let a caller mint unbounded label series.
export const metricsPlugin: ApolloServerPlugin = {
  async requestDidStart() {
    const start = process.hrtime.bigint();
    let operationType = 'unknown';

    return {
      async didResolveOperation({ operation }) {
        operationType = operation?.operation ?? 'unknown';
      },
      async willSendResponse({ errors }) {
        const seconds = Number(process.hrtime.bigint() - start) / 1e9;
        const status = errors && errors.length > 0 ? 'error' : 'success';

        graphqlOperationDuration.observe(
          { operation_type: operationType },
          seconds,
        );
        graphqlOperationsTotal.inc({ operation_type: operationType, status });
      },
    };
  },
};
