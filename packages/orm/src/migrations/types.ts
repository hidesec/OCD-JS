import type { Connection, EntityManager } from "../connection";
import type { DatabaseDriver, TableSchema, TransactionDriver } from "../driver";
import type { QueryPlan } from "../query/criteria";
import type { Repository } from "../repository";
import { SchemaBuilder } from "../schema/builder";

export type Constructor<T = any> = new () => T;

export interface MigrationContext {
  driver: DatabaseDriver;
  createTable(schema: TableSchema): Promise<void>;
  dropTable(name: string): Promise<void>;
  schema: SchemaBuilder;
}

export interface MigrationDefinition {
  id: string;
  up(context: MigrationContext): Promise<void> | void;
  down?(context: MigrationContext): Promise<void> | void;
}

export interface SeedContext {
  connection: Connection;
  driver: DatabaseDriver | TransactionDriver;
  manager?: EntityManager;
  getRepository<T extends object>(entity: Constructor<T>): Repository<T>;
  truncate(target: Constructor | string): Promise<void>;
  insert<T extends object>(
    entity: Constructor<T>,
    values: Array<Partial<T>> | Partial<T>,
  ): Promise<T[]>;
  insertTable<T = Record<string, unknown>>(
    table: string,
    rows: T[],
  ): Promise<void>;
  rawQuery<T = Record<string, unknown>>(plan: QueryPlan): Promise<T[]>;
}

export interface SeederDefinition {
  id: string;
  handler: (context: SeedContext) => Promise<void> | void;
  dependsOn: string[];
  tags: string[];
  transactional: boolean;
}

export interface SeederOptions {
  id: string;
  dependsOn?: string[];
  tags?: string[];
  transactional?: boolean;
}
