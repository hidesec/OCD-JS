import { promises as fs } from "node:fs";
import path from "node:path";
import initSqlJs, {
  Database as SqlJsDatabase,
  SqlJsStatic,
  SqlValue,
} from "sql.js";
import { QueryPlan } from "../query/criteria";
import {
  buildTransactionalInterface,
  normalizeAction,
  quoteIdent,
  quoteLiteral,
  quoteValue,
  requiresRebuild,
} from "./base";
import {
  ColumnSchema,
  DatabaseDriver,
  ForeignKeySchema,
  PersistedState,
  TableSchema,
  TransactionDriver,
  UniqueConstraintSchema,
} from "./interfaces";

declare const require: NodeRequire;

export interface SqliteDriverOptions {
  filePath?: string;
  locateFile?: (file: string) => string;
}

export class SqliteDatabaseDriver implements DatabaseDriver {
  private SQL?: SqlJsStatic;
  private db?: SqlJsDatabase;
  private schemaCache = new Map<string, TableSchema>();
  private initialized = false;

  constructor(private readonly options: SqliteDriverOptions = {}) {}

  async init(): Promise<void> {
    if (!this.SQL) {
      const locateFile =
        this.options.locateFile ??
        ((file: string) => {
          const wasmDir = path.dirname(
            require.resolve("sql.js/dist/sql-wasm.js"),
          );
          return path.join(wasmDir, file);
        });
      this.SQL = await initSqlJs({ locateFile });
    }
    this.db?.close();
    this.db = await this.createDatabase();
    this.initialized = true;
    await this.run("PRAGMA foreign_keys = ON;");
    await this.refreshSchemaCache();
  }

  async ensureTable(schema: TableSchema): Promise<void> {
    const existing = await this.getSchema(schema.name);
    if (!existing) {
      await this.createTable(schema);
      this.schemaCache.set(schema.name, schema);
      await this.persist();
      return;
    }
    if (requiresRebuild(existing, schema)) {
      await this.rebuildTable(existing, schema);
    } else {
      await this.addMissingColumns(existing, schema);
    }
    await this.syncUniqueConstraints(schema);
    this.schemaCache.set(schema.name, schema);
    await this.persist();
  }

  async readTable<T>(name: string): Promise<T[]> {
    const rows = await this.select(
      `SELECT * FROM ${quoteIdent(name)} ORDER BY rowid ASC`,
    );
    return rows as T[];
  }

  async writeTable<T>(name: string, rows: T[]): Promise<void> {
    const schema = await this.getSchema(name);
    if (!schema) {
      throw new Error(`Schema missing for table ${name}`);
    }
    await this.run(`DELETE FROM ${quoteIdent(name)}`);
    if (!rows.length) {
      await this.persist();
      return;
    }
    const columns = schema.columns.map((column) => column.name);
    const placeholders = columns.map(() => "?").join(",");
    const stmt = this.getDatabase().prepare(
      `INSERT INTO ${quoteIdent(name)} (${columns
        .map(quoteIdent)
        .join(",")}) VALUES (${placeholders})`,
    );
    try {
      for (const row of rows) {
        const values = columns.map((column) =>
          this.toSqliteValue((row as any)[column]),
        );
        stmt.run(values as SqlValue[]);
      }
    } finally {
      stmt.free();
    }
    await this.persist();
  }

  async getSchema(name: string): Promise<TableSchema | undefined> {
    if (this.schemaCache.has(name)) {
      return this.schemaCache.get(name);
    }
    const schema = await this.describeTable(name);
    if (schema) {
      this.schemaCache.set(name, schema);
    }
    return schema;
  }

  async updateSchema(schema: TableSchema): Promise<void> {
    await this.ensureTable(schema);
  }

  async beginTransaction(): Promise<TransactionDriver> {
    const snapshot = await this.dumpState();
    return buildTransactionalInterface(snapshot, async (next) => {
      await this.applyState(next);
    });
  }

  async dropTable(name: string): Promise<void> {
    await this.run(`DROP TABLE IF EXISTS ${quoteIdent(name)}`);
    await this.dropUniqueIndexes(name);
    this.schemaCache.delete(name);
    await this.persist();
  }

  supportsQuery(plan: QueryPlan): boolean {
    return this.canCompilePlan(plan);
  }

  async executeQuery<T>(plan: QueryPlan): Promise<T[]> {
    if (!this.canCompilePlan(plan)) {
      throw new Error(
        "Query plan contains unsupported filters for sqlite driver",
      );
    }
    const { sql, params } = this.compilePlan(plan);
    const rows = await this.select(sql, params);
    return rows as T[];
  }

  private async createDatabase(): Promise<SqlJsDatabase> {
    if (!this.SQL) {
      throw new Error("sql.js is not initialized");
    }
    if (!this.options.filePath) {
      return new this.SQL.Database();
    }
    try {
      const buffer = await fs.readFile(this.options.filePath);
      return new this.SQL.Database(buffer);
    } catch (error: any) {
      if (error.code === "ENOENT") {
        return new this.SQL.Database();
      }
      throw error;
    }
  }

  private getDatabase(): SqlJsDatabase {
    if (!this.initialized || !this.db) {
      throw new Error("SqliteDatabaseDriver not initialized");
    }
    return this.db;
  }

  private async refreshSchemaCache(): Promise<void> {
    const tables = await this.listTables();
    for (const table of tables) {
      const schema = await this.describeTable(table);
      if (schema) {
        this.schemaCache.set(table, schema);
      }
    }
  }

  private async describeTable(name: string): Promise<TableSchema | undefined> {
    const info = await this.select(`PRAGMA table_info(${quoteLiteral(name)})`);
    if (!info.length) return undefined;
    const columns: ColumnSchema[] = info.map((column: any) => ({
      name: column.name,
      type: (column.type as string) ?? "text",
      nullable: column.notnull === 0,
      default: column.dflt_value ?? undefined,
    }));
    const primaryColumns = info
      .filter((column: any) => column.pk > 0)
      .sort((a: any, b: any) => a.pk - b.pk)
      .map((column: any) => column.name);
    const uniqueConstraints = await this.loadUniqueConstraints(name);
    const foreignKeys = await this.loadForeignKeys(name);
    return {
      name,
      columns,
      primaryColumns,
      uniqueConstraints,
      foreignKeys,
    };
  }

  private async loadUniqueConstraints(
    name: string,
  ): Promise<UniqueConstraintSchema[]> {
    const indexes = await this.select(
      `PRAGMA index_list(${quoteLiteral(name)})`,
    );
    const uniques = indexes.filter((index: any) => index.unique);
    const constraints: UniqueConstraintSchema[] = [];
    for (const index of uniques) {
      const columns = await this.select(
        `PRAGMA index_info(${quoteLiteral(index.name)})`,
      );
      constraints.push({
        name: index.name,
        columns: columns
          .sort((a: any, b: any) => a.seqno - b.seqno)
          .map((column: any) => column.name),
      });
    }
    return constraints;
  }

  private async loadForeignKeys(name: string): Promise<ForeignKeySchema[]> {
    const rows = await this.select(
      `PRAGMA foreign_key_list(${quoteLiteral(name)})`,
    );
    const grouped = new Map<number, ForeignKeySchema>();
    for (const row of rows) {
      const id = row.id as number;
      if (!grouped.has(id)) {
        grouped.set(id, {
          name: `${name}_fk_${row.id}`,
          columns: [],
          referencedTable: row.table,
          referencedColumns: [],
          onDelete: normalizeAction(row.on_delete),
          onUpdate: normalizeAction(row.on_update),
        });
      }
      const entry = grouped.get(id)!;
      entry.columns.push(row.from);
      entry.referencedColumns.push(row.to);
    }
    return Array.from(grouped.values());
  }

  private async createTable(schema: TableSchema): Promise<void> {
    const columnDefinitions = schema.columns.map((column) =>
      this.columnDefinition(column),
    );
    const constraints = this.buildConstraintDefinitions(schema);
    const sql = `CREATE TABLE IF NOT EXISTS ${quoteIdent(schema.name)} (${[
      ...columnDefinitions,
      ...constraints,
    ].join(",")})`;
    await this.run(sql);
    await this.syncUniqueConstraints(schema);
  }

  private buildConstraintDefinitions(schema: TableSchema): string[] {
    const constraints: string[] = [];
    if (schema.primaryColumns?.length) {
      constraints.push(
        `PRIMARY KEY (${schema.primaryColumns.map(quoteIdent).join(",")})`,
      );
    }
    for (const fk of schema.foreignKeys ?? []) {
      const clauses: string[] = [];
      if (fk.onDelete) {
        clauses.push(`ON DELETE ${fk.onDelete.toUpperCase()}`);
      }
      if (fk.onUpdate) {
        clauses.push(`ON UPDATE ${fk.onUpdate.toUpperCase()}`);
      }
      constraints.push(
        `FOREIGN KEY (${fk.columns
          .map(quoteIdent)
          .join(
            ",",
          )}) REFERENCES ${quoteIdent(fk.referencedTable)} (${fk.referencedColumns
          .map(quoteIdent)
          .join(",")}) ${clauses.join(" ")}`.trim(),
      );
    }
    return constraints;
  }

  private columnDefinition(
    column: ColumnSchema,
    relaxedNotNull = false,
  ): string {
    const parts = [quoteIdent(column.name), this.sqliteType(column.type)];
    if (!relaxedNotNull && column.nullable === false) {
      parts.push("NOT NULL");
    }
    if (column.default !== undefined) {
      parts.push(`DEFAULT ${quoteValue(column.default)}`);
    }
    return parts.join(" ");
  }

  private sqliteType(type?: string): string {
    switch ((type ?? "string").toLowerCase()) {
      case "number":
        return "NUMERIC";
      case "boolean":
        return "INTEGER";
      case "date":
        return "TEXT";
      case "json":
        return "TEXT";
      default:
        return "TEXT";
    }
  }

  private async addMissingColumns(current: TableSchema, desired: TableSchema) {
    const existing = new Set(current.columns.map((column) => column.name));
    for (const column of desired.columns) {
      if (existing.has(column.name)) continue;
      await this.run(
        `ALTER TABLE ${quoteIdent(desired.name)} ADD COLUMN ${this.columnDefinition(column, true)}`,
      );
    }
  }

  private async rebuildTable(
    current: TableSchema,
    desired: TableSchema,
  ): Promise<void> {
    await this.run("PRAGMA foreign_keys = OFF;");
    const temp = `${desired.name}_tmp_${Date.now()}`;
    await this.run(
      `ALTER TABLE ${quoteIdent(desired.name)} RENAME TO ${quoteIdent(temp)}`,
    );
    await this.createTable(desired);
    const transferable = current.columns
      .map((column) => column.name)
      .filter((name) => desired.columns.some((col) => col.name === name));
    if (transferable.length) {
      const projection = transferable.map(quoteIdent).join(",");
      await this.run(
        `INSERT INTO ${quoteIdent(desired.name)} (${projection}) SELECT ${projection} FROM ${quoteIdent(temp)}`,
      );
    }
    await this.run(`DROP TABLE ${quoteIdent(temp)}`);
    await this.run("PRAGMA foreign_keys = ON;");
  }

  private async syncUniqueConstraints(schema: TableSchema): Promise<void> {
    for (const constraint of schema.uniqueConstraints ?? []) {
      const indexName =
        constraint.name ??
        `${schema.name}_uniq_${constraint.columns.join("_")}`;
      await this.run(
        `CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIdent(indexName)} ON ${quoteIdent(schema.name)} (${constraint.columns
          .map(quoteIdent)
          .join(",")})`,
      );
    }
  }

  private async dropUniqueIndexes(name: string): Promise<void> {
    const indexes = await this.select(
      `PRAGMA index_list(${quoteLiteral(name)})`,
    );
    for (const index of indexes) {
      if (!index.unique) continue;
      await this.run(`DROP INDEX IF EXISTS ${quoteIdent(index.name)}`);
    }
  }

  private async select(sql: string, params: SqlValue[] = []): Promise<any[]> {
    const stmt = this.getDatabase().prepare(sql);
    try {
      stmt.bind(params);
      const rows: any[] = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  private async run(sql: string, params: SqlValue[] = []): Promise<void> {
    const stmt = this.getDatabase().prepare(sql);
    try {
      stmt.run(params);
    } finally {
      stmt.free();
    }
  }

  private async listTables(): Promise<string[]> {
    const rows = await this.select(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    );
    return rows.map((row) => row.name as string);
  }

  private async persist(): Promise<void> {
    if (!this.options.filePath) return;
    const data = this.getDatabase().export();
    await fs.writeFile(this.options.filePath, Buffer.from(data));
  }

  private canCompilePlan(plan: QueryPlan): boolean {
    const scalarFiltersValid = plan.filters.every((filter) =>
      this.canCompileFilter(filter),
    );
    const havingValid = (plan.having ?? []).every((filter) =>
      this.canCompileFilter(filter),
    );
    const selectFieldsValid = (plan.select ?? []).every(
      (selection) => selection.field && !selection.field.includes("."),
    );
    const groupFieldsValid = (plan.groupBy ?? []).every(
      (field) => !field.includes("."),
    );
    const aggregateFieldsValid = (plan.aggregates ?? []).every(
      (aggregate) => !aggregate.field || !aggregate.field.includes("."),
    );
    return (
      scalarFiltersValid &&
      havingValid &&
      selectFieldsValid &&
      groupFieldsValid &&
      aggregateFieldsValid
    );
  }

  private canCompileFilter(filter: QueryPlan["filters"][number]): boolean {
    if (filter.operator === "in" && !Array.isArray(filter.value)) {
      return false;
    }
    if (filter.operator === "like" && typeof filter.value !== "string") {
      return false;
    }
    return true;
  }

  private compilePlan(plan: QueryPlan): { sql: string; params: SqlValue[] } {
    const whereClauses: string[] = [];
    const params: SqlValue[] = [];
    for (const filter of plan.filters) {
      const clause = this.buildFilterClause(filter, params);
      if (clause) {
        whereClauses.push(clause);
      }
    }
    const where = whereClauses.length
      ? ` WHERE ${whereClauses.join(" AND ")}`
      : "";
    const selectClause = this.buildSelectClause(plan);
    const order = plan.orderBy
      ? ` ORDER BY ${quoteIdent(plan.orderBy.field)} ${
          plan.orderBy.direction?.toUpperCase() === "DESC" ? "DESC" : "ASC"
        }`
      : "";
    const group = plan.groupBy?.length
      ? ` GROUP BY ${plan.groupBy.map(quoteIdent).join(",")}`
      : "";
    const havingClauses: string[] = [];
    for (const filter of plan.having ?? []) {
      const clause = this.buildFilterClause(filter, params);
      if (clause) {
        havingClauses.push(clause);
      }
    }
    const having = havingClauses.length
      ? ` HAVING ${havingClauses.join(" AND ")}`
      : "";
    const limit =
      plan.limit !== undefined ? ` LIMIT ${Number(plan.limit)}` : "";
    const offset =
      plan.offset !== undefined ? ` OFFSET ${Number(plan.offset)}` : "";
    const sql = `SELECT ${selectClause} FROM ${quoteIdent(plan.table)}${where}${group}${having}${order}${limit}${offset}`;
    return { sql, params };
  }

  private buildSelectClause(plan: QueryPlan): string {
    const columns: string[] = [];
    if (plan.select?.length) {
      columns.push(
        ...plan.select.map((selection) => {
          const column = quoteIdent(selection.field);
          return selection.alias
            ? `${column} AS ${quoteIdent(selection.alias)}`
            : column;
        }),
      );
    } else if (plan.groupBy?.length || plan.aggregates?.length) {
      columns.push(...(plan.groupBy ?? []).map(quoteIdent));
    } else {
      columns.push("*");
    }
    if (plan.aggregates?.length) {
      columns.push(
        ...plan.aggregates.map((aggregate) => {
          const field = aggregate.field ? quoteIdent(aggregate.field) : "*";
          const distinct = aggregate.distinct ? "DISTINCT " : "";
          return `${aggregate.fn.toUpperCase()}(${distinct}${field}) AS ${quoteIdent(aggregate.alias)}`;
        }),
      );
    }
    return columns.join(", ");
  }

  private buildFilterClause(
    filter: QueryPlan["filters"][number],
    params: SqlValue[],
  ): string {
    const column = quoteIdent(filter.field);
    switch (filter.operator) {
      case "gt":
        params.push(this.toSqliteValue(filter.value));
        return `${column} > ?`;
      case "lt":
        params.push(this.toSqliteValue(filter.value));
        return `${column} < ?`;
      case "like": {
        const value = `%${String(filter.value).toLowerCase()}%`;
        params.push(value);
        return `LOWER(${column}) LIKE ?`;
      }
      case "in": {
        const values = Array.isArray(filter.value) ? filter.value : [];
        if (!values.length) {
          return "0 = 1";
        }
        const placeholders = values.map(() => "?");
        values.forEach((value) => params.push(this.toSqliteValue(value)));
        return `${column} IN (${placeholders.join(",")})`;
      }
      case "eq":
      default:
        params.push(this.toSqliteValue(filter.value));
        return `${column} = ?`;
    }
  }

  private async dumpState(): Promise<PersistedState> {
    const tables = await this.listTables();
    const snapshot: PersistedState = { tables: {}, schemas: {} };
    for (const table of tables) {
      snapshot.tables[table] = await this.readTable(table);
      const schema = await this.getSchema(table);
      if (schema) {
        snapshot.schemas[table] = schema;
      }
    }
    return snapshot;
  }

  private async applyState(state: PersistedState): Promise<void> {
    const tables = await this.listTables();
    for (const table of tables) {
      if (!state.schemas[table]) {
        await this.dropTable(table);
      }
    }
    for (const schema of Object.values(state.schemas)) {
      await this.ensureTable(schema);
      const rows = (state.tables[schema.name] as any[]) ?? [];
      await this.writeTable(schema.name, rows);
    }
  }

  private toSqliteValue(value: unknown): SqlValue {
    if (value === undefined || value === null) return null;
    if (value instanceof Uint8Array) return value;
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "boolean") return value ? 1 : 0;
    if (typeof value === "number" || typeof value === "string") return value;
    return JSON.stringify(value);
  }
}
