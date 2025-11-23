import { QueryPlan } from "../query/criteria";
import { executePlan } from "../query/plan-executor";
import { buildTransactionalInterface, cloneState } from "./base";
import {
  DatabaseDriver,
  PersistedState,
  TableSchema,
  TransactionDriver,
} from "./interfaces";

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
