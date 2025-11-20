import { DatabaseDriver, TableSchema, TransactionDriver } from "./driver";
import { getEntityCacheOptionsByTable } from "./metadata";
import { QueryPlan } from "./query/criteria";

export interface SecondLevelCacheOptions {
  defaultTtl?: number;
}

interface CacheEntry {
  rows: unknown[];
  expiresAt?: number;
}

const CACHED_DRIVER_TOKEN = Symbol("ocd-js-second-level-cache");

const cloneRows = <T>(rows: T[]): T[] => {
  const cloneFn = (globalThis as any).structuredClone;
  if (typeof cloneFn === "function") {
    return cloneFn(rows);
  }
  return JSON.parse(JSON.stringify(rows));
};

class SecondLevelCacheStore {
  private readonly tables = new Map<string, CacheEntry>();

  getTable<T>(table: string): T[] | undefined {
    const entry = this.tables.get(table);
    if (!entry) return undefined;
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      this.tables.delete(table);
      return undefined;
    }
    return cloneRows(entry.rows) as T[];
  }

  setTable<T>(table: string, rows: T[], ttl?: number): void {
    const expiresAt = ttl ? Date.now() + ttl : undefined;
    this.tables.set(table, {
      rows: cloneRows(rows),
      expiresAt,
    });
  }

  invalidateTable(table: string): void {
    this.tables.delete(table);
  }

  invalidateTables(tables: Iterable<string>): void {
    for (const table of tables) {
      this.tables.delete(table);
    }
  }

  clear(): void {
    this.tables.clear();
  }
}

class SecondLevelCachedDriver implements DatabaseDriver {
  private readonly cache = new SecondLevelCacheStore();

  constructor(
    private readonly inner: DatabaseDriver,
    private readonly options: SecondLevelCacheOptions = {},
  ) {
    (this as any)[CACHED_DRIVER_TOKEN] = true;
  }

  async init(): Promise<void> {
    await this.inner.init();
    this.cache.clear();
  }

  async ensureTable(schema: TableSchema): Promise<void> {
    await this.inner.ensureTable(schema);
    this.cache.invalidateTable(schema.name);
  }

  async readTable<T>(name: string): Promise<T[]> {
    const cached = this.getCachedRows<T>(name);
    if (cached) {
      return cached;
    }
    const rows = await this.inner.readTable<T>(name);
    this.storeRows(name, rows);
    return cloneRows(rows);
  }

  async writeTable<T>(name: string, rows: T[]): Promise<void> {
    await this.inner.writeTable(name, rows);
    this.storeRows(name, rows);
  }

  async getSchema(name: string): Promise<TableSchema | undefined> {
    return this.inner.getSchema(name);
  }

  async updateSchema(schema: TableSchema): Promise<void> {
    await this.inner.updateSchema(schema);
    this.cache.invalidateTable(schema.name);
  }

  async beginTransaction(): Promise<TransactionDriver> {
    const tx = await this.inner.beginTransaction();
    return new CachedTransactionDriver(tx, this.cache);
  }

  async dropTable(name: string): Promise<void> {
    await this.inner.dropTable(name);
    this.cache.invalidateTable(name);
  }

  supportsQuery?(plan: QueryPlan): boolean {
    return this.inner.supportsQuery ? this.inner.supportsQuery(plan) : false;
  }

  executeQuery?<T>(plan: QueryPlan): Promise<T[]> {
    if (!this.inner.executeQuery) {
      throw new Error("Underlying driver does not support executeQuery");
    }
    return this.inner.executeQuery(plan);
  }

  private getCachedRows<T>(table: string): T[] | undefined {
    if (!this.shouldCache(table)) {
      return undefined;
    }
    return this.cache.getTable<T>(table);
  }

  private storeRows<T>(table: string, rows: T[]): void {
    if (!this.shouldCache(table)) {
      this.cache.invalidateTable(table);
      return;
    }
    const ttl = this.resolveTableTtl(table);
    this.cache.setTable(table, rows, ttl);
  }

  private shouldCache(table: string): boolean {
    const config = getEntityCacheOptionsByTable(table);
    if (!config) return false;
    return config.enabled !== false;
  }

  private resolveTableTtl(table: string): number | undefined {
    const config = getEntityCacheOptionsByTable(table);
    if (!config || config.enabled === false) {
      return undefined;
    }
    return config.ttl ?? this.options.defaultTtl;
  }
}

class CachedTransactionDriver implements TransactionDriver {
  private readonly mutatedTables = new Set<string>();

  constructor(
    private readonly inner: TransactionDriver,
    private readonly cache: SecondLevelCacheStore,
  ) {}

  async init(): Promise<void> {
    await this.inner.init();
  }

  async ensureTable(schema: TableSchema): Promise<void> {
    await this.inner.ensureTable(schema);
    this.mutatedTables.add(schema.name);
  }

  async readTable<T>(name: string): Promise<T[]> {
    return this.inner.readTable(name);
  }

  async writeTable<T>(name: string, rows: T[]): Promise<void> {
    await this.inner.writeTable(name, rows);
    this.mutatedTables.add(name);
  }

  async getSchema(name: string): Promise<TableSchema | undefined> {
    return this.inner.getSchema(name);
  }

  async updateSchema(schema: TableSchema): Promise<void> {
    await this.inner.updateSchema(schema);
    this.mutatedTables.add(schema.name);
  }

  async beginTransaction(): Promise<TransactionDriver> {
    const nested = await this.inner.beginTransaction();
    return new CachedTransactionDriver(nested, this.cache);
  }

  async dropTable(name: string): Promise<void> {
    await this.inner.dropTable(name);
    this.mutatedTables.add(name);
  }

  supportsQuery?(plan: QueryPlan): boolean {
    return this.inner.supportsQuery ? this.inner.supportsQuery(plan) : false;
  }

  executeQuery?<T>(plan: QueryPlan): Promise<T[]> {
    if (!this.inner.executeQuery) {
      throw new Error(
        "Underlying transaction driver does not support executeQuery",
      );
    }
    return this.inner.executeQuery(plan);
  }

  async commit(): Promise<void> {
    await this.inner.commit();
    this.cache.invalidateTables(this.mutatedTables);
    this.mutatedTables.clear();
  }

  async rollback(): Promise<void> {
    await this.inner.rollback();
    this.mutatedTables.clear();
  }

  async createSavepoint(name: string): Promise<void> {
    if (!this.inner.createSavepoint) return;
    await this.inner.createSavepoint(name);
  }

  async releaseSavepoint(name: string): Promise<void> {
    if (!this.inner.releaseSavepoint) return;
    await this.inner.releaseSavepoint(name);
  }

  async rollbackToSavepoint(name: string): Promise<void> {
    if (!this.inner.rollbackToSavepoint) return;
    await this.inner.rollbackToSavepoint(name);
  }
}

export const withSecondLevelCache = (
  driver: DatabaseDriver,
  options: SecondLevelCacheOptions = {},
): DatabaseDriver => {
  if ((driver as any)[CACHED_DRIVER_TOKEN]) {
    return driver;
  }
  return new SecondLevelCachedDriver(driver, options);
};

export const isSecondLevelCachedDriver = (driver: DatabaseDriver): boolean =>
  Boolean((driver as any)[CACHED_DRIVER_TOKEN]);
