import { registerQueryInstrumentation } from "../query-instrumentation";

export type OrmLogLevel = "info" | "debug";

export interface OrmQueryLoggingOptions {
  enabled?: boolean;
  level?: OrmLogLevel;
  redactParams?: boolean;
  maxSqlLength?: number;
  sink?: (
    level: OrmLogLevel,
    message: string,
    context: Record<string, unknown>,
  ) => void;
}

let lastUninstall: (() => void) | undefined;

export const installOrmQueryLogger = (
  options: OrmQueryLoggingOptions = {},
): (() => void) => {
  const level: OrmLogLevel = options.level ?? "info";
  const redact = Boolean(options.redactParams);
  const maxSql = options.maxSqlLength ?? 2000;
  const sink = options.sink ?? ((_, __, ___) => undefined);

  const normalizeSql = (sql?: string) => {
    if (!sql) return undefined;
    if (sql.length > maxSql) return sql.slice(0, maxSql) + "...";
    return sql;
  };

  const normalizeParams = (params?: unknown[]) => {
    if (!params) return undefined;
    if (redact) return params.map(() => "[REDACTED]");
    return params;
  };

  // ensure single active listener (idempotent)
  if (lastUninstall) {
    try {
      lastUninstall();
    } catch {}
    lastUninstall = undefined;
  }

  const off = registerQueryInstrumentation((m) => {
    const msg = "orm.query";
    const context: Record<string, unknown> = {
      operation: m.operation,
      durationMs: m.durationMs,
      resultCount: m.resultCount,
      driver: m.driverName,
      source: m.source,
      driverPushdown: m.driverPushdown,
      relationsLoaded: m.relationsLoaded,
      joins: m.joins,
      joinTypes: m.joinTypes,
      filters: m.filters,
      relationFilters: m.relationFilters,
      relationFilterModes: m.relationFilterModes,
      requestedRelations: m.requestedRelations,
      scanType: m.scanType,
      timestamp: m.timestamp,
      error: m.error ? String(m.error) : undefined,
      sql: normalizeSql(m.sql),
      params: normalizeParams(m.params),
    };
    sink(level, msg, context);
  });
  lastUninstall = off;
  return () => {
    try {
      off();
    } finally {
      if (lastUninstall === off) lastUninstall = undefined;
    }
  };
};
