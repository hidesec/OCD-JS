export type ColumnType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "json"
  | "decimal"
  | "float"
  | "double"
  | "bigint"
  | "uuid"
  | "text"
  | "binary"
  | "blob"
  | "timestamp"
  | "timestamptz"
  | "time"
  | "enum"
  | "jsonb"
  | "array";

export type ReferentialAction =
  | "cascade"
  | "restrict"
  | "set null"
  | "no action";

export interface ColumnOptions {
  type?: ColumnType;
  primary?: boolean;
  nullable?: boolean;
  default?: unknown;
  unique?: boolean;
  length?: number;
  precision?: number;
  scale?: number;
  enumName?: string;
  enumValues?: string[];
  withTimeZone?: boolean;
  references?: {
    entity: () => Function;
    column?: string;
    name?: string;
    onDelete?: ReferentialAction;
    onUpdate?: ReferentialAction;
  };
}

export interface ColumnMetadata {
  propertyKey: string;
  options: ColumnOptions;
}

export interface UniqueConstraintMetadata {
  name?: string;
  columns: string[];
}

export interface ForeignKeyMetadata {
  columns: string[];
  referenced: () => Function;
  referencedColumns?: string[];
  name?: string;
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
}

export interface EntityCacheOptions {
  enabled?: boolean;
  ttl?: number;
}

export interface EntityMetadata {
  target: Function;
  tableName: string;
  columns: ColumnMetadata[];
  primaryColumns: ColumnMetadata[];
  uniqueConstraints: UniqueConstraintMetadata[];
  foreignKeys: ForeignKeyMetadata[];
  cache?: EntityCacheOptions;
}

const entityRegistry = new Map<Function, EntityMetadata>();

export const registerEntity = (target: Function, tableName?: string) => {
  if (!entityRegistry.has(target)) {
    entityRegistry.set(target, {
      target,
      tableName: tableName ?? target.name.replace(/Entity$/, "").toLowerCase(),
      columns: [],
      primaryColumns: [],
      uniqueConstraints: [],
      foreignKeys: [],
      cache: undefined,
    });
  }
};

const ensureEntityMetadata = (target: Function): EntityMetadata => {
  if (!entityRegistry.has(target)) {
    registerEntity(target);
  }
  return entityRegistry.get(target)!;
};

export const setEntityCacheOptions = (
  target: Function,
  options: EntityCacheOptions,
) => {
  const metadata = ensureEntityMetadata(target);
  metadata.cache = {
    enabled: options.enabled ?? true,
    ttl: options.ttl,
  };
};

export const registerUniqueConstraint = (
  target: Function,
  columns: string[],
  name?: string,
) => {
  const metadata = ensureEntityMetadata(target);
  metadata.uniqueConstraints.push({ name, columns });
};

export const registerForeignKey = (
  target: Function,
  foreignKey: ForeignKeyMetadata,
) => {
  const metadata = ensureEntityMetadata(target);
  metadata.foreignKeys.push(foreignKey);
};

export const registerColumn = (
  target: Function,
  propertyKey: string,
  options: ColumnOptions,
) => {
  const metadata = ensureEntityMetadata(target);
  const column: ColumnMetadata = {
    propertyKey,
    options,
  };
  metadata.columns.push(column);
  if (options.primary) {
    metadata.primaryColumns.push(column);
  }
  if (options.unique) {
    registerUniqueConstraint(target, [propertyKey]);
  }
  if (options.references) {
    registerForeignKey(target, {
      columns: [propertyKey],
      referenced: options.references.entity,
      referencedColumns: options.references.column
        ? [options.references.column]
        : undefined,
      name: options.references.name,
      onDelete: options.references.onDelete,
      onUpdate: options.references.onUpdate,
    });
  }
};

export const getEntityMetadata = (target: Function): EntityMetadata => {
  const metadata = entityRegistry.get(target);
  if (!metadata) {
    throw new Error(`Entity metadata missing for ${target.name}`);
  }
  return metadata;
};

export const listEntities = (): EntityMetadata[] =>
  Array.from(entityRegistry.values());

export const getEntityCacheOptions = (
  target: Function,
): EntityCacheOptions | undefined => entityRegistry.get(target)?.cache;

export const getEntityCacheOptionsByTable = (
  tableName: string,
): EntityCacheOptions | undefined => {
  for (const metadata of entityRegistry.values()) {
    if (metadata.tableName === tableName) {
      return metadata.cache;
    }
  }
  return undefined;
};
