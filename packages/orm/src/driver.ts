import { promises as fs } from "node:fs";
import path from "node:path";
import {
  createPool as createMySqlPool,
  Pool as MySqlPool,
  PoolConnection,
} from "mysql2/promise";
import { Pool, PoolClient } from "pg";
import initSqlJs, {
  Database as SqlJsDatabase,
  SqlJsStatic,
  SqlValue,
} from "sql.js";
import { QueryPlan } from "./query/criteria";
import { executePlan } from "./query/plan-executor";
import {
  DriverResilienceOptions,
  ResolvedDriverResilienceOptions,
  executeWithResilience,
  resolveDriverResilienceOptions,
} from "./resilience";

declare const require: NodeRequire;

export interface ColumnSchema {
  name: string;
  type: string;
  nullable?: boolean;
  default?: unknown;
}

export interface UniqueConstraintSchema {
  name: string;
  columns: string[];
}

export interface ForeignKeySchema {
  name: string;
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
  onDelete?: ConstraintAction;
  onUpdate?: ConstraintAction;
}

export type ConstraintAction =
  | "cascade"
  | "restrict"
  | "set null"
  | "no action";

export interface TableSchema {
  name: string;
  columns: ColumnSchema[];
  primaryColumns?: string[];
  primaryKeyName?: string;
  uniqueConstraints?: UniqueConstraintSchema[];
  foreignKeys?: ForeignKeySchema[];
}

export interface DatabaseDriver {
  init(): Promise<void>;
  ensureTable(schema: TableSchema): Promise<void>;
  readTable<T>(name: string): Promise<T[]>;
  writeTable<T>(name: string, rows: T[]): Promise<void>;
  getSchema(name: string): Promise<TableSchema | undefined>;
  updateSchema(schema: TableSchema): Promise<void>;
  beginTransaction(): Promise<TransactionDriver>;
  dropTable(name: string): Promise<void>;
  executeQuery?<T>(plan: QueryPlan): Promise<T[]>;
  supportsQuery?(plan: QueryPlan): boolean;
}

export interface TransactionDriver extends DatabaseDriver {
  commit(): Promise<void>;
  rollback(): Promise<void>;
  createSavepoint?(name: string): Promise<void>;
  releaseSavepoint?(name: string): Promise<void>;
  rollbackToSavepoint?(name: string): Promise<void>;
}

export interface QueryCapableDriver extends DatabaseDriver {
  executeQuery<T>(plan: QueryPlan): Promise<T[]>;
  supportsQuery?(plan: QueryPlan): boolean;
}

interface PersistedState {
  tables: Record<string, unknown[]>;
  schemas: Record<string, TableSchema>;
}

const cloneState = (state: PersistedState): PersistedState => ({
  tables: JSON.parse(JSON.stringify(state.tables ?? {})),
  schemas: JSON.parse(JSON.stringify(state.schemas ?? {})),
});

const buildTransactionalInterface = (
  snapshot: PersistedState,
  commitFn: (next: PersistedState) => Promise<void>,
): TransactionDriver => {
  let active = true;
  const ensureActive = () => {
    if (!active) throw new Error("Transaction already completed");
  };
  let working = cloneState(snapshot);
  const savepoints = new Map<string, PersistedState>();
  return {
    async init() {
      ensureActive();
    },
    async ensureTable(schema) {
      ensureActive();
      if (!working.tables[schema.name]) {
        working.tables[schema.name] = [];
      }
      working.schemas[schema.name] = schema;
    },
    async readTable<T>(name: string): Promise<T[]> {
      ensureActive();
      return ((working.tables[name] as T[] | undefined) ?? []).slice();
    },
    async writeTable<T>(name: string, rows: T[]): Promise<void> {
      ensureActive();
      working.tables[name] = rows as unknown[];
    },
    async getSchema(name) {
      ensureActive();
      return working.schemas[name];
    },
    async updateSchema(schema) {
      ensureActive();
      working.schemas[schema.name] = schema;
    },
    async dropTable(name) {
      ensureActive();
      delete working.tables[name];
      delete working.schemas[name];
    },
    async beginTransaction() {
      throw new Error("Nested transactions are not supported");
    },
    async commit() {
      ensureActive();
      active = false;
      await commitFn(working);
    },
    async rollback() {
      ensureActive();
      active = false;
    },
    async createSavepoint(name: string) {
      ensureActive();
      savepoints.set(name, cloneState(working));
    },
    async releaseSavepoint(name: string) {
      ensureActive();
      savepoints.delete(name);
    },
    async rollbackToSavepoint(name: string) {
      ensureActive();
      const snapshot = savepoints.get(name);
      if (!snapshot) {
        throw new Error(`Unknown savepoint ${name}`);
      }
      working = cloneState(snapshot);
    },
  };
};

export interface JsonDriverOptions {
  filePath?: string;
}

export class JsonDatabaseDriver implements DatabaseDriver {
  private readonly filePath: string;
  protected state: PersistedState = { tables: {}, schemas: {} };
  private mutex: Promise<void> = Promise.resolve();

  constructor(options: JsonDriverOptions = {}) {
    this.filePath = options.filePath ?? `${process.cwd()}/orm-data.json`;
  }

  async init(): Promise<void> {
    try {
      const content = await fs.readFile(this.filePath, "utf8");
      this.state = JSON.parse(content) as PersistedState;
    } catch {
      this.state = { tables: {}, schemas: {} };
      await this.persist();
    }
  }

  async ensureTable(schema: TableSchema): Promise<void> {
    if (!this.state.tables[schema.name]) {
      this.state.tables[schema.name] = [];
    }
    await this.updateSchema(schema);
  }

  async readTable<T>(name: string): Promise<T[]> {
    return (this.state.tables[name] as T[] | undefined)?.slice() ?? [];
  }

  async writeTable<T>(name: string, rows: T[]): Promise<void> {
    await this.enqueue(async () => {
      this.state.tables[name] = rows;
      await this.persist();
    });
  }

  async getSchema(name: string): Promise<TableSchema | undefined> {
    return this.state.schemas[name];
  }

  async updateSchema(schema: TableSchema): Promise<void> {
    await this.enqueue(async () => {
      this.state.schemas[schema.name] = schema;
      await this.persist();
    });
  }

  async beginTransaction(): Promise<TransactionDriver> {
    const snapshot = cloneState(this.state);
    return buildTransactionalInterface(snapshot, async (next) => {
      await this.enqueue(async () => {
        this.state = next;
        await this.persist();
      });
    });
  }

  async dropTable(name: string): Promise<void> {
    await this.enqueue(async () => {
      delete this.state.tables[name];
      delete this.state.schemas[name];
      await this.persist();
    });
  }

  supportsQuery(): boolean {
    return true;
  }

  async executeQuery<T>(plan: QueryPlan): Promise<T[]> {
    const rows =
      (this.state.tables[plan.table] as
        | Record<string, unknown>[]
        | undefined) ?? [];
    return executePlan(rows, plan) as T[];
  }

  private async persist(): Promise<void> {
    await fs.writeFile(
      this.filePath,
      JSON.stringify(this.state, null, 2),
      "utf8",
    );
  }

  private async enqueue(task: () => Promise<void>): Promise<void> {
    this.mutex = this.mutex.then(task, task);
    await this.mutex;
  }
}

export class MemoryDatabaseDriver implements DatabaseDriver {
  protected state: PersistedState = { tables: {}, schemas: {} };

  async init(): Promise<void> {
    // noop
  }

  async ensureTable(schema: TableSchema): Promise<void> {
    if (!this.state.tables[schema.name]) {
      this.state.tables[schema.name] = [];
    }
    this.state.schemas[schema.name] = schema;
  }

  async readTable<T>(name: string): Promise<T[]> {
    return (this.state.tables[name] as T[] | undefined)?.slice() ?? [];
  }

  async writeTable<T>(name: string, rows: T[]): Promise<void> {
    this.state.tables[name] = rows;
  }

  async getSchema(name: string): Promise<TableSchema | undefined> {
    return this.state.schemas[name];
  }

  async updateSchema(schema: TableSchema): Promise<void> {
    this.state.schemas[schema.name] = schema;
  }

  async beginTransaction(): Promise<TransactionDriver> {
    const snapshot = cloneState(this.state);
    return buildTransactionalInterface(snapshot, async (next) => {
      this.state = next;
    });
  }

  async dropTable(name: string): Promise<void> {
    delete this.state.tables[name];
    delete this.state.schemas[name];
  }

  supportsQuery(): boolean {
    return true;
  }

  async executeQuery<T>(plan: QueryPlan): Promise<T[]> {
    const rows =
      (this.state.tables[plan.table] as
        | Record<string, unknown>[]
        | undefined) ?? [];
    return executePlan(rows, plan) as T[];
  }
}

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
    return plan.filters.every((filter) => this.canCompileFilter(filter));
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
    const order = plan.orderBy
      ? ` ORDER BY ${quoteIdent(plan.orderBy.field)} ${
          plan.orderBy.direction?.toUpperCase() === "DESC" ? "DESC" : "ASC"
        }`
      : "";
    const limit =
      plan.limit !== undefined ? ` LIMIT ${Number(plan.limit)}` : "";
    const offset =
      plan.offset !== undefined ? ` OFFSET ${Number(plan.offset)}` : "";
    const sql = `SELECT * FROM ${quoteIdent(plan.table)}${where}${order}${limit}${offset}`;
    return { sql, params };
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

export interface PostgresDriverOptions {
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  schema?: string;
  ssl?: boolean | Record<string, unknown>;
  resilience?: DriverResilienceOptions;
}

export class PostgresDatabaseDriver implements DatabaseDriver {
  private readonly pool: Pool;
  private readonly schemaName: string;
  private schemaCache = new Map<string, TableSchema>();
  private readonly resilience: ResolvedDriverResilienceOptions;

  constructor(private readonly options: PostgresDriverOptions = {}) {
    this.schemaName = options.schema ?? "public";
    this.pool = new Pool({
      connectionString: options.connectionString,
      host: options.host ?? "localhost",
      port: options.port ?? 5432,
      user: options.user ?? "postgres",
      password: options.password ?? "postgres",
      database: options.database ?? "postgres",
      ssl: options.ssl,
    });
    this.resilience = resolveDriverResilienceOptions(options.resilience);
  }

  async init(): Promise<void> {
    await this.runWithResilience(() => this.pool.query("SELECT 1"));
  }

  async ensureTable(schema: TableSchema): Promise<void> {
    this.schemaCache.set(schema.name, schema);
    await this.withClient((client) =>
      this.ensureTableWithClient(client, schema),
    );
  }

  async readTable<T>(name: string): Promise<T[]> {
    return this.withClient((client) =>
      this.readTableWithClient<T>(client, name),
    );
  }

  async writeTable<T>(name: string, rows: T[]): Promise<void> {
    await this.withClient(async (client) => {
      await client.query("BEGIN");
      try {
        await this.writeTableWithClient<T>(client, name, rows);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });
  }

  async getSchema(name: string): Promise<TableSchema | undefined> {
    if (this.schemaCache.has(name)) {
      return this.schemaCache.get(name);
    }
    await this.withClient(async (client) => {
      const columns = await this.listColumns(client, name);
      if (!columns.length) return;
      this.schemaCache.set(name, {
        name,
        columns: columns.map((column) => ({
          name: column.column_name,
          type: this.typeFromSql(column.data_type),
          nullable: column.is_nullable === "YES",
          primary: column.constraint_type === "PRIMARY KEY",
        })),
      });
    });
    return this.schemaCache.get(name);
  }

  async updateSchema(schema: TableSchema): Promise<void> {
    await this.ensureTable(schema);
  }

  async beginTransaction(): Promise<TransactionDriver> {
    return this.runWithResilience(async () => {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        return new PostgresTransactionDriver(this, client);
      } catch (error) {
        client.release();
        throw error;
      }
    });
  }

  async dropTable(name: string): Promise<void> {
    await this.withClient((client) => this.dropTableWithClient(client, name));
  }

  async dropTableWithClient(client: PoolClient, name: string): Promise<void> {
    await client.query(
      `DROP TABLE IF EXISTS ${this.fullTableName(name)} CASCADE`,
    );
    this.schemaCache.delete(name);
  }

  async ensureTableWithClient(
    client: PoolClient,
    schema: TableSchema,
  ): Promise<void> {
    await this.createSchemaIfNeeded(client);
    const existing = await this.listColumns(client, schema.name);
    if (!existing.length) {
      const columns = schema.columns.map((column) =>
        this.columnDefinition(column),
      );
      const constraints = this.buildConstraintDefinitions(schema);
      const sql = `CREATE TABLE IF NOT EXISTS ${this.fullTableName(schema.name)} (${[...columns, ...constraints].join(",")})`;
      await client.query(sql);
      return;
    }
    const existingNames = new Set(existing.map((column) => column.column_name));
    for (const column of schema.columns) {
      if (!existingNames.has(column.name)) {
        await client.query(
          `ALTER TABLE ${this.fullTableName(schema.name)} ADD COLUMN ${this.columnDefinition(column)}`,
        );
      }
    }
    await this.dropObsoleteColumns(client, schema, existing);
    await this.alterColumns(client, schema, existing);
    await this.syncConstraints(client, schema);
  }

  private async dropObsoleteColumns(
    client: PoolClient,
    schema: TableSchema,
    existing: Array<{
      column_name: string;
    }>,
  ): Promise<void> {
    const desired = new Set(schema.columns.map((column) => column.name));
    for (const column of existing) {
      if (!desired.has(column.column_name)) {
        await client.query(
          `ALTER TABLE ${this.fullTableName(schema.name)} DROP COLUMN ${quoteIdent(column.column_name)} CASCADE`,
        );
      }
    }
  }

  private async alterColumns(
    client: PoolClient,
    schema: TableSchema,
    existing: Array<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>,
  ): Promise<void> {
    const current = new Map(
      existing.map((column) => [column.column_name, column]),
    );
    for (const desired of schema.columns) {
      const active = current.get(desired.name);
      if (!active) continue;
      await this.alterColumnIfNeeded(client, schema.name, active, desired);
    }
  }

  private async alterColumnIfNeeded(
    client: PoolClient,
    table: string,
    current: {
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    },
    desired: ColumnSchema,
  ) {
    const desiredType = desired.type ?? "string";
    if (this.typeFromSql(current.data_type) !== desiredType) {
      const sqlType = this.toSqlType(desired.type);
      await client.query(
        `ALTER TABLE ${this.fullTableName(table)} ALTER COLUMN ${quoteIdent(desired.name)} TYPE ${sqlType} USING ${quoteIdent(desired.name)}::${this.pgCast(desired.type)}`,
      );
    }
    const shouldBeNullable = desired.nullable !== false;
    const isNullable = current.is_nullable === "YES";
    if (shouldBeNullable !== isNullable) {
      await client.query(
        `ALTER TABLE ${this.fullTableName(table)} ALTER COLUMN ${quoteIdent(desired.name)} ${shouldBeNullable ? "DROP" : "SET"} NOT NULL`,
      );
    }
    if (this.defaultsDiffer(current.column_default, desired.default)) {
      if (desired.default === undefined) {
        await client.query(
          `ALTER TABLE ${this.fullTableName(table)} ALTER COLUMN ${quoteIdent(desired.name)} DROP DEFAULT`,
        );
      } else {
        await client.query(
          `ALTER TABLE ${this.fullTableName(table)} ALTER COLUMN ${quoteIdent(desired.name)} SET DEFAULT ${this.formatDefault(desired.default)}`,
        );
      }
    }
  }

  async readTableWithClient<T>(client: PoolClient, name: string): Promise<T[]> {
    const result = await client.query(
      `SELECT * FROM ${this.fullTableName(name)}`,
    );
    return result.rows as T[];
  }

  async writeTableWithClient<T>(
    client: PoolClient,
    name: string,
    rows: T[],
  ): Promise<void> {
    const schema = await this.resolveSchema(name, client);
    await client.query(`TRUNCATE ${this.fullTableName(name)} CASCADE`);
    if (!rows.length) {
      return;
    }
    const columns = schema.columns.map((column) => column.name);
    const columnList = columns.map((column) => quoteIdent(column)).join(",");
    for (const row of rows) {
      const values = columns.map((column) =>
        normalizeValue((row as Record<string, unknown>)[column]),
      );
      const placeholders = values.map((_, index) => `$${index + 1}`).join(",");
      await client.query(
        `INSERT INTO ${this.fullTableName(name)} (${columnList}) VALUES (${placeholders})`,
        values,
      );
    }
  }

  private async resolveSchema(
    name: string,
    client: PoolClient,
  ): Promise<TableSchema> {
    const cached = this.schemaCache.get(name);
    if (cached) return cached;
    const columns = await this.listColumns(client, name);
    if (!columns.length) {
      throw new Error(`Table ${name} not found in schema ${this.schemaName}`);
    }
    const schema = {
      name,
      columns: columns.map((column) => ({
        name: column.column_name,
        type: this.typeFromSql(column.data_type),
        nullable: column.is_nullable === "YES",
      })),
    } satisfies TableSchema;
    this.schemaCache.set(name, schema);
    return schema;
  }

  private buildConstraintDefinitions(schema: TableSchema): string[] {
    const definitions: string[] = [];
    if (schema.primaryColumns?.length) {
      const name = schema.primaryKeyName ?? `${schema.name}_pk`;
      definitions.push(
        `CONSTRAINT ${quoteIdent(name)} PRIMARY KEY (${this.formatColumns(schema.primaryColumns)})`,
      );
    }
    for (const unique of schema.uniqueConstraints ?? []) {
      definitions.push(
        `CONSTRAINT ${quoteIdent(unique.name)} UNIQUE (${this.formatColumns(unique.columns)})`,
      );
    }
    for (const fk of schema.foreignKeys ?? []) {
      definitions.push(
        `CONSTRAINT ${quoteIdent(fk.name)} ${this.foreignKeyClause(fk)}`,
      );
    }
    return definitions;
  }

  private async syncConstraints(
    client: PoolClient,
    schema: TableSchema,
  ): Promise<void> {
    if (schema.primaryColumns?.length) {
      await this.ensurePrimaryKey(client, schema);
    }
    await this.dropStaleConstraints(client, schema, "u");
    await this.dropStaleConstraints(client, schema, "f");
    for (const unique of schema.uniqueConstraints ?? []) {
      await this.addConstraint(
        client,
        schema.name,
        unique.name,
        `UNIQUE (${this.formatColumns(unique.columns)})`,
      );
    }
    for (const fk of schema.foreignKeys ?? []) {
      await this.addConstraint(
        client,
        schema.name,
        fk.name,
        this.foreignKeyClause(fk),
      );
    }
  }

  private async dropStaleConstraints(
    client: PoolClient,
    schema: TableSchema,
    type: "u" | "f",
  ) {
    const source =
      type === "u"
        ? (schema.uniqueConstraints ?? [])
        : (schema.foreignKeys ?? []);
    const desired = new Set(
      source
        .map((constraint) => constraint.name)
        .filter((name): name is string => Boolean(name)),
    );
    const existing = await this.listConstraintNames(client, schema.name, type);
    for (const name of existing) {
      if (!desired.has(name)) {
        await this.dropConstraint(client, schema.name, name);
      }
    }
  }

  private async ensurePrimaryKey(
    client: PoolClient,
    schema: TableSchema,
  ): Promise<void> {
    if (await this.hasPrimaryKey(client, schema.name)) {
      return;
    }
    const name = schema.primaryKeyName ?? `${schema.name}_pk`;
    await this.addConstraint(
      client,
      schema.name,
      name,
      `PRIMARY KEY (${this.formatColumns(schema.primaryColumns!)})`,
    );
  }

  private async addConstraint(
    client: PoolClient,
    table: string,
    name: string,
    definition: string,
  ) {
    if (await this.constraintExists(client, name)) {
      return;
    }
    await client.query(
      `ALTER TABLE ${this.fullTableName(table)} ADD CONSTRAINT ${quoteIdent(name)} ${definition}`,
    );
  }

  private async constraintExists(client: PoolClient, name: string) {
    const result = await client.query(
      `SELECT 1 FROM pg_constraint WHERE conname = $1 AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = $2)`,
      [name, this.schemaName],
    );
    return (result.rowCount ?? 0) > 0;
  }

  private async listConstraintNames(
    client: PoolClient,
    table: string,
    type: "u" | "f",
  ): Promise<string[]> {
    const result = await client.query(
      `SELECT con.conname
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace nsp ON nsp.oid = con.connamespace
       WHERE nsp.nspname = $1 AND rel.relname = $2 AND con.contype = $3`,
      [this.schemaName, table, type],
    );
    return result.rows.map((row: { conname: string }) => row.conname);
  }

  private async dropConstraint(
    client: PoolClient,
    table: string,
    name: string,
  ): Promise<void> {
    await client.query(
      `ALTER TABLE ${this.fullTableName(table)} DROP CONSTRAINT IF EXISTS ${quoteIdent(name)} CASCADE`,
    );
  }

  private async hasPrimaryKey(client: PoolClient, table: string) {
    const result = await client.query(
      `SELECT 1 FROM pg_constraint
       WHERE contype = 'p'
         AND conrelid = $1::regclass`,
      [`${this.schemaName}.${table}`],
    );
    return (result.rowCount ?? 0) > 0;
  }

  private foreignKeyClause(fk: ForeignKeySchema): string {
    const target = `${this.fullTableName(fk.referencedTable)}`;
    let clause = `FOREIGN KEY (${this.formatColumns(fk.columns)}) REFERENCES ${target} (${this.formatColumns(fk.referencedColumns)})`;
    if (fk.onDelete) {
      clause += ` ON DELETE ${this.formatAction(fk.onDelete)}`;
    }
    if (fk.onUpdate) {
      clause += ` ON UPDATE ${this.formatAction(fk.onUpdate)}`;
    }
    return clause;
  }

  private async withClient<T>(
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.runWithResilience(async () => {
      const client = await this.pool.connect();
      try {
        return await fn(client);
      } finally {
        client.release();
      }
    });
  }

  private async createSchemaIfNeeded(client: PoolClient) {
    await client.query(
      `CREATE SCHEMA IF NOT EXISTS ${quoteIdent(this.schemaName)}`,
    );
  }

  private async listColumns(client: PoolClient, table: string) {
    const result = await client.query(
      `SELECT c.column_name, c.data_type, c.is_nullable, c.column_default, tc.constraint_type
       FROM information_schema.columns c
       LEFT JOIN information_schema.key_column_usage k
         ON k.table_name = c.table_name AND k.column_name = c.column_name AND k.table_schema = c.table_schema
       LEFT JOIN information_schema.table_constraints tc
         ON tc.constraint_name = k.constraint_name AND tc.table_schema = c.table_schema
       WHERE c.table_schema = $1 AND c.table_name = $2
       ORDER BY c.ordinal_position`,
      [this.schemaName, table],
    );
    return result.rows as Array<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
      constraint_type: string | null;
    }>;
  }

  private runWithResilience<T>(task: () => Promise<T>): Promise<T> {
    return executeWithResilience(task, this.resilience);
  }

  private formatColumns(columns: string[]): string {
    return columns.map((column) => quoteIdent(column)).join(", ");
  }

  private formatAction(action: ConstraintAction): string {
    switch (action) {
      case "set null":
        return "SET NULL";
      case "no action":
        return "NO ACTION";
      case "restrict":
        return "RESTRICT";
      case "cascade":
      default:
        return "CASCADE";
    }
  }

  private columnDefinition(column: TableSchema["columns"][number]) {
    const isNullable = column.nullable !== false;
    const parts = [
      `${quoteIdent(column.name)} ${this.toSqlType(column.type)}`,
      isNullable ? "" : "NOT NULL",
      column.default === undefined
        ? ""
        : `DEFAULT ${this.formatDefault(column.default)}`,
    ].filter(Boolean);
    return parts.join(" ");
  }

  private formatDefault(value: unknown): string {
    if (value === null) return "NULL";
    if (typeof value === "number") return value.toString();
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value instanceof Date) return `'${value.toISOString()}'`;
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  private toSqlType(type?: string) {
    switch (type) {
      case "number":
        return "DOUBLE PRECISION";
      case "boolean":
        return "BOOLEAN";
      case "date":
        return "TIMESTAMPTZ";
      case "json":
        return "JSONB";
      default:
        return "TEXT";
    }
  }

  private typeFromSql(type: string) {
    if (type.includes("double")) return "number";
    if (type.includes("bool")) return "boolean";
    if (type.includes("timestamp")) return "date";
    if (type.includes("json")) return "json";
    return "string";
  }

  private fullTableName(table: string) {
    return `${quoteIdent(this.schemaName)}.${quoteIdent(table)}`;
  }

  private pgCast(type?: string): string {
    switch (type) {
      case "number":
        return "double precision";
      case "boolean":
        return "boolean";
      case "date":
        return "timestamptz";
      case "json":
        return "jsonb";
      default:
        return "text";
    }
  }

  private defaultsDiffer(current: string | null, desired: unknown): boolean {
    const normalizedCurrent = this.normalizePgDefault(current);
    if (desired === undefined) {
      return normalizedCurrent !== "";
    }
    if (desired === null && normalizedCurrent === "NULL") {
      return false;
    }
    const desiredValue = this.formatDefault(desired);
    return normalizedCurrent !== desiredValue;
  }

  private normalizePgDefault(value: string | null): string {
    if (!value) return "";
    const trimmed = value.trim();
    const castIndex = trimmed.indexOf("::");
    if (castIndex >= 0) {
      return trimmed.slice(0, castIndex);
    }
    return trimmed;
  }
}

class PostgresTransactionDriver implements TransactionDriver {
  constructor(
    private readonly base: PostgresDatabaseDriver,
    private readonly client: PoolClient,
  ) {}

  async init(): Promise<void> {
    // already initialized via BEGIN
  }

  async ensureTable(schema: TableSchema): Promise<void> {
    await this.base.ensureTableWithClient(this.client, schema);
  }

  async readTable<T>(name: string): Promise<T[]> {
    return this.base.readTableWithClient<T>(this.client, name);
  }

  async writeTable<T>(name: string, rows: T[]): Promise<void> {
    await this.base.writeTableWithClient(this.client, name, rows);
  }

  async getSchema(name: string): Promise<TableSchema | undefined> {
    return this.base.getSchema(name);
  }

  async updateSchema(schema: TableSchema): Promise<void> {
    await this.base.ensureTableWithClient(this.client, schema);
  }

  async dropTable(name: string): Promise<void> {
    await this.base.dropTableWithClient(this.client, name);
  }

  async beginTransaction(): Promise<TransactionDriver> {
    throw new Error("Nested transactions are not supported");
  }

  async commit(): Promise<void> {
    await this.client.query("COMMIT");
    this.client.release();
  }

  async rollback(): Promise<void> {
    await this.client.query("ROLLBACK");
    this.client.release();
  }

  async createSavepoint(name: string): Promise<void> {
    await this.client.query(
      `SAVEPOINT ${quoteIdent(sanitizeSavepointName(name))}`,
    );
  }

  async releaseSavepoint(name: string): Promise<void> {
    await this.client.query(
      `RELEASE SAVEPOINT ${quoteIdent(sanitizeSavepointName(name))}`,
    );
  }

  async rollbackToSavepoint(name: string): Promise<void> {
    await this.client.query(
      `ROLLBACK TO SAVEPOINT ${quoteIdent(sanitizeSavepointName(name))}`,
    );
  }
}

export interface MySqlDriverOptions {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean | string;
  resilience?: DriverResilienceOptions;
}

export class MySqlDatabaseDriver implements DatabaseDriver {
  private readonly pool: MySqlPool;
  private readonly database: string;
  private schemaCache = new Map<string, TableSchema>();
  private readonly resilience: ResolvedDriverResilienceOptions;

  constructor(private readonly options: MySqlDriverOptions = {}) {
    this.database = options.database ?? "ocd_js";
    const sslOption =
      options.ssl === undefined
        ? undefined
        : typeof options.ssl === "string"
          ? options.ssl
          : options.ssl
            ? {}
            : undefined;
    this.pool = createMySqlPool({
      host: options.host ?? "localhost",
      port: options.port ?? 3306,
      user: options.user ?? "root",
      password: options.password ?? "root",
      database: this.database,
      waitForConnections: true,
      ssl: sslOption,
    });
    this.resilience = resolveDriverResilienceOptions(options.resilience);
  }

  async init(): Promise<void> {
    await this.runWithResilience(async () => {
      const connection = await this.pool.getConnection();
      try {
        await connection.query("SELECT 1");
      } finally {
        connection.release();
      }
    });
  }

  async ensureTable(schema: TableSchema): Promise<void> {
    await this.withConnection(async (connection) => {
      const exists = await this.tableExists(connection, schema.name);
      if (!exists) {
        const columns = schema.columns.map((column) =>
          this.mysqlColumnDefinition(column),
        );
        const constraints = this.buildMySqlConstraintDefinitions(schema);
        const sql = `CREATE TABLE IF NOT EXISTS ${this.mysqlTable(schema.name)} (${[...columns, ...constraints].join(",")}) ENGINE=InnoDB`;
        await connection.query(sql);
      } else {
        await this.addMissingColumns(connection, schema);
      }
    });
    this.schemaCache.set(schema.name, schema);
  }

  async readTable<T>(name: string): Promise<T[]> {
    const [rows] = await this.pool.query(
      `SELECT * FROM ${this.mysqlTable(name)}`,
    );
    return rows as T[];
  }

  async writeTable<T>(name: string, rows: T[]): Promise<void> {
    await this.withConnection(async (connection) => {
      await connection.beginTransaction();
      try {
        await connection.query(`DELETE FROM ${this.mysqlTable(name)}`);
        if (rows.length) {
          const columns = Object.keys(rows[0] as Record<string, unknown>);
          const placeholders = `(${columns.map(() => "?").join(",")})`;
          const sql = `INSERT INTO ${this.mysqlTable(name)} (${columns
            .map((column) => this.mysqlIdent(column))
            .join(",")}) VALUES ${rows.map(() => placeholders).join(",")}`;
          const values = rows.flatMap((row) =>
            columns.map((column) => normalizeValue((row as any)[column])),
          );
          await connection.query(sql, values);
        }
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    });
  }

  async getSchema(name: string): Promise<TableSchema | undefined> {
    if (this.schemaCache.has(name)) {
      return this.schemaCache.get(name);
    }
    return this.withConnection(async (connection) => {
      const [columns] = await connection.query(
        `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION`,
        [this.database, name],
      );
      const rows = columns as Array<{
        COLUMN_NAME: string;
        DATA_TYPE: string;
        IS_NULLABLE: string;
        COLUMN_DEFAULT: string | null;
      }>;
      if (!rows.length) {
        return undefined;
      }
      const schema: TableSchema = {
        name,
        columns: rows.map((column) => ({
          name: column.COLUMN_NAME,
          type: this.fromMySqlType(column.DATA_TYPE),
          nullable: column.IS_NULLABLE === "YES",
          default: column.COLUMN_DEFAULT ?? undefined,
        })),
      };
      this.schemaCache.set(name, schema);
      return schema;
    });
  }

  async updateSchema(schema: TableSchema): Promise<void> {
    await this.ensureTable(schema);
  }

  async beginTransaction(): Promise<TransactionDriver> {
    return this.runWithResilience(async () => {
      const connection = await this.pool.getConnection();
      try {
        await connection.beginTransaction();
        return new MySqlTransactionDriver(this, connection);
      } catch (error) {
        connection.release();
        throw error;
      }
    });
  }

  async dropTable(name: string): Promise<void> {
    await this.withConnection((connection) =>
      connection.query(`DROP TABLE IF EXISTS ${this.mysqlTable(name)}`),
    );
    this.schemaCache.delete(name);
  }

  private async tableExists(connection: PoolConnection, name: string) {
    const [rows] = await connection.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = ?`,
      [this.database, name],
    );
    return Array.isArray(rows) && rows.length > 0;
  }

  private async addMissingColumns(
    connection: PoolConnection,
    schema: TableSchema,
  ) {
    const [rows] = await connection.query(
      `SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = ? AND table_name = ?`,
      [this.database, schema.name],
    );
    const existing = new Set(
      (rows as Array<{ COLUMN_NAME: string }>).map((row) => row.COLUMN_NAME),
    );
    for (const column of schema.columns) {
      if (existing.has(column.name)) continue;
      await connection.query(
        `ALTER TABLE ${this.mysqlTable(schema.name)} ADD COLUMN ${this.mysqlColumnDefinition(column)}`,
      );
    }
  }

  private mysqlColumnDefinition(column: ColumnSchema): string {
    const parts = [this.mysqlIdent(column.name), this.mysqlType(column.type)];
    if (column.nullable === false) {
      parts.push("NOT NULL");
    }
    if (column.default !== undefined) {
      parts.push(`DEFAULT ${this.formatMySqlDefault(column.default)}`);
    }
    return parts.join(" ");
  }

  private mysqlType(type?: string): string {
    switch (type) {
      case "number":
        return "DOUBLE";
      case "boolean":
        return "TINYINT(1)";
      case "date":
        return "DATETIME(6)";
      case "json":
        return "JSON";
      default:
        return "TEXT";
    }
  }

  private formatMySqlDefault(value: unknown): string {
    if (value === null) return "NULL";
    if (typeof value === "number") return value.toString();
    if (typeof value === "boolean") return value ? "1" : "0";
    if (value instanceof Date)
      return `'${value.toISOString().slice(0, 19).replace("T", " ")}'`;
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  private buildMySqlConstraintDefinitions(schema: TableSchema): string[] {
    const definitions: string[] = [];
    if (schema.primaryColumns?.length) {
      definitions.push(
        `PRIMARY KEY (${schema.primaryColumns
          .map((column) => this.mysqlIdent(column))
          .join(",")})`,
      );
    }
    for (const unique of schema.uniqueConstraints ?? []) {
      const name =
        unique.name ?? `${schema.name}_${unique.columns.join("_")}_uniq`;
      definitions.push(
        `CONSTRAINT ${this.mysqlIdent(name)} UNIQUE (${unique.columns
          .map((column) => this.mysqlIdent(column))
          .join(",")})`,
      );
    }
    for (const fk of schema.foreignKeys ?? []) {
      const clauses: string[] = [];
      if (fk.onDelete) clauses.push(`ON DELETE ${fk.onDelete.toUpperCase()}`);
      if (fk.onUpdate) clauses.push(`ON UPDATE ${fk.onUpdate.toUpperCase()}`);
      const name = fk.name ?? `${schema.name}_${fk.columns.join("_")}_fk`;
      definitions.push(
        `CONSTRAINT ${this.mysqlIdent(name)} FOREIGN KEY (${fk.columns
          .map((column) => this.mysqlIdent(column))
          .join(
            ",",
          )}) REFERENCES ${this.mysqlTable(fk.referencedTable)} (${fk.referencedColumns
          .map((column) => this.mysqlIdent(column))
          .join(",")}) ${clauses.join(" ")}`.trim(),
      );
    }
    return definitions;
  }

  private mysqlTable(name: string): string {
    return this.mysqlIdent(name);
  }

  private mysqlIdent(identifier: string): string {
    return `\`${identifier.replace(/`/g, "``")}\``;
  }

  private fromMySqlType(type: string): string {
    const normalized = type.toLowerCase();
    if (normalized.includes("double") || normalized.includes("decimal")) {
      return "number";
    }
    if (normalized.includes("tinyint")) {
      return "boolean";
    }
    if (normalized.includes("datetime") || normalized.includes("timestamp")) {
      return "date";
    }
    if (normalized.includes("json")) {
      return "json";
    }
    return "string";
  }

  private async withConnection<T>(
    handler: (connection: PoolConnection) => Promise<T>,
  ): Promise<T> {
    return this.runWithResilience(async () => {
      const connection = await this.pool.getConnection();
      try {
        return await handler(connection);
      } finally {
        connection.release();
      }
    });
  }

  private runWithResilience<T>(task: () => Promise<T>): Promise<T> {
    return executeWithResilience(task, this.resilience);
  }
}

class MySqlTransactionDriver implements TransactionDriver {
  constructor(
    private readonly base: MySqlDatabaseDriver,
    private readonly connection: PoolConnection,
  ) {}

  async init(): Promise<void> {
    // already initialized
  }

  async ensureTable(schema: TableSchema): Promise<void> {
    await this.base.ensureTable(schema);
  }

  async readTable<T>(name: string): Promise<T[]> {
    const [rows] = await this.connection.query(
      `SELECT * FROM ${this.escapeTable(name)}`,
    );
    return rows as T[];
  }

  async writeTable<T>(name: string, rows: T[]): Promise<void> {
    await this.base.writeTable(name, rows);
  }

  async getSchema(name: string): Promise<TableSchema | undefined> {
    return this.base.getSchema(name);
  }

  async updateSchema(schema: TableSchema): Promise<void> {
    await this.base.ensureTable(schema);
  }

  async dropTable(name: string): Promise<void> {
    await this.base.dropTable(name);
  }

  async beginTransaction(): Promise<TransactionDriver> {
    throw new Error("Nested transactions are not supported");
  }

  async commit(): Promise<void> {
    await this.connection.commit();
    this.connection.release();
  }

  async rollback(): Promise<void> {
    await this.connection.rollback();
    this.connection.release();
  }

  async createSavepoint(name: string): Promise<void> {
    await this.connection.query(`SAVEPOINT ${sanitizeSavepointName(name)}`);
  }

  async releaseSavepoint(name: string): Promise<void> {
    await this.connection.query(
      `RELEASE SAVEPOINT ${sanitizeSavepointName(name)}`,
    );
  }

  async rollbackToSavepoint(name: string): Promise<void> {
    await this.connection.query(
      `ROLLBACK TO SAVEPOINT ${sanitizeSavepointName(name)}`,
    );
  }

  private escapeTable(name: string): string {
    return `\`${name.replace(/`/g, "``")}\``;
  }
}

const sanitizeSavepointName = (name: string) =>
  name.replace(/[^a-zA-Z0-9_]/g, "_") || "sp";

const quoteLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`;

const quoteValue = (value: unknown): string => {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return value.toString();
  if (typeof value === "boolean") return value ? "1" : "0";
  return quoteLiteral(String(value));
};

const normalizeAction = (action: unknown): ConstraintAction | undefined => {
  if (!action) return undefined;
  const normalized = String(action).toLowerCase();
  if (normalized === "cascade") return "cascade";
  if (normalized === "restrict") return "restrict";
  if (normalized === "set null") return "set null";
  if (normalized === "no action") return "no action";
  return undefined;
};

const normalizeColumnType = (type?: string) => (type ?? "text").toLowerCase();

const foreignSignature = (fk: ForeignKeySchema): string =>
  `${fk.columns.sort().join("|")}:${fk.referencedTable}:${fk.referencedColumns
    .sort()
    .join("|")}`;

const uniqueSignature = (constraint: UniqueConstraintSchema): string =>
  constraint.columns
    .map((column) => column.toLowerCase())
    .sort()
    .join("|");

const requiresRebuild = (
  current: TableSchema,
  desired: TableSchema,
): boolean => {
  const currentColumns = new Map(
    (current.columns ?? []).map((column) => [column.name, column]),
  );
  if (currentColumns.size !== (desired.columns ?? []).length) {
    return true;
  }
  for (const column of desired.columns ?? []) {
    const existing = currentColumns.get(column.name);
    if (!existing) return true;
    if (
      normalizeColumnType(existing.type) !== normalizeColumnType(column.type)
    ) {
      return true;
    }
    if (!!existing.nullable !== !!column.nullable) {
      return true;
    }
    if (
      normalizeValue(existing.default) !==
      normalizeValue(column.default ?? undefined)
    ) {
      return true;
    }
  }
  const currentPrimary = (current.primaryColumns ?? []).join("|");
  const desiredPrimary = (desired.primaryColumns ?? []).join("|");
  if (currentPrimary !== desiredPrimary) {
    return true;
  }
  const currentForeign = new Set(
    (current.foreignKeys ?? []).map((fk) => foreignSignature(fk)),
  );
  for (const fk of desired.foreignKeys ?? []) {
    if (!currentForeign.has(foreignSignature(fk))) {
      return true;
    }
  }
  const currentUnique = new Set(
    (current.uniqueConstraints ?? []).map((constraint) =>
      uniqueSignature(constraint),
    ),
  );
  const desiredUnique = new Set(
    (desired.uniqueConstraints ?? []).map((constraint) =>
      uniqueSignature(constraint),
    ),
  );
  if (currentUnique.size !== desiredUnique.size) {
    return true;
  }
  for (const signature of desiredUnique) {
    if (!currentUnique.has(signature)) {
      return true;
    }
  }
  return false;
};

const quoteIdent = (identifier: string) =>
  `"${identifier.replace(/"/g, '""')}"`;

const normalizeValue = (value: unknown) => {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
};
