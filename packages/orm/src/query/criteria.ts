export type ComparisonOperator<V> = {
  op: "eq" | "gt" | "lt" | "like" | "in";
  value: any;
};

export type ConditionValue<V> = V | ComparisonOperator<V>;

export const MoreThan = <V>(value: V): ComparisonOperator<V> => ({
  op: "gt",
  value,
});

export const LessThan = <V>(value: V): ComparisonOperator<V> => ({
  op: "lt",
  value,
});

export const Like = (value: string): ComparisonOperator<string> => ({
  op: "like",
  value,
});

export const In = <V>(value: V[]): ComparisonOperator<V[]> => ({
  op: "in",
  value,
});

export type WhereCondition<T> = Partial<
  Record<keyof T, ConditionValue<any> | undefined>
>;

export interface ScalarFilter {
  field: string;
  operator: ComparisonOperator<any>["op"];
  value: any;
}

export type AggregateFunction = "count" | "sum" | "avg" | "min" | "max";

export interface AggregateSelection {
  alias: string;
  field?: string;
  fn: AggregateFunction;
  distinct?: boolean;
}

export interface SelectExpression {
  field: string;
  alias?: string;
}

export interface QueryPlan {
  table: string;
  filters: ScalarFilter[];
  orderBy?: { field: string; direction: "asc" | "desc" };
  limit?: number;
  offset?: number;
  select?: SelectExpression[];
  aggregates?: AggregateSelection[];
  groupBy?: string[];
  having?: ScalarFilter[];
}

export const isOperator = <V>(
  value: ConditionValue<V>,
): value is ComparisonOperator<V> =>
  typeof value === "object" && value !== null && "op" in value;

export const normalizeCondition = <V>(value: ConditionValue<V>) =>
  isOperator(value)
    ? value
    : ({ op: "eq", value } satisfies ComparisonOperator<V>);
