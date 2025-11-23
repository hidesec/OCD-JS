import * as oracledb from "oracledb";
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

export interface OracleDriverOptions {
  user?: string;
  password?: string;
  connectString?: string;
  poolMin?: number;
  poolMax?: number;
  poolIncrement?: number;
  resilience?: DriverResilienceOptions;
}

export class OracleDatabaseDriver implements DatabaseDriver {
  private pool?: oracledb.Pool;
  private schemaCache = new Map<string, TableSchema>();
  private readonly resilience: ResolvedDriverResilienceOptions;

  constructor(private readonly options: OracleDriverOptions = {}) {
    this.resilience = resolveDriverResilienceOptions(options.resilience);
  }

  async init(): Promise<void> {
    await this.runWithResilience(async () => {
      this.pool = await oracledb.createPool({
        user: this.options.user ?? "system",
        password: this.options.password ?? "oracle",
        connectString: this.options.connectString ?? "localhost:1521/FREE",
        poolMin: this.options.poolMin ?? 1,
        poolMax: this.options.poolMax ?? 10,
        poolIncrement: this.options.poolIncrement ?? 1,
      });
      const connection = await this.pool.getConnection();
      try {
        await connection.execute("SELECT 1 FROM DUAL");
      } finally {
        await connection.close();
      }
    });
  }

  async ensureTable(schema: TableSchema): Promise<void> {
    await this.withConnection(async (connection) => {
      const exists = await this.tableExists(connection, schema.name);
      if (!exists) {
        const columns = schema.columns.map((column) =>
          this.oracleColumnDefinition(column),
        );
        const constraints = this.buildOracleConstraintDefinitions(schema);
        const sql = `CREATE TABLE ${this.oracleIdent(schema.name)} (${[...columns, ...constraints].join(",")})`;
        await connection.execute(sql);
      } else {
        await this.addMissingColumns(connection, schema);
      }
    });
    this.schemaCache.set(schema.name, schema);
  }

  async readTable<T>(name: string): Promise<T[]> {
    return this.withConnection(async (connection) => {
      const result = await connection.execute(
        `SELECT * FROM ${this.oracleIdent(name)}`,
        [],
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      return (result.rows as any[]) ?? [];
    });
  }

  async writeTable<T>(name: string, rows: T[]): Promise<void> {
    await this.withConnection(async (connection) => {
      await connection.execute(`DELETE FROM ${this.oracleIdent(name)}`);
      if (rows.length) {
        const schema = await this.getSchema(name);
        if (!schema) {
          throw new Error(`Schema missing for table ${name}`);
        }
        const columns = schema.columns.map((col) => col.name);
        const placeholders = columns.map((_, idx) => `:${idx + 1}`).join(",");
        const sql = `INSERT INTO ${this.oracleIdent(name)} (${columns
          .map((col) => this.oracleIdent(col))
          .join(",")}) VALUES (${placeholders})`;

        for (const row of rows) {
          const binds = columns.map((col) => normalizeValue((row as any)[col]));
          await connection.execute(sql, binds);
        }
      }
      await connection.commit();
    });
  }

  async getSchema(name: string): Promise<TableSchema | undefined> {
    if (this.schemaCache.has(name)) {
      return this.schemaCache.get(name);
    }
    return this.withConnection(async (connection) => {
      const result = await connection.execute(
        `SELECT
          COLUMN_NAME,
          DATA_TYPE,
          NULLABLE,
          DATA_DEFAULT
        FROM USER_TAB_COLUMNS
        WHERE TABLE_NAME = :tableName
        ORDER BY COLUMN_ID`,
        [name.toUpperCase()],
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const rows = (result.rows as any[]) ?? [];
      if (!rows.length) {
        return undefined;
      }
      const schema: TableSchema = {
        name,
        columns: rows.map((column: any) => ({
          name: column.COLUMN_NAME,
          type: this.fromOracleType(column.DATA_TYPE),
          nullable: column.NULLABLE === "Y",
          default: column.DATA_DEFAULT ?? undefined,
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
      if (!this.pool) {
        throw new Error("OracleDatabaseDriver not initialized");
      }
      const connection = await this.pool.getConnection();
      return new OracleTransactionDriver(this, connection);
    });
  }

  async dropTable(name: string): Promise<void> {
    await this.withConnection(async (connection) => {
      await connection.execute(
        `BEGIN
          EXECUTE IMMEDIATE 'DROP TABLE ${this.oracleIdent(name)} CASCADE CONSTRAINTS';
        EXCEPTION
          WHEN OTHERS THEN
            IF SQLCODE != -942 THEN
              RAISE;
            END IF;
        END;`,
      );
    });
    this.schemaCache.delete(name);
  }

  private async tableExists(
    connection: oracledb.Connection,
    name: string,
  ): Promise<boolean> {
    const result = await connection.execute(
      `SELECT 1 FROM USER_TABLES WHERE TABLE_NAME = :tableName`,
      [name.toUpperCase()],
    );
    return (result.rows?.length ?? 0) > 0;
  }

  private async addMissingColumns(
    connection: oracledb.Connection,
    schema: TableSchema,
  ): Promise<void> {
    const result = await connection.execute(
      `SELECT COLUMN_NAME FROM USER_TAB_COLUMNS WHERE TABLE_NAME = :tableName`,
      [schema.name.toUpperCase()],
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const existing = new Set(
      ((result.rows as any[]) ?? []).map((row: any) => row.COLUMN_NAME),
    );
    for (const column of schema.columns) {
      if (existing.has(column.name.toUpperCase())) continue;
      await connection.execute(
        `ALTER TABLE ${this.oracleIdent(schema.name)} ADD ${this.oracleColumnDefinition(column)}`,
      );
    }
  }

  private oracleColumnDefinition(column: ColumnSchema): string {
    const parts = [this.oracleIdent(column.name), this.oracleType(column.type)];
    if (column.nullable === false) {
      parts.push("NOT NULL");
    }
    if (column.default !== undefined) {
      parts.push(`DEFAULT ${this.formatOracleDefault(column.default)}`);
    }
    return parts.join(" ");
  }

  private oracleType(type?: string): string {
    switch (type) {
      case "number":
        return "NUMBER";
      case "boolean":
        return "NUMBER(1)";
      case "date":
        return "TIMESTAMP";
      case "json":
        return "CLOB";
      default:
        return "VARCHAR2(4000)";
    }
  }

  private formatOracleDefault(value: unknown): string {
    if (value === null) return "NULL";
    if (typeof value === "number") return value.toString();
    if (typeof value === "boolean") return value ? "1" : "0";
    if (value instanceof Date)
      return `TIMESTAMP '${value.toISOString().slice(0, 19).replace("T", " ")}'`;
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  private buildOracleConstraintDefinitions(schema: TableSchema): string[] {
    const definitions: string[] = [];
    if (schema.primaryColumns?.length) {
      const name = schema.primaryKeyName ?? `PK_${schema.name}`;
      definitions.push(
        `CONSTRAINT ${this.oracleIdent(name)} PRIMARY KEY (${schema.primaryColumns
          .map((column) => this.oracleIdent(column))
          .join(",")})`,
      );
    }
    for (const unique of schema.uniqueConstraints ?? []) {
      const name =
        unique.name ?? `UQ_${schema.name}_${unique.columns.join("_")}`;
      definitions.push(
        `CONSTRAINT ${this.oracleIdent(name)} UNIQUE (${unique.columns
          .map((column) => this.oracleIdent(column))
          .join(",")})`,
      );
    }
    for (const fk of schema.foreignKeys ?? []) {
      const clauses: string[] = [];
      if (fk.onDelete)
        clauses.push(`ON DELETE ${this.formatAction(fk.onDelete)}`);
      const name = fk.name ?? `FK_${schema.name}_${fk.columns.join("_")}`;
      definitions.push(
        `CONSTRAINT ${this.oracleIdent(name)} FOREIGN KEY (${fk.columns
          .map((column) => this.oracleIdent(column))
          .join(
            ",",
          )}) REFERENCES ${this.oracleIdent(fk.referencedTable)} (${fk.referencedColumns
          .map((column) => this.oracleIdent(column))
          .join(",")}) ${clauses.join(" ")}`.trim(),
      );
    }
    return definitions;
  }

  private formatAction(action: ConstraintAction): string {
    switch (action) {
      case "set null":
        return "SET NULL";
      case "cascade":
        return "CASCADE";
      case "restrict":
      case "no action":
      default:
        return "";
    }
  }

  private oracleIdent(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  private fromOracleType(type: string): string {
    const normalized = type.toLowerCase();
    if (normalized.includes("number") || normalized.includes("numeric")) {
      return "number";
    }
    if (normalized.includes("timestamp") || normalized.includes("date")) {
      return "date";
    }
    if (normalized.includes("clob") || normalized.includes("blob")) {
      return "json";
    }
    return "string";
  }

  private async withConnection<T>(
    handler: (connection: oracledb.Connection) => Promise<T>,
  ): Promise<T> {
    return this.runWithResilience(async () => {
      if (!this.pool) {
        throw new Error("OracleDatabaseDriver not initialized");
      }
      const connection = await this.pool.getConnection();
      try {
        return await handler(connection);
      } finally {
        await connection.close();
      }
    });
  }

  private runWithResilience<T>(task: () => Promise<T>): Promise<T> {
    return executeWithResilience(task, this.resilience);
  }
}

class OracleTransactionDriver implements TransactionDriver {
  constructor(
    private readonly base: OracleDatabaseDriver,
    private readonly connection: oracledb.Connection,
  ) {}

  async init(): Promise<void> {
    // already initialized
  }

  async ensureTable(schema: TableSchema): Promise<void> {
    await this.base.ensureTable(schema);
  }

  async readTable<T>(name: string): Promise<T[]> {
    const result = await this.connection.execute(
      `SELECT * FROM ${this.escapeTable(name)}`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return (result.rows as T[]) ?? [];
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
    await this.connection.close();
  }

  async rollback(): Promise<void> {
    await this.connection.rollback();
    await this.connection.close();
  }

  async createSavepoint(name: string): Promise<void> {
    await this.connection.execute(`SAVEPOINT ${sanitizeSavepointName(name)}`);
  }

  async releaseSavepoint(_name: string): Promise<void> {
    // Oracle doesn't need explicit savepoint release
  }

  async rollbackToSavepoint(name: string): Promise<void> {
    await this.connection.execute(
      `ROLLBACK TO SAVEPOINT ${sanitizeSavepointName(name)}`,
    );
  }

  private escapeTable(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
  }
}
