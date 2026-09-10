import pino from 'pino';
import { trace } from '@opentelemetry/api';

// When tracing is enabled (see ../observability/tracing.ts), stamp every log
// line with the active span's ids so logs and traces can be cross-referenced
// in a collector that ingests both. `getActiveSpan()` is always safe to call
// — it's a documented no-op (returns undefined) when no SDK is initialized.
export const traceMixin = (): Record<string, string> => {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (!spanContext) return {};
  return { trace_id: spanContext.traceId, span_id: spanContext.spanId };
};

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  mixin: traceMixin,
  ...(process.env.NODE_ENV !== 'production' && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true },
    },
  }),
});
