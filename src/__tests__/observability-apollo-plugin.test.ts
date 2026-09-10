jest.mock('../observability/metrics', () => ({
  graphqlOperationsTotal: { inc: jest.fn() },
  graphqlOperationDuration: { observe: jest.fn() },
}));

import {
  graphqlOperationsTotal,
  graphqlOperationDuration,
} from '../observability/metrics';
import { metricsPlugin } from '../observability/apollo-plugin';

describe('metricsPlugin', () => {
  beforeEach(() => jest.clearAllMocks());

  it('records success metrics with the resolved operation type', async () => {
    const listener = await metricsPlugin.requestDidStart!({} as never);
    await listener!.didResolveOperation!({
      operation: { operation: 'mutation' },
    } as never);
    await listener!.willSendResponse!({ errors: undefined } as never);

    expect(graphqlOperationsTotal.inc).toHaveBeenCalledWith({
      operation_type: 'mutation',
      status: 'success',
    });
    expect(graphqlOperationDuration.observe).toHaveBeenCalledWith(
      { operation_type: 'mutation' },
      expect.any(Number),
    );
  });

  it('records error status when the response carries errors', async () => {
    const listener = await metricsPlugin.requestDidStart!({} as never);
    await listener!.didResolveOperation!({
      operation: { operation: 'query' },
    } as never);
    await listener!.willSendResponse!({
      errors: [new Error('boom')],
    } as never);

    expect(graphqlOperationsTotal.inc).toHaveBeenCalledWith({
      operation_type: 'query',
      status: 'error',
    });
  });

  it('defaults to "unknown" when the operation never resolves', async () => {
    const listener = await metricsPlugin.requestDidStart!({} as never);
    await listener!.willSendResponse!({ errors: undefined } as never);

    expect(graphqlOperationsTotal.inc).toHaveBeenCalledWith({
      operation_type: 'unknown',
      status: 'success',
    });
  });

  it('defaults to "unknown" when didResolveOperation reports no operation', async () => {
    const listener = await metricsPlugin.requestDidStart!({} as never);
    await listener!.didResolveOperation!({ operation: undefined } as never);
    await listener!.willSendResponse!({ errors: undefined } as never);

    expect(graphqlOperationsTotal.inc).toHaveBeenCalledWith({
      operation_type: 'unknown',
      status: 'success',
    });
  });
});
