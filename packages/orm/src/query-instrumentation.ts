import { QueryPlan } from "./query/criteria";

export type QueryExecutionMode = "many" | "one" | "count" | "paginate";

export interface QueryPlanMetricsPayload {
  plan: QueryPlan;
  operation: QueryExecutionMode;
  durationMs: number;
  resultCount: number;
  driverName: string;
  source: "driver" | "table";
  driverPushdown: boolean;
  relationsLoaded: boolean;
  joins: number;
  filters: number;
  timestamp: number;
  error?: unknown;
}

export type QueryPlanMetricsHandler = (
  payload: QueryPlanMetricsPayload,
) => void | Promise<void>;

const metricsListeners = new Set<QueryPlanMetricsHandler>();

export const registerQueryInstrumentation = (
  listener: QueryPlanMetricsHandler,
): (() => void) => {
  metricsListeners.add(listener);
  return () => metricsListeners.delete(listener);
};

export const emitQueryPlanMetrics = async (
  payload: QueryPlanMetricsPayload,
): Promise<void> => {
  const tasks: Promise<void>[] = [];
  for (const listener of metricsListeners) {
    try {
      const result = listener(payload);
      if (result && typeof (result as Promise<void>).then === "function") {
        tasks.push(
          (result as Promise<void>).catch((error) => {
            console.error("[ocd-js][orm] query instrumentation error", error);
          }),
        );
      }
    } catch (error) {
      console.error("[ocd-js][orm] query instrumentation error", error);
    }
  }
  if (tasks.length) {
    await Promise.all(tasks);
  }
};

const resolveStaticHandler = (
  target: Function,
  propertyKey: string | symbol,
): QueryPlanMetricsHandler => {
  const descriptor = Object.getOwnPropertyDescriptor(target, propertyKey);
  if (!descriptor || typeof descriptor.value !== "function") {
    throw new Error("QueryPlanMetricsListener must decorate a static method");
  }
  return descriptor.value.bind(target) as QueryPlanMetricsHandler;
};

export const QueryPlanMetricsListener = (): MethodDecorator => {
  return (target, propertyKey) => {
    if (typeof target !== "function") {
      throw new Error("QueryPlanMetricsListener must decorate a static method");
    }
    const handler = resolveStaticHandler(target, propertyKey);
    registerQueryInstrumentation(handler);
  };
};
