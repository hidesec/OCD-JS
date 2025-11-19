import { Module } from "@ocd-js/core";

export const DB_CLIENT = Symbol.for("OCD_DB_CLIENT");

export interface DatabaseClient {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  insert<T = unknown>(table: string, payload: T): Promise<void>;
}

export class InMemoryDatabaseClient implements DatabaseClient {
  private readonly tables = new Map<string, unknown[]>();

  async query<T = unknown>(sql: string): Promise<T[]> {
    const table = sql.trim().toLowerCase();
    return (this.tables.get(table) as T[]) ?? [];
  }

  async insert<T = unknown>(table: string, payload: T): Promise<void> {
    const existing = this.tables.get(table) ?? [];
    existing.push(payload);
    this.tables.set(table, existing);
  }
}

@Module({
  providers: [
    {
      token: DB_CLIENT,
      useClass: InMemoryDatabaseClient,
    },
  ],
  exports: [DB_CLIENT],
})
export class DatabaseModule {}
