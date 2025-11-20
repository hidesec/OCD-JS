import { QueryPlan } from "./criteria";

export const executePlan = (
  rows: Record<string, unknown>[],
  plan: QueryPlan,
): Record<string, unknown>[] => {
  let result = rows;
  if (plan.filters.length) {
    result = result.filter((row) => matchesFilters(row, plan));
  }
  if (plan.orderBy) {
    const { field, direction } = plan.orderBy;
    result = [...result].sort((a, b) => {
      const lhs = a[field as string] as any;
      const rhs = b[field as string] as any;
      if (lhs === rhs) return 0;
      const cmp = lhs > rhs ? 1 : -1;
      return direction === "desc" ? -cmp : cmp;
    });
  }
  if (plan.offset !== undefined) {
    result = result.slice(plan.offset);
  }
  if (plan.limit !== undefined) {
    result = result.slice(0, plan.limit);
  }
  return result;
};

const matchesFilters = (row: Record<string, unknown>, plan: QueryPlan) =>
  plan.filters.every((filter) => {
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
