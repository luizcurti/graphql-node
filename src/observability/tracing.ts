import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

// Distributed tracing is opt-in (same additive-optional pattern as
// REDIS_URL/KAFKA_BROKERS): with no collector configured, this file is a
// no-op and adds zero instrumentation overhead. Loaded via `-r` (see
// package.json's dev/start scripts) so http/express get patched before
// anything else in the app requires them.
let sdk: NodeSDK | null = null;

const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (otlpEndpoint) {
  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'graphql-node',
    }),
    traceExporter: new OTLPTraceExporter({ url: `${otlpEndpoint}/v1/traces` }),
    instrumentations: [new HttpInstrumentation(), new ExpressInstrumentation()],
  });

  sdk.start();
}

export const shutdownTracing = async (): Promise<void> => {
  if (!sdk) return;
  await sdk.shutdown();
};
