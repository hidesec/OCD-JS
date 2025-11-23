import { promises as fs } from "node:fs";
import { QueryPlan } from "../query/criteria";
import { executePlan } from "../query/plan-executor";
import { buildTransactionalInterface, cloneState } from "./base";
import {
  DatabaseDriver,
  PersistedState,
  TableSchema,
  TransactionDriver,
} from "./interfaces";

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
