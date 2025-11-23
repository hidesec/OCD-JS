import * as mssql from "mssql";
import {
  DriverResilienceOptions,
  ResolvedDriverResilienceOptions,
  executeWithResilience,
  resolveDriverResilienceOptions,
} from "../resilience";
import { normalizeValue, quoteIdent, sanitizeSavepointName } from "./base";
import {
  ColumnSchema,
  ConstraintAction,
  DatabaseDriver,
  ForeignKeySchema,
  TableSchema,
  TransactionDriver,
} from "./interfaces";

export interface MssqlDriverOptions {
  server?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  schema?: string;
  encrypt?: boolean;
  trustServerCertificate?: boolean;
  connectionTimeout?: number;
  requestTimeout?: number;
  resilience?: DriverResilienceOptions;
}

export class MssqlDatabaseDriver implements DatabaseDriver {
  private readonly pool: mssql.ConnectionPool;
  private readonly schemaName: string;
  private schemaCache = new Map<string, TableSchema>();
  private readonly resilience: ResolvedDriverResilienceOptions;

  constructor(private readonly options: MssqlDriverOptions = {}) {
    this.schemaName = options.schema ?? "dbo";
    const config: mssql.config = {
      server: options.server ?? "localhost",
      port: options.port ?? 1433,
      user: options.user ?? "sa",
      password: options.password ?? "",
      database: options.database ?? "master",
      options: {
        encrypt: options.encrypt ?? true,
        trustServerCertificate: options.trustServerCertificate ?? false,
      },
      connectionTimeout: options.connectionTimeout ?? 30000,
      requestTimeout: options.requestTimeout ?? 30000,
    };
    this.pool = new mssql.ConnectionPool(config);
    this.resilience = resolveDriverResilienceOptions(options.resilience);
  }

  async init(): Promise<void> {
    await this.runWithResilience(async () => {
      await this.pool.connect();
      const request = this.pool.request();
      await request.query("SELECT 1");
    });
  }

  async ensureTable(schema: TableSchema): Promise<void> {
    await this.withRequest(async (request) => {
      const exists = await this.tableExists(request, schema.name);
      if (!exists) {
        const columns = schema.columns.map((column) =>
          this.mssqlColumnDefinition(column),
        );
        const constraints = this.buildMssqlConstraintDefinitions(schema);
        const sql = `CREATE TABLE ${this.mssqlTable(schema.name)} (${[...columns, ...constraints].join(",")})`;
        await request.query(sql);
      } else {
        await this.addMissingColumns(request, schema);
      }
    });
    this.schemaCache.set(schema.name, schema);
  }

  async readTable<T>(name: string): Promise<T[]> {
    const request = this.pool.request();
    const result = await request.query(
      `SELECT * FROM ${this.mssqlTable(name)}`,
    );
    return result.recordset as T[];
  }

  async writeTable<T>(name: string, rows: T[]): Promise<void> {
    const transaction = new mssql.Transaction(this.pool);
    await transaction.begin();
    try {
      const request = new mssql.Request(transaction);
      await request.query(`DELETE FROM ${this.mssqlTable(name)}`);
      if (rows.length) {
        const schema = await this.getSchema(name);
        if (!schema) {
          throw new Error(`Schema missing for table ${name}`);
        }
        const columns = schema.columns.map((col) => col.name);
        for (const row of rows) {
          const insertRequest = new mssql.Request(transaction);
          const columnList = columns
            .map((col) => this.mssqlIdent(col))
            .join(",");
          const valueParams: string[] = [];
          columns.forEach((col, idx) => {
            const paramName = `param${idx}`;
            const value = (row as any)[col];
            insertRequest.input(
              paramName,
              this.getMssqlType(
                schema.columns.find((c) => c.name === col)?.type,
              ),
              normalizeValue(value),
            );
            valueParams.push(`@${paramName}`);
          });
          await insertRequest.query(
            `INSERT INTO ${this.mssqlTable(name)} (${columnList}) VALUES (${valueParams.join(",")})`,
          );
        }
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async getSchema(name: string): Promise<TableSchema | undefined> {
    if (this.schemaCache.has(name)) {
      return this.schemaCache.get(name);
    }
    return this.withRequest(async (request) => {
      const result = await request.query(`
        SELECT
          c.COLUMN_NAME,
          c.DATA_TYPE,
          c.IS_NULLABLE,
          c.COLUMN_DEFAULT
        FROM INFORMATION_SCHEMA.COLUMNS c
        WHERE c.TABLE_SCHEMA = '${this.schemaName}'
          AND c.TABLE_NAME = '${name}'
        ORDER BY c.ORDINAL_POSITION
      `);
      const rows = result.recordset;
      if (!rows.length) {
        return undefined;
      }
      const schema: TableSchema = {
        name,
        columns: rows.map((column: any) => ({
          name: column.COLUMN_NAME,
          type: this.fromMssqlType(column.DATA_TYPE),
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
      const transaction = new mssql.Transaction(this.pool);
      await transaction.begin();
      return new MssqlTransactionDriver(this, transaction);
    });
  }

  async dropTable(name: string): Promise<void> {
    await this.withRequest((request) =>
      request.query(`DROP TABLE IF EXISTS ${this.mssqlTable(name)}`),
    );
    this.schemaCache.delete(name);
  }

  private async tableExists(
    request: mssql.Request,
    name: string,
  ): Promise<boolean> {
    const result = await request.query(`
      SELECT 1
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = '${this.schemaName}'
        AND TABLE_NAME = '${name}'
    `);
    return result.recordset.length > 0;
  }

  private async addMissingColumns(
    request: mssql.Request,
    schema: TableSchema,
  ): Promise<void> {
    const result = await request.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = '${this.schemaName}'
        AND TABLE_NAME = '${schema.name}'
    `);
    const existing = new Set(
      result.recordset.map((row: any) => row.COLUMN_NAME),
    );
    for (const column of schema.columns) {
      if (existing.has(column.name)) continue;
      await request.query(
        `ALTER TABLE ${this.mssqlTable(schema.name)} ADD ${this.mssqlColumnDefinition(column)}`,
      );
    }
  }

  private mssqlColumnDefinition(column: ColumnSchema): string {
    const parts = [this.mssqlIdent(column.name), this.mssqlType(column.type)];
    if (column.nullable === false) {
      parts.push("NOT NULL");
    }
    if (column.default !== undefined) {
      parts.push(`DEFAULT ${this.formatMssqlDefault(column.default)}`);
    }
    return parts.join(" ");
  }

  private mssqlType(type?: string): string {
    switch (type) {
      case "number":
        return "FLOAT";
      case "boolean":
        return "BIT";
      case "date":
        return "DATETIME2";
      case "json":
        return "NVARCHAR(MAX)";
      default:
        return "NVARCHAR(MAX)";
    }
  }

  private getMssqlType(type?: string): any {
    switch (type) {
      case "number":
        return mssql.Float;
      case "boolean":
        return mssql.Bit;
      case "date":
        return mssql.DateTime2;
      case "json":
        return mssql.NVarChar;
      default:
        return mssql.NVarChar;
    }
  }

  private formatMssqlDefault(value: unknown): string {
    if (value === null) return "NULL";
    if (typeof value === "number") return value.toString();
    if (typeof value === "boolean") return value ? "1" : "0";
    if (value instanceof Date)
      return `'${value.toISOString().slice(0, 19).replace("T", " ")}'`;
    return `N'${String(value).replace(/'/g, "''")}'`;
  }

  private buildMssqlConstraintDefinitions(schema: TableSchema): string[] {
    const definitions: string[] = [];
    if (schema.primaryColumns?.length) {
      const name = schema.primaryKeyName ?? `PK_${schema.name}`;
      definitions.push(
        `CONSTRAINT ${this.mssqlIdent(name)} PRIMARY KEY (${schema.primaryColumns
          .map((column) => this.mssqlIdent(column))
          .join(",")})`,
      );
    }
    for (const unique of schema.uniqueConstraints ?? []) {
      const name =
        unique.name ?? `UQ_${schema.name}_${unique.columns.join("_")}`;
      definitions.push(
        `CONSTRAINT ${this.mssqlIdent(name)} UNIQUE (${unique.columns
          .map((column) => this.mssqlIdent(column))
          .join(",")})`,
      );
    }
    for (const fk of schema.foreignKeys ?? []) {
      const clauses: string[] = [];
      if (fk.onDelete)
        clauses.push(`ON DELETE ${this.formatAction(fk.onDelete)}`);
      if (fk.onUpdate)
        clauses.push(`ON UPDATE ${this.formatAction(fk.onUpdate)}`);
      const name = fk.name ?? `FK_${schema.name}_${fk.columns.join("_")}`;
      definitions.push(
        `CONSTRAINT ${this.mssqlIdent(name)} FOREIGN KEY (${fk.columns
          .map((column) => this.mssqlIdent(column))
          .join(
            ",",
          )}) REFERENCES ${this.mssqlTable(fk.referencedTable)} (${fk.referencedColumns
          .map((column) => this.mssqlIdent(column))
          .join(",")}) ${clauses.join(" ")}`.trim(),
      );
    }
    return definitions;
  }

  private formatAction(action: ConstraintAction): string {
    switch (action) {
      case "set null":
        return "SET NULL";
      case "no action":
        return "NO ACTION";
      case "restrict":
        return "NO ACTION";
      case "cascade":
      default:
        return "CASCADE";
    }
  }

  private mssqlTable(name: string): string {
    return `${this.mssqlIdent(this.schemaName)}.${this.mssqlIdent(name)}`;
  }

  private mssqlIdent(identifier: string): string {
    return `[${identifier.replace(/]/g, "]]")}]`;
  }

  private fromMssqlType(type: string): string {
    const normalized = type.toLowerCase();
    if (
      normalized.includes("float") ||
      normalized.includes("decimal") ||
      normalized.includes("numeric")
    ) {
      return "number";
    }
    if (normalized.includes("bit")) {
      return "boolean";
    }
    if (
      normalized.includes("datetime") ||
      normalized.includes("date") ||
      normalized.includes("time")
    ) {
      return "date";
    }
    return "string";
  }

  private async withRequest<T>(
    handler: (request: mssql.Request) => Promise<T>,
  ): Promise<T> {
    return this.runWithResilience(async () => {
      const request = this.pool.request();
      return await handler(request);
    });
  }

  private runWithResilience<T>(task: () => Promise<T>): Promise<T> {
    return executeWithResilience(task, this.resilience);
  }
}

class MssqlTransactionDriver implements TransactionDriver {
  constructor(
    private readonly base: MssqlDatabaseDriver,
    private readonly transaction: mssql.Transaction,
  ) {}

  async init(): Promise<void> {
    // already initialized
  }

  async ensureTable(schema: TableSchema): Promise<void> {
    await this.base.ensureTable(schema);
  }

  async readTable<T>(name: string): Promise<T[]> {
    const request = new mssql.Request(this.transaction);
    const result = await request.query(
      `SELECT * FROM ${this.escapeTable(name)}`,
    );
    return result.recordset as T[];
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
    await this.transaction.commit();
  }

  async rollback(): Promise<void> {
    await this.transaction.rollback();
  }

  async createSavepoint(name: string): Promise<void> {
    const request = new mssql.Request(this.transaction);
    await request.query(`SAVE TRANSACTION ${sanitizeSavepointName(name)}`);
  }

  async releaseSavepoint(_name: string): Promise<void> {
    // MSSQL doesn't have explicit savepoint release
  }

  async rollbackToSavepoint(name: string): Promise<void> {
    const request = new mssql.Request(this.transaction);
    await request.query(`ROLLBACK TRANSACTION ${sanitizeSavepointName(name)}`);
  }

  private escapeTable(name: string): string {
    return `[${name.replace(/]/g, "]]")}]`;
  }
}
