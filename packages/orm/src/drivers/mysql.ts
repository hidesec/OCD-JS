import {
  createPool as createMySqlPool,
  Pool as MySqlPool,
  PoolConnection,
} from "mysql2/promise";
import {
  ColumnSchema,
  DatabaseDriver,
  TableSchema,
  TransactionDriver,
} from "./interfaces";
import { normalizeValue, sanitizeSavepointName } from "./base";
import {
  DriverResilienceOptions,
  ResolvedDriverResilienceOptions,
  executeWithResilience,
  resolveDriverResilienceOptions,
} from "../resilience";

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
