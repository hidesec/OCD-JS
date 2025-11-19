export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LoggingOptions {
  serviceName: string;
  logLevel?: LogLevel;
}

export interface TraceBridgeMetadata {
  traceId?: string;
  spanId?: string;
}

export interface TraceBridge {
  getActiveSpan(): TraceBridgeMetadata;
}

export type LogSink = (payload: string, entry: LogEntry) => void;

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  service: string;
  correlationId?: string;
  traceId?: string;
  spanId?: string;
  context?: Record<string, unknown>;
  profiler?: {
    label: string;
    durationMs: number;
  };
}
