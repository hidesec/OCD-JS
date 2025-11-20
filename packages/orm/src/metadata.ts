export type ColumnType = "string" | "number" | "boolean" | "date" | "json";

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

export const setEntityCacheOptions = (
  target: Function,
  options: EntityCacheOptions,
) => {
  const metadata = entityRegistry.get(target);
  if (!metadata) {
    throw new Error(`@CacheEntity used before @Entity on ${target.name}`);
  }
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
  const metadata = entityRegistry.get(target);
  if (!metadata) {
    throw new Error(`@Unique used before @Entity on ${target.name}`);
  }
  metadata.uniqueConstraints.push({ name, columns });
};

export const registerForeignKey = (
  target: Function,
  foreignKey: ForeignKeyMetadata,
) => {
  const metadata = entityRegistry.get(target);
  if (!metadata) {
    throw new Error(`Foreign key defined before @Entity on ${target.name}`);
  }
  metadata.foreignKeys.push(foreignKey);
};

export const registerColumn = (
  target: Function,
  propertyKey: string,
  options: ColumnOptions,
) => {
  const metadata = entityRegistry.get(target);
  if (!metadata) {
    throw new Error(
      `Column decorator used before @Entity on ${target.name}.${propertyKey}`,
    );
  }
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
