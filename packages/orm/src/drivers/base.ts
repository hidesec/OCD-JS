import {
  ConstraintAction,
  ForeignKeySchema,
  PersistedState,
  TableSchema,
  TransactionDriver,
  UniqueConstraintSchema,
} from "./interfaces";

export const cloneState = (state: PersistedState): PersistedState => ({
  tables: JSON.parse(JSON.stringify(state.tables ?? {})),
  schemas: JSON.parse(JSON.stringify(state.schemas ?? {})),
});

export const buildTransactionalInterface = (
  snapshot: PersistedState,
  commitFn: (next: PersistedState) => Promise<void>,
): TransactionDriver => {
  let active = true;
  const ensureActive = () => {
    if (!active) throw new Error("Transaction already completed");
  };
  let working = cloneState(snapshot);
  const savepoints = new Map<string, PersistedState>();
  return {
    async init() {
      ensureActive();
    },
    async ensureTable(schema) {
      ensureActive();
      if (!working.tables[schema.name]) {
        working.tables[schema.name] = [];
      }
      working.schemas[schema.name] = schema;
    },
    async readTable<T>(name: string): Promise<T[]> {
      ensureActive();
      return ((working.tables[name] as T[] | undefined) ?? []).slice();
    },
    async writeTable<T>(name: string, rows: T[]): Promise<void> {
      ensureActive();
      working.tables[name] = rows as unknown[];
    },
    async getSchema(name) {
      ensureActive();
      return working.schemas[name];
    },
    async updateSchema(schema) {
      ensureActive();
      working.schemas[schema.name] = schema;
    },
    async dropTable(name) {
      ensureActive();
      delete working.tables[name];
      delete working.schemas[name];
    },
    async beginTransaction() {
      throw new Error("Nested transactions are not supported");
    },
    async commit() {
      ensureActive();
      active = false;
      await commitFn(working);
    },
    async rollback() {
      ensureActive();
      active = false;
    },
    async createSavepoint(name: string) {
      ensureActive();
      savepoints.set(name, cloneState(working));
    },
    async releaseSavepoint(name: string) {
      ensureActive();
      savepoints.delete(name);
    },
    async rollbackToSavepoint(name: string) {
      ensureActive();
      const snapshot = savepoints.get(name);
      if (!snapshot) {
        throw new Error(`Unknown savepoint ${name}`);
      }
      working = cloneState(snapshot);
    },
  };
};

export const sanitizeSavepointName = (name: string) =>
  name.replace(/[^a-zA-Z0-9_]/g, "_") || "sp";

export const quoteLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`;

export const quoteValue = (value: unknown): string => {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return value.toString();
  if (typeof value === "boolean") return value ? "1" : "0";
  return quoteLiteral(String(value));
};

export const normalizeAction = (
  action: unknown,
): ConstraintAction | undefined => {
  if (!action) return undefined;
  const normalized = String(action).toLowerCase();
  if (normalized === "cascade") return "cascade";
  if (normalized === "restrict") return "restrict";
  if (normalized === "set null") return "set null";
  if (normalized === "no action") return "no action";
  return undefined;
};

export const normalizeColumnType = (type?: string) =>
  (type ?? "text").toLowerCase();

export const foreignSignature = (fk: ForeignKeySchema): string =>
  `${fk.columns.sort().join("|")}:${fk.referencedTable}:${fk.referencedColumns
    .sort()
    .join("|")}`;

export const uniqueSignature = (constraint: UniqueConstraintSchema): string =>
  constraint.columns
    .map((column) => column.toLowerCase())
    .sort()
    .join("|");

export const requiresRebuild = (
  current: TableSchema,
  desired: TableSchema,
): boolean => {
  const currentColumns = new Map(
    (current.columns ?? []).map((column) => [column.name, column]),
  );
  if (currentColumns.size !== (desired.columns ?? []).length) {
    return true;
  }
  for (const column of desired.columns ?? []) {
    const existing = currentColumns.get(column.name);
    if (!existing) return true;
    if (
      normalizeColumnType(existing.type) !== normalizeColumnType(column.type)
    ) {
      return true;
    }
    if (!!existing.nullable !== !!column.nullable) {
      return true;
    }
    if (
      normalizeValue(existing.default) !==
      normalizeValue(column.default ?? undefined)
    ) {
      return true;
    }
  }
  const currentPrimary = (current.primaryColumns ?? []).join("|");
  const desiredPrimary = (desired.primaryColumns ?? []).join("|");
  if (currentPrimary !== desiredPrimary) {
    return true;
  }
  const currentForeign = new Set(
    (current.foreignKeys ?? []).map((fk) => foreignSignature(fk)),
  );
  for (const fk of desired.foreignKeys ?? []) {
    if (!currentForeign.has(foreignSignature(fk))) {
      return true;
    }
  }
  const currentUnique = new Set(
    (current.uniqueConstraints ?? []).map((constraint) =>
      uniqueSignature(constraint),
    ),
  );
  const desiredUnique = new Set(
    (desired.uniqueConstraints ?? []).map((constraint) =>
      uniqueSignature(constraint),
    ),
  );
  if (currentUnique.size !== desiredUnique.size) {
    return true;
  }
  for (const signature of desiredUnique) {
    if (!currentUnique.has(signature)) {
      return true;
    }
  }
  return false;
};

export const quoteIdent = (identifier: string) =>
  `"${identifier.replace(/"/g, '""')}"`;

export const normalizeValue = (value: unknown) => {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
};
