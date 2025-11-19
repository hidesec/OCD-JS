import { Counter, Gauge, Histogram, MetricsRegistry } from "./registry";

export const renderOpenMetrics = (registry: MetricsRegistry): string => {
  const lines: string[] = [];
  registry.entries().forEach((metric) => {
    if (metric.help) {
      lines.push(`# HELP ${metric.name} ${metric.help}`);
    }
    lines.push(`# TYPE ${metric.name} ${metric.kind}`);
    if (metric instanceof Counter) {
      lines.push(renderMetricLine(metric.name, metric.value, metric.labels));
    } else if (metric instanceof Gauge) {
      lines.push(renderMetricLine(metric.name, metric.value, metric.labels));
    } else if (metric instanceof Histogram) {
      const snapshot = metric.snapshot();
      snapshot.buckets.forEach((bucket) => {
        lines.push(
          renderMetricLine(`${metric.name}_bucket`, bucket.count, {
            ...(metric.labels ?? {}),
            le: bucket.upperBound.toString(),
          }),
        );
      });
      lines.push(
        renderMetricLine(`${metric.name}_sum`, snapshot.sum, metric.labels),
      );
      lines.push(
        renderMetricLine(`${metric.name}_count`, snapshot.count, metric.labels),
      );
    }
  });
  lines.push("# EOF");
  return lines.join("\n");
};

const renderMetricLine = (
  name: string,
  value: number,
  labels?: Record<string, string>,
) => {
  const labelPart =
    labels && Object.keys(labels).length
      ? `{${Object.entries(labels)
          .map(([key, val]) => `${key}="${val}"`)
          .join(",")}}`
      : "";
  return `${name}${labelPart} ${value}`;
};
