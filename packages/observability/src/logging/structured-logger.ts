import {
  getCorrelationAttributes,
  runWithCorrelation,
  useCorrelationId,
} from "./correlation";
import {
  LogEntry,
  LogLevel,
  LogSink,
  LoggingOptions,
  TraceBridge,
} from "./interfaces";

const severity: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class StructuredLogger {
  constructor(
    private readonly options: LoggingOptions,
    private readonly sink: LogSink,
    private readonly traceBridge?: TraceBridge,
  ) {}

  debug(message: string, context?: Record<string, unknown>) {
    this.emit("debug", message, context);
  }

  info(message: string, context?: Record<string, unknown>) {
    this.emit("info", message, context);
  }

  warn(message: string, context?: Record<string, unknown>) {
    this.emit("warn", message, context);
  }

  error(message: string, context?: Record<string, unknown>) {
    this.emit("error", message, context);
  }

  async profile<T>(
    label: string,
    fn: () => Promise<T> | T,
    context?: Record<string, unknown>,
  ): Promise<T> {
    const startedAt = Date.now();
    try {
      const result = await fn();
      this.emit("debug", `${label} completed`, {
        ...context,
        profiler: {
          label,
          durationMs: Date.now() - startedAt,
        },
      });
      return result;
    } catch (error) {
      this.emit("error", `${label} failed`, {
        ...context,
        profiler: {
          label,
          durationMs: Date.now() - startedAt,
        },
        error: serializeError(error),
      });
      throw error;
    }
  }

  withCorrelation<T>(
    correlationId: string,
    fn: () => Promise<T> | T,
    attributes?: Record<string, unknown>,
  ) {
    return runWithCorrelation(correlationId, fn, attributes);
  }

  private emit(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
  ) {
    if (!this.shouldLog(level)) {
      return;
    }
    const span = this.traceBridge?.getActiveSpan() ?? {};
    const profiler =
      context && "profiler" in context
        ? (context.profiler as LogEntry["profiler"])
        : undefined;
    const normalizedContext = context ? { ...context } : undefined;
    if (normalizedContext && "profiler" in normalizedContext) {
      delete (normalizedContext as Record<string, unknown>).profiler;
    }
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      service: this.options.serviceName,
      correlationId: useCorrelationId(),
      traceId: span.traceId,
      spanId: span.spanId,
      context: normalizedContext ?? getCorrelationAttributes(),
      profiler,
    };
    const payload = JSON.stringify(entry);
    this.sink(payload, entry);
  }

  private shouldLog(level: LogLevel): boolean {
    const configured = this.options.logLevel ?? "info";
    return severity[level] >= severity[configured];
  }
}

const serializeError = (error: unknown) => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { message: String(error) };
};
