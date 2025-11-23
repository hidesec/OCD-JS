import { QueryPlan } from "../query/criteria";

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

export interface PersistedState {
  tables: Record<string, unknown[]>;
  schemas: Record<string, TableSchema>;
}
