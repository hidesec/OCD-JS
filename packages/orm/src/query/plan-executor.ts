import { QueryPlan } from "./criteria";

export const executePlan = (
  rows: Record<string, unknown>[],
  plan: QueryPlan,
): Record<string, unknown>[] => {
  let filtered = plan.filters.length
    ? rows.filter((row) => matchesFilters(row, plan.filters))
    : rows;

  if (plan.groupBy?.length || plan.aggregates?.length) {
    return applyAggregation(filtered, plan);
  }

  let result = plan.orderBy ? applyOrdering(filtered, plan.orderBy) : filtered;
  result = applyPaging(result, plan.offset, plan.limit);
  if (plan.select?.length) {
    result = projectRows(result, plan.select);
  }
  return result;
};

const matchesFilters = (
  row: Record<string, unknown>,
  filters: QueryPlan["filters"],
) =>
  filters.every((filter) => {
    const value = row[filter.field] as any;
    switch (filter.operator) {
      case "gt":
        return value > filter.value;
      case "lt":
        return value < filter.value;
      case "like":
        return (
          typeof value === "string" &&
          value.toLowerCase().includes(String(filter.value).toLowerCase())
        );
      case "in":
        return Array.isArray(filter.value)
          ? filter.value.includes(value)
          : false;
      case "eq":
      default:
        return value === filter.value;
    }
  });

const applyOrdering = (
  rows: Record<string, unknown>[],
  order: NonNullable<QueryPlan["orderBy"]>,
): Record<string, unknown>[] => {
  const { field, direction } = order;
  return [...rows].sort((a, b) => {
    const lhs = a[field as string] as any;
    const rhs = b[field as string] as any;
    if (lhs === rhs) return 0;
    const cmp = lhs > rhs ? 1 : -1;
    return direction === "desc" ? -cmp : cmp;
  });
};

const applyPaging = (
  rows: Record<string, unknown>[],
  offset?: number,
  limit?: number,
): Record<string, unknown>[] => {
  let result = rows;
  if (offset !== undefined) {
    result = result.slice(offset);
  }
  if (limit !== undefined) {
    result = result.slice(0, limit);
  }
  return result;
};

const projectRows = (
  rows: Record<string, unknown>[],
  select: NonNullable<QueryPlan["select"]>,
): Record<string, unknown>[] =>
  rows.map((row) => {
    const projected: Record<string, unknown> = {};
    for (const projection of select) {
      projected[projection.alias ?? projection.field] = row[projection.field];
    }
    return projected;
  });

const applyAggregation = (
  rows: Record<string, unknown>[],
  plan: QueryPlan,
): Record<string, unknown>[] => {
  const groups = new Map<string, Record<string, unknown>[]>();
  if (plan.groupBy?.length) {
    for (const row of rows) {
      const key = plan.groupBy
        .map((field) => JSON.stringify(row[field]))
        .join("|");
      const bucket = groups.get(key) ?? [];
      bucket.push(row);
      groups.set(key, bucket);
    }
  } else {
    groups.set("__all__", rows);
  }

  let aggregated: Record<string, unknown>[] = [];
  for (const [, groupRows] of groups) {
    if (!groupRows.length) continue;
    aggregated.push(buildAggregateRow(groupRows, plan));
  }

  if (plan.having?.length) {
    aggregated = aggregated.filter((row) => matchesFilters(row, plan.having!));
  }

  if (plan.orderBy) {
    aggregated = applyOrdering(aggregated, plan.orderBy);
  }

  return applyPaging(aggregated, plan.offset, plan.limit);
};

const buildAggregateRow = (
  rows: Record<string, unknown>[],
  plan: QueryPlan,
): Record<string, unknown> => {
  const sample = rows[0];
  const projected: Record<string, unknown> = {};
  plan.groupBy?.forEach((field) => {
    projected[field] = sample[field];
  });
  plan.select?.forEach((selection) => {
    projected[selection.alias ?? selection.field] = sample[selection.field];
  });
  plan.aggregates?.forEach((aggregate) => {
    projected[aggregate.alias] = computeAggregate(rows, aggregate);
  });
  return projected;
};

const computeAggregate = (
  rows: Record<string, unknown>[],
  aggregate: NonNullable<QueryPlan["aggregates"]>[number],
): number | string | null => {
  const collectValues = (): any[] => {
    if (!aggregate.field) {
      return rows;
    }
    const values = rows
      .map((row) => row[aggregate.field!])
      .filter((value) => value !== undefined && value !== null);
    if (aggregate.distinct) {
      return Array.from(new Set(values));
    }
    return values;
  };

  const values = collectValues();
  switch (aggregate.fn) {
    case "count":
      return aggregate.field ? values.length : rows.length;
    case "sum": {
      return values.reduce((total, value) => total + Number(value ?? 0), 0);
    }
    case "avg": {
      if (!values.length) return 0;
      const sum = values.reduce(
        (total, value) => total + Number(value ?? 0),
        0,
      );
      return sum / values.length;
    }
    case "min":
      if (!values.length) return null;
      return values.reduce(
        (min, value) => (min === undefined || value < min ? value : min),
        values[0],
      );
    case "max":
      if (!values.length) return null;
      return values.reduce(
        (max, value) => (max === undefined || value > max ? value : max),
        values[0],
      );
    default:
      return null;
  }
};
