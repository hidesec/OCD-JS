import { QueryPlanMetricsPayload } from "@ocd-js/orm";

export interface QueryMetricSummary {
  total: number;
  driverPushdown: number;
  tableScans: number;
  avgDurationMs: number;
  pushdownRate: number;
  relationFilterUsage: {
    total: number;
    modes: Record<"some" | "every" | "none", number>;
  };
}

export const summarizeQueryMetrics = (
  metrics: QueryPlanMetricsPayload[],
): QueryMetricSummary => {
  const aggregate = metrics.reduce(
    (acc, payload) => {
      acc.total += 1;
      acc.driverPushdown += payload.driverPushdown ? 1 : 0;
      acc.durationSum += payload.durationMs;
      acc.relationFilters += payload.relationFilters;
      for (const mode of payload.relationFilterModes) {
        acc.relationFilterModes[mode] += 1;
      }
      return acc;
    },
    {
      total: 0,
      driverPushdown: 0,
      durationSum: 0,
      relationFilters: 0,
      relationFilterModes: { some: 0, every: 0, none: 0 },
    },
  );
  const avgDurationMs =
    aggregate.total === 0 ? 0 : aggregate.durationSum / aggregate.total;
  const tableScans = aggregate.total - aggregate.driverPushdown;
  const pushdownRate =
    aggregate.total === 0 ? 0 : aggregate.driverPushdown / aggregate.total;
  return {
    total: aggregate.total,
    driverPushdown: aggregate.driverPushdown,
    tableScans,
    avgDurationMs,
    pushdownRate,
    relationFilterUsage: {
      total: aggregate.relationFilters,
      modes: aggregate.relationFilterModes,
    },
  };
};
