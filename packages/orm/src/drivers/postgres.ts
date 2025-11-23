import { Pool, PoolClient } from "pg";
import {
  ColumnSchema,
  ConstraintAction,
  DatabaseDriver,
  ForeignKeySchema,
  TableSchema,
  TransactionDriver,
} from "./interfaces";
import { normalizeValue, quoteIdent, sanitizeSavepointName } from "./base";
import {
  DriverResilienceOptions,
  ResolvedDriverResilienceOptions,
  executeWithResilience,
  resolveDriverResilienceOptions,
} from "../resilience";

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
