import { DatabaseDriver, QueryCapableDriver } from "./driver";
import { EntityMetadata } from "./metadata";
import {
  ConditionValue,
  ComparisonOperator,
  AggregateSelection,
  QueryPlan,
  SelectExpression,
  WhereCondition,
  isOperator,
  normalizeCondition,
} from "./query/criteria";
import {
  emitQueryPlanMetrics,
  QueryExecutionMode,
} from "./query-instrumentation";
import { executePlan } from "./query/plan-executor";

type Predicate<T> = (entity: T) => boolean;
type Hydrator<T> = (entities: T[], relations: string[]) => Promise<T[]>;

export interface QueryOptions<T> {
  where?: WhereCondition<T>;
  orderBy?: { field: keyof T | string; direction?: "asc" | "desc" };
  limit?: number;
  offset?: number;
  relations?: string[];
  joins?: JoinOptions[];
  relationFilters?: RelationFilterOption[];
}

export interface PaginationResult<T> {
  items: T[];
  meta: {
    total: number;
    page: number;
    perPage: number;
    pageCount: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
}

export interface JoinOptions {
  path: string;
  type?: "inner" | "left";
  predicate?: (value: any) => boolean;
}

export interface RelationFilterOption {
  path: string;
  predicate: (value: any) => boolean;
  mode?: "some" | "every" | "none";
}

interface RelationFilter {
  path: string;
  predicate: (value: any) => boolean;
  mode: "some" | "every" | "none";
}

interface JoinRequirement {
  path: string;
  type: "inner" | "left";
  predicate?: (value: any) => boolean;
}

export interface QueryBuilderOptions<T extends object> {
  hasEagerRelations?: boolean;
  rowFactory?: (row: Record<string, unknown>) => T;
}

export class QueryBuilder<T extends object> {
  private readonly scalarConditions: Array<{
    field: string;
    condition: ConditionValue<any>;
  }> = [];
  private readonly scalarPredicates: Predicate<T>[] = [];
  private readonly customPredicates: Predicate<T>[] = [];
  private order?: { field: keyof T | string; direction: "asc" | "desc" };
  private take?: number;
  private skip?: number;
  private readonly requestedRelations = new Set<string>();
  private readonly relationFilters: RelationFilter[] = [];
  private readonly joinRequirements: JoinRequirement[] = [];
  private readonly projections: SelectExpression[] = [];
  private readonly aggregateSelections: AggregateSelection[] = [];
  private readonly groupByFields: string[] = [];
  private readonly havingPredicates: Array<{
    field: string;
    condition: ConditionValue<any>;
  }> = [];
  private projectionMode: "entity" | "raw" = "entity";
  private readonly hasEagerRelations: boolean;
  private readonly rowFactory?: (row: Record<string, unknown>) => T;

  constructor(
    private readonly metadata: EntityMetadata,
    private readonly driver: DatabaseDriver,
    private readonly hydrator?: Hydrator<T>,
    options: QueryBuilderOptions<T> = {},
  ) {
    this.hasEagerRelations = options.hasEagerRelations ?? false;
    this.rowFactory = options.rowFactory;
  }

  where<K extends keyof T>(field: K, value: ConditionValue<T[K]>): this {
    const targetField = field as string;
    this.scalarConditions.push({ field: targetField, condition: value });
    this.scalarPredicates.push(createScalarPredicate(targetField, value));
    return this;
  }

  andWhere(predicate: Predicate<T>): this {
    this.ensureEntityMode("andWhere");
    this.customPredicates.push(predicate);
    return this;
  }

  orderBy(field: keyof T | string, direction: "asc" | "desc" = "asc"): this {
    this.order = { field, direction };
    return this;
  }

  limit(limit: number): this {
    this.take = limit;
    return this;
  }

  offset(offset: number): this {
    this.skip = offset;
    return this;
  }

  setOptions(options?: QueryOptions<T>): this {
    if (!options) return this;
    if (options.where) {
      Object.entries(options.where).forEach(([key, value]) => {
        if (value !== undefined) {
          this.where(key as keyof T, value as ConditionValue<any>);
        }
      });
    }
    if (options.orderBy) {
      this.orderBy(options.orderBy.field, options.orderBy.direction);
    }
    if (options.limit !== undefined) {
      this.limit(options.limit);
    }
    if (options.offset !== undefined) {
      this.offset(options.offset);
    }
    if (options.relations) {
      this.withRelations(options.relations);
    }
    options.joins?.forEach((join) =>
      this.join(join.path, join.type ?? "inner", join.predicate),
    );
    options.relationFilters?.forEach((filter) =>
      this.whereRelation(filter.path, filter.predicate, {
        mode: filter.mode,
      }),
    );
    return this;
  }

  withRelations(relations: string[]): this {
    this.ensureEntityMode("withRelations");
    relations.forEach((relation) => this.requestedRelations.add(relation));
    return this;
  }

  innerJoin(path: string, predicate?: (value: any) => boolean): this {
    return this.join(path, "inner", predicate);
  }

  leftJoin(path: string, predicate?: (value: any) => boolean): this {
    return this.join(path, "left", predicate);
  }

  whereRelation(
    path: string,
    predicate: ((value: any) => boolean) | ConditionValue<any>,
    options: { mode?: "some" | "every" | "none" } = {},
  ): this {
    this.ensureEntityMode("whereRelation");
    const matcher =
      typeof predicate === "function"
        ? predicate
        : createComparisonPredicate(predicate);
    const mode = options.mode ?? "some";
    this.relationFilters.push({ path, predicate: matcher, mode });
    this.requestedRelations.add(path);
    return this;
  }

  select(...fields: Array<SelectExpression | keyof T | string>): this {
    this.enableRawMode();
    fields.forEach((field) => {
      const descriptor: SelectExpression =
        typeof field === "string" ? { field } : (field as SelectExpression);
      this.assertSimpleField(descriptor.field, "select");
      this.projections.push({
        field: descriptor.field,
        alias: descriptor.alias,
      });
    });
    return this;
  }

  selectAggregate(
    alias: string,
    fn: AggregateSelection["fn"],
    field?: keyof T | string,
    options: { distinct?: boolean } = {},
  ): this {
    if (!alias) {
      throw new Error("Aggregate selections require an alias");
    }
    this.enableRawMode();
    if (field) {
      this.assertSimpleField(field as string, "selectAggregate");
    }
    this.aggregateSelections.push({
      alias,
      fn,
      field: field as string | undefined,
      distinct: options.distinct ?? false,
    });
    return this;
  }

  groupBy(...fields: Array<keyof T | string>): this {
    this.enableRawMode();
    fields.forEach((field) => {
      const target = field as string;
      this.assertSimpleField(target, "groupBy");
      if (!this.groupByFields.includes(target)) {
        this.groupByFields.push(target);
      }
    });
    return this;
  }

  having(field: string, condition: ConditionValue<any>): this {
    this.enableRawMode();
    if (!field) {
      throw new Error("having requires a field or aggregate alias");
    }
    this.havingPredicates.push({ field, condition });
    return this;
  }

  async getRawMany(): Promise<Record<string, unknown>[]> {
    this.enableRawMode();
    return this.executeRaw(false, "raw-many");
  }

  async getRawOne(): Promise<Record<string, unknown> | null> {
    this.enableRawMode();
    const previousLimit = this.take;
    this.take = 1;
    const [first] = await this.executeRaw(false, "raw-one");
    this.take = previousLimit;
    return first ?? null;
  }

  async getMany(): Promise<T[]> {
    this.assertEntityProjection("getMany");
    return this.execute(false, "many");
  }

  async getOne(): Promise<T | null> {
    this.assertEntityProjection("getOne");
    const previousLimit = this.take;
    this.take = 1;
    const [first] = await this.execute(false, "one");
    this.take = previousLimit;
    return first ?? null;
  }

  async count(): Promise<number> {
    this.assertEntityProjection("count");
    const entities = await this.execute(true, "count");
    return entities.length;
  }

  async paginate(page: number, perPage: number): Promise<PaginationResult<T>> {
    this.assertEntityProjection("paginate");
    const normalizedPage = Math.max(page, 1);
    const normalizedPerPage = Math.max(perPage, 1);
    const entities = await this.execute(true, "paginate");
    const total = entities.length;
    const start = (normalizedPage - 1) * normalizedPerPage;
    const windowed = entities.slice(start, start + normalizedPerPage);
    const pageCount = Math.max(1, Math.ceil(total / normalizedPerPage));
    return {
      items: windowed,
      meta: {
        total,
        page: normalizedPage,
        perPage: normalizedPerPage,
        pageCount,
        hasNext: normalizedPage < pageCount,
        hasPrevious: normalizedPage > 1,
      },
    };
  }

  private join(
    path: string,
    type: "inner" | "left",
    predicate?: (value: any) => boolean,
  ): this {
    this.ensureEntityMode("join");
    this.joinRequirements.push({ path, type, predicate });
    this.requestedRelations.add(path);
    return this;
  }

  private instantiate(row: any): T {
    if (this.rowFactory) {
      return this.rowFactory(row);
    }
    return this.metadata.columns.reduce(
      (instance, column) => {
        (instance as any)[column.propertyKey] = row[column.propertyKey];
        return instance;
      },
      new (this.metadata.target as new () => T)(),
    );
  }

  private async execute(
    ignorePaging: boolean,
    mode: QueryExecutionMode,
  ): Promise<T[]> {
    const plan = this.buildQueryPlan(ignorePaging);
    const started = Date.now();
    const timestamp = started;
    let driverPushdown = false;
    let source: "driver" | "table" = "table";
    let entities: T[] = [];
    let relationsLoaded = false;
    let error: unknown;
    const joinTypeCounts = this.summarizeJoinTypes();
    try {
      const queried = await this.tryDriverQuery(plan);
      driverPushdown = queried !== null;
      source = driverPushdown ? "driver" : "table";
      const rows = driverPushdown
        ? queried!
        : await this.driver.readTable<any>(this.metadata.tableName);

      entities = rows.map((row) => this.instantiate(row));
      entities = this.applyScalarPredicates(entities);

      const requiresHydration = this.needsHydration();
      relationsLoaded = requiresHydration;
      if (requiresHydration) {
        if (!this.hydrator) {
          throw new Error(
            "Relation operations require a repository-backed query builder",
          );
        }
        const relations = Array.from(this.collectRelationPaths());
        entities = await this.hydrator(entities, relations);
      }

      entities = this.applyJoinRequirements(entities);
      entities = this.applyRelationFilters(entities);
      entities = this.applyOrdering(entities);
      const driverHandledPaging =
        driverPushdown &&
        !ignorePaging &&
        (plan.limit !== undefined || plan.offset !== undefined);
      if (!ignorePaging && !driverHandledPaging) {
        entities = this.sliceEntities(entities);
      }
      return entities;
    } catch (err) {
      error = err;
      throw err;
    } finally {
      await emitQueryPlanMetrics({
        plan,
        operation: mode,
        durationMs: Date.now() - started,
        resultCount: entities.length,
        driverName: this.driver.constructor?.name ?? "UnknownDriver",
        source,
        driverPushdown,
        relationsLoaded,
        joins: this.joinRequirements.length,
        joinTypes: joinTypeCounts,
        filters: plan.filters.length,
        relationFilters: this.relationFilters.length,
        relationFilterModes: this.relationFilters.map((filter) => filter.mode),
        requestedRelations: this.requestedRelations.size,
        scanType: driverPushdown ? "driverPushdown" : "tableScan",
        timestamp,
        error,
      });
    }
  }

  private async executeRaw(
    ignorePaging: boolean,
    mode: QueryExecutionMode,
  ): Promise<Record<string, unknown>[]> {
    const plan = this.buildQueryPlan(ignorePaging);
    const started = Date.now();
    const timestamp = started;
    let driverPushdown = false;
    let source: "driver" | "table" = "table";
    let rows: Record<string, unknown>[] = [];
    let error: unknown;
    try {
      const queried = await this.tryDriverQuery(plan);
      if (queried) {
        driverPushdown = true;
        source = "driver";
        rows = queried as Record<string, unknown>[];
      } else {
        const tableRows = await this.driver.readTable<Record<string, unknown>>(
          this.metadata.tableName,
        );
        rows = executePlan(tableRows, plan);
      }
      return rows;
    } catch (err) {
      error = err;
      throw err;
    } finally {
      await emitQueryPlanMetrics({
        plan,
        operation: mode,
        durationMs: Date.now() - started,
        resultCount: rows.length,
        driverName: this.driver.constructor?.name ?? "UnknownDriver",
        source,
        driverPushdown,
        relationsLoaded: false,
        joins: 0,
        joinTypes: { inner: 0, left: 0 },
        filters: plan.filters.length,
        relationFilters: 0,
        relationFilterModes: [],
        requestedRelations: 0,
        scanType: driverPushdown ? "driverPushdown" : "tableScan",
        timestamp,
        error,
      });
    }
  }

  private applyScalarPredicates(entities: T[]): T[] {
    const predicates = [...this.scalarPredicates, ...this.customPredicates];
    if (!predicates.length) return entities;
    return entities.filter((entity) =>
      predicates.every((predicate) => predicate(entity)),
    );
  }

  private applyJoinRequirements(entities: T[]): T[] {
    if (!this.joinRequirements.length) return entities;
    return entities.filter((entity) =>
      this.joinRequirements.every((join) => {
        const value = readPath(entity, join.path);
        if (value === undefined || value === null) {
          return join.type === "left";
        }
        if (Array.isArray(value)) {
          if (!value.length) {
            return join.type === "left";
          }
          const matches = join.predicate
            ? value.some((item) => join.predicate!(item))
            : true;
          return join.type === "inner" ? matches : true;
        }
        if (join.predicate) {
          const satisfied = join.predicate(value);
          return join.type === "inner" ? satisfied : true;
        }
        return true;
      }),
    );
  }

  private applyRelationFilters(entities: T[]): T[] {
    if (!this.relationFilters.length) return entities;
    return entities.filter((entity) =>
      this.relationFilters.every((filter) =>
        evaluateRelationFilter(entity, filter),
      ),
    );
  }

  private applyOrdering(entities: T[]): T[] {
    if (!this.order) return entities;
    const { field, direction } = this.order;
    const sorted = [...entities].sort((a, b) => {
      const lhs = readPath(a, field as string);
      const rhs = readPath(b, field as string);
      if (lhs === rhs) return 0;
      const comparison = lhs > rhs ? 1 : -1;
      return direction === "asc" ? comparison : -comparison;
    });
    return sorted;
  }

  private sliceEntities(entities: T[]): T[] {
    let result = entities;
    if (this.skip !== undefined) {
      result = result.slice(this.skip);
    }
    if (this.take !== undefined) {
      result = result.slice(0, this.take);
    }
    return result;
  }

  private needsHydration(): boolean {
    return (
      this.hasEagerRelations ||
      this.requestedRelations.size > 0 ||
      this.relationFilters.length > 0 ||
      this.joinRequirements.length > 0
    );
  }

  private collectRelationPaths(): Set<string> {
    const paths = new Set<string>();
    for (const relation of this.requestedRelations) {
      paths.add(relation);
    }
    for (const filter of this.relationFilters) {
      paths.add(filter.path);
    }
    for (const join of this.joinRequirements) {
      paths.add(join.path);
    }
    return paths;
  }

  private summarizeJoinTypes(): { inner: number; left: number } {
    return this.joinRequirements.reduce(
      (acc, join) => {
        acc[join.type] += 1;
        return acc;
      },
      { inner: 0, left: 0 } as { inner: number; left: number },
    );
  }

  private isRawMode(): boolean {
    return this.projectionMode === "raw";
  }

  private enableRawMode(): void {
    if (this.projectionMode === "raw") {
      return;
    }
    if (
      this.requestedRelations.size ||
      this.joinRequirements.length ||
      this.relationFilters.length ||
      this.customPredicates.length
    ) {
      throw new Error(
        "Raw projections and aggregates cannot be combined with relation loading, joins, relation filters, or custom predicates",
      );
    }
    this.projectionMode = "raw";
  }

  private ensureEntityMode(feature: string): void {
    if (this.isRawMode()) {
      throw new Error(
        `${feature} is not supported when raw projections or aggregates are configured`,
      );
    }
  }

  private assertEntityProjection(operation: string): void {
    if (this.isRawMode()) {
      throw new Error(
        `${operation} cannot be used with raw projections or aggregates. Use getRawMany/getRawOne instead`,
      );
    }
  }

  private assertSimpleField(field: string, feature: string): void {
    if (!isSimpleField(field)) {
      throw new Error(
        `${feature} only supports scalar columns. Received ${field}`,
      );
    }
  }

  private buildQueryPlan(ignorePaging: boolean): QueryPlan {
    const filters = this.scalarConditions
      .filter(({ field }) => isSimpleField(field))
      .map(({ field, condition }) => {
        const normalized = normalizeCondition(condition);
        return {
          field,
          operator: normalized.op,
          value: normalized.value,
        };
      });
    const orderField =
      this.order && isSimpleField(this.order.field as string)
        ? (this.order.field as string)
        : undefined;
    const select = this.projections.length ? [...this.projections] : undefined;
    const aggregates = this.aggregateSelections.length
      ? [...this.aggregateSelections]
      : undefined;
    const groupBy = this.groupByFields.length
      ? [...this.groupByFields]
      : undefined;
    const having = this.havingPredicates
      .filter((entry) => entry.field)
      .map(({ field, condition }) => {
        const normalized = normalizeCondition(condition);
        return {
          field,
          operator: normalized.op,
          value: normalized.value,
        };
      });
    return {
      table: this.metadata.tableName,
      filters,
      orderBy: orderField
        ? { field: orderField, direction: this.order!.direction }
        : undefined,
      limit: ignorePaging ? undefined : this.take,
      offset: ignorePaging ? undefined : this.skip,
      select,
      aggregates,
      groupBy,
      having: having.length ? having : undefined,
    };
  }

  private async tryDriverQuery(plan: QueryPlan): Promise<any[] | null> {
    const driver = this.driver as QueryCapableDriver;
    if (typeof driver.executeQuery !== "function") {
      return null;
    }
    if (this.customPredicates.length) {
      return null;
    }
    if (driver.supportsQuery && driver.supportsQuery(plan) === false) {
      return null;
    }
    return driver.executeQuery(plan);
  }
}

const createScalarPredicate = (
  field: string,
  expected: ConditionValue<any>,
): Predicate<any> => {
  const matcher = createComparisonPredicate(expected);
  return (entity) => matcher((entity as any)[field]);
};

const createComparisonPredicate = (
  expected: ConditionValue<any>,
): ((value: any) => boolean) => {
  const normalized = normalizeCondition(expected);
  switch (normalized.op) {
    case "gt":
      return (value) => value > normalized.value;
    case "lt":
      return (value) => value < normalized.value;
    case "like":
      return (value) =>
        typeof value === "string" &&
        value.toLowerCase().includes(String(normalized.value).toLowerCase());
    case "in":
      return (value) =>
        Array.isArray(normalized.value) && normalized.value.includes(value);
    case "eq":
    default:
      return (value) => value === normalized.value;
  }
};

const evaluateRelationFilter = <T>(
  entity: T,
  filter: RelationFilter,
): boolean => {
  const value = readPath(entity, filter.path);
  const values = Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value];
  if (filter.mode === "none") {
    if (!values.length) return true;
    return !values.some((item) => filter.predicate(item));
  }
  if (!values.length) {
    return false;
  }
  const matched = values.filter((item) => filter.predicate(item));
  if (filter.mode === "every") {
    return matched.length === values.length;
  }
  return matched.length > 0;
};

const readPath = (target: any, path: string): any => {
  if (!path) return target;
  return path.split(".").reduce((acc, key) => {
    if (acc === undefined || acc === null) return undefined;
    return acc[key];
  }, target);
};

const isSimpleField = (field: string): boolean => !field.includes(".");

export { In, LessThan, Like, MoreThan } from "./query/criteria";
