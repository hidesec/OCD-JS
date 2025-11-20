import { EntityMetadata } from "./metadata";

interface IdentityEntry<T> {
  key?: string;
  metadata: EntityMetadata;
  entity: T;
  proxy: T;
  snapshot: Record<string, unknown>;
  dirtyFields: Set<string>;
  suppressTracking: boolean;
  trackedColumns: Set<string>;
}

const ENTRY_SYMBOL = Symbol("__identity_entry__");

export class IdentityMap {
  private readonly entries = new Map<string, IdentityEntry<any>>();
  private lookup = new WeakMap<object, IdentityEntry<any>>();
  private readonly entrySet = new Set<IdentityEntry<any>>();

  trackNew<T extends object>(metadata: EntityMetadata, entity: T): T {
    const entry = this.createEntry(metadata, entity);
    entry.snapshot = this.captureSnapshot(metadata, entity);
    return entry.proxy;
  }

  hydrate<T extends object>(
    metadata: EntityMetadata,
    plain: Record<string, unknown>,
    factory: () => T,
    onCreate?: (entity: T) => void,
  ): T {
    const key = this.computeKey(metadata, plain);
    if (key) {
      const existing = this.entries.get(key);
      if (existing) {
        this.applyPlain(existing, plain);
        return existing.proxy;
      }
    }
    const entity = factory();
    const entry = this.createEntry(metadata, entity);
    if (key) {
      entry.key = key;
      this.entries.set(key, entry);
    }
    this.applyPlain(entry, plain);
    if (onCreate) {
      onCreate(entry.proxy);
    }
    return entry.proxy;
  }

  updateAfterPersist<T extends object>(
    metadata: EntityMetadata,
    entity: T,
    plain: Record<string, unknown>,
  ): void {
    const entry = this.lookup.get(entity as object);
    if (!entry) return;
    const key = this.computeKey(metadata, plain);
    if (key) {
      entry.key = key;
      this.entries.set(key, entry);
    }
    this.applyPlain(entry, plain);
  }

  evict(entity: object): void {
    const entry = this.lookup.get(entity);
    if (!entry) return;
    if (entry.key) {
      this.entries.delete(entry.key);
    }
    this.lookup.delete(entry.proxy as object);
    this.lookup.delete(entry.entity as object);
    this.entrySet.delete(entry);
  }

  getSnapshot(entity: object): Record<string, unknown> | undefined {
    const entry = this.lookup.get(entity);
    return entry ? { ...entry.snapshot } : undefined;
  }

  adoptFrom(source: IdentityMap): void {
    if (source === this) return;
    for (const entry of source.entrySet) {
      if (entry.key) {
        this.entries.set(entry.key, entry);
      }
      this.lookup.set(entry.proxy as object, entry);
      this.lookup.set(entry.entity as object, entry);
      this.entrySet.add(entry);
    }
    source.clear();
  }

  clear(): void {
    this.entries.clear();
    this.entrySet.clear();
    this.lookup = new WeakMap<object, IdentityEntry<any>>();
  }

  private createEntry<T extends object>(
    metadata: EntityMetadata,
    entity: T,
  ): IdentityEntry<T> {
    const entry: IdentityEntry<T> = {
      metadata,
      entity,
      proxy: entity,
      snapshot: {},
      dirtyFields: new Set<string>(),
      suppressTracking: false,
      trackedColumns: new Set(
        metadata.columns.map((column) => column.propertyKey),
      ),
    };
    const proxy = new Proxy(entity as object, {
      get: (target, prop, receiver) => {
        if (prop === ENTRY_SYMBOL) {
          return entry;
        }
        return Reflect.get(target, prop, receiver);
      },
      set: (target, prop, value, receiver) => {
        const result = Reflect.set(target, prop, value, receiver);
        if (
          entry.suppressTracking ||
          typeof prop !== "string" ||
          !entry.trackedColumns.has(prop)
        ) {
          return result;
        }
        entry.dirtyFields.add(prop);
        return result;
      },
    });
    entry.proxy = proxy as T;
    this.lookup.set(proxy as object, entry);
    this.lookup.set(entity as object, entry);
    this.entrySet.add(entry);
    return entry;
  }

  private applyPlain(
    entry: IdentityEntry<any>,
    plain: Record<string, unknown>,
  ) {
    entry.suppressTracking = true;
    entry.metadata.columns.forEach((column) => {
      (entry.entity as any)[column.propertyKey] = plain[column.propertyKey];
    });
    entry.suppressTracking = false;
    entry.snapshot = { ...plain };
    entry.dirtyFields.clear();
  }

  private captureSnapshot(
    metadata: EntityMetadata,
    entity: object,
  ): Record<string, unknown> {
    return metadata.columns.reduce(
      (acc, column) => {
        acc[column.propertyKey] = (entity as any)[column.propertyKey];
        return acc;
      },
      {} as Record<string, unknown>,
    );
  }

  private computeKey(
    metadata: EntityMetadata,
    plain: Record<string, unknown>,
  ): string | undefined {
    if (!metadata.primaryColumns.length) return undefined;
    const segments: string[] = [];
    for (const column of metadata.primaryColumns) {
      const value = plain[column.propertyKey];
      if (value === undefined || value === null) {
        return undefined;
      }
      segments.push(`${column.propertyKey}:${String(value)}`);
    }
    return `${metadata.tableName}|${segments.join("|")}`;
  }
}

export const getIdentityEntry = (entity: object) =>
  (entity as any)[ENTRY_SYMBOL] as IdentityEntry<any> | undefined;
