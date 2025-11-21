import { QueryPlanMetricsPayload } from "@ocd-js/orm";

export interface QueryMetricSummary {
  total: number;
  driverPushdown: number;
  avgDurationMs: number;
}

export const summarizeQueryMetrics = (
  metrics: QueryPlanMetricsPayload[],
): QueryMetricSummary => {
  const aggregate = metrics.reduce(
    (acc, payload) => {
      acc.total += 1;
      acc.driverPushdown += payload.driverPushdown ? 1 : 0;
      acc.durationSum += payload.durationMs;
      return acc;
    },
    { total: 0, driverPushdown: 0, durationSum: 0 },
  );
  const avgDurationMs =
    aggregate.total === 0 ? 0 : aggregate.durationSum / aggregate.total;
  return {
    total: aggregate.total,
    driverPushdown: aggregate.driverPushdown,
    avgDurationMs,
  };
};
