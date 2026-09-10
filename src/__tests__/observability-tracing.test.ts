describe('observability/tracing', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_SERVICE_NAME;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('is a no-op when OTEL_EXPORTER_OTLP_ENDPOINT is not set', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { shutdownTracing } = require('../observability/tracing');

    await expect(shutdownTracing()).resolves.toBeUndefined();
  });

  it('starts the SDK and shuts it down when OTEL_EXPORTER_OTLP_ENDPOINT is set', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318';
    process.env.OTEL_SERVICE_NAME = 'test-service';

    const start = jest.fn();
    const shutdown = jest.fn().mockResolvedValue(undefined);
    const NodeSDKMock = jest
      .fn()
      .mockImplementation(() => ({ start, shutdown }));

    jest.doMock('@opentelemetry/sdk-node', () => ({ NodeSDK: NodeSDKMock }));
    jest.doMock('@opentelemetry/exporter-trace-otlp-http', () => ({
      OTLPTraceExporter: jest.fn().mockImplementation((opts) => opts),
    }));
    jest.doMock('@opentelemetry/instrumentation-http', () => ({
      HttpInstrumentation: jest.fn(),
    }));
    jest.doMock('@opentelemetry/instrumentation-express', () => ({
      ExpressInstrumentation: jest.fn(),
    }));
    jest.doMock('@opentelemetry/resources', () => ({
      resourceFromAttributes: jest.fn((attrs) => attrs),
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { shutdownTracing } = require('../observability/tracing');

    expect(NodeSDKMock).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);

    await shutdownTracing();
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it('defaults the service name to "graphql-node" when OTEL_SERVICE_NAME is unset', () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318';

    const resourceFromAttributes = jest.fn((attrs) => attrs);
    jest.doMock('@opentelemetry/sdk-node', () => ({
      NodeSDK: jest.fn().mockImplementation(() => ({ start: jest.fn() })),
    }));
    jest.doMock('@opentelemetry/exporter-trace-otlp-http', () => ({
      OTLPTraceExporter: jest.fn(),
    }));
    jest.doMock('@opentelemetry/instrumentation-http', () => ({
      HttpInstrumentation: jest.fn(),
    }));
    jest.doMock('@opentelemetry/instrumentation-express', () => ({
      ExpressInstrumentation: jest.fn(),
    }));
    jest.doMock('@opentelemetry/resources', () => ({ resourceFromAttributes }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../observability/tracing');

    expect(resourceFromAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'service.name': 'graphql-node',
      }),
    );
  });
});
