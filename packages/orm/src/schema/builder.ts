import {
  ColumnSchema,
  DatabaseDriver,
  ForeignKeySchema,
  TableSchema,
  UniqueConstraintSchema,
} from "../driver";
import { ColumnType, ReferentialAction } from "../metadata";

type SchemaOperation =
  | { type: "ensure"; schema: TableSchema }
  | { type: "drop"; name: string }
  | {
      type: "alter";
      name: string;
      configure: (table: TableBlueprint) => void;
    };

export class SchemaBuilder {
  private operations: SchemaOperation[] = [];

  constructor(private readonly driver: DatabaseDriver) {}

  createTable(name: string, configure: (table: TableBlueprint) => void) {
    const blueprint = new TableBlueprint(name);
    configure(blueprint);
    this.operations.push({ type: "ensure", schema: blueprint.build() });
    return blueprint;
  }

  table(name: string, configure: (table: TableBlueprint) => void) {
    return this.createTable(name, configure);
  }

  dropTable(name: string) {
    this.operations.push({ type: "drop", name });
  }

  alterTable(name: string, configure: (table: TableBlueprint) => void) {
    this.operations.push({ type: "alter", name, configure });
  }

  async execute() {
    for (const operation of this.operations) {
      if (operation.type === "ensure") {
        await this.driver.ensureTable(operation.schema);
        continue;
      }
      if (operation.type === "drop") {
        await this.driver.dropTable(operation.name);
        continue;
      }
      if (operation.type === "alter") {
        const existing = await this.driver.getSchema(operation.name);
        if (!existing) {
          throw new Error(`Cannot alter missing table ${operation.name}`);
        }
        const blueprint = new TableBlueprint(operation.name, existing);
        operation.configure(blueprint);
        await this.driver.ensureTable(blueprint.build());
      }
    }
    this.operations = [];
  }
}

export class TableBlueprint {
  private schema: TableSchema;

  constructor(name: string, base?: TableSchema) {
    this.schema = base ? cloneSchema(base) : createEmptySchema(name);
  }

  column(
    name: string,
    type: ColumnType,
    options: { nullable?: boolean; default?: unknown } = {},
  ) {
    this.schema.columns.push({
      name,
      type,
      nullable: options.nullable,
      default: options.default,
    });
    return this;
  }

  addColumn(
    name: string,
    type: ColumnType,
    options: { nullable?: boolean; default?: unknown } = {},
  ) {
    if (this.findColumn(name)) {
      throw new Error(`Column ${name} already exists on ${this.schema.name}`);
    }
    return this.column(name, type, options);
  }

  dropColumn(name: string) {
    const index = this.schema.columns.findIndex(
      (column) => column.name === name,
    );
    if (index >= 0) {
      this.schema.columns.splice(index, 1);
    }
    if (this.schema.primaryColumns) {
      this.schema.primaryColumns = this.schema.primaryColumns.filter(
        (column) => column !== name,
      );
    }
    this.schema.uniqueConstraints = (
      this.schema.uniqueConstraints ?? []
    ).filter((constraint) => !constraint.columns.includes(name));
    this.schema.foreignKeys = (this.schema.foreignKeys ?? []).filter(
      (fk) => !fk.columns.includes(name),
    );
    return this;
  }

  alterColumn(
    name: string,
    updates: Partial<Pick<ColumnSchema, "type" | "nullable" | "default">>,
  ) {
    const column = this.findColumn(name);
    if (!column) {
      throw new Error(`Column ${name} not found on ${this.schema.name}`);
    }
    if (updates.type !== undefined) {
      column.type = updates.type as ColumnType;
    }
    if (Object.prototype.hasOwnProperty.call(updates, "nullable")) {
      column.nullable = updates.nullable;
    }
    if (Object.prototype.hasOwnProperty.call(updates, "default")) {
      column.default = updates.default;
    }
    return this;
  }

  primary(columns: string[], name?: string) {
    this.schema.primaryColumns = columns;
    if (name) {
      this.schema.primaryKeyName = name;
    }
    return this;
  }

  setPrimaryKey(columns: string[], name?: string) {
    return this.primary(columns, name);
  }

  dropPrimaryKey() {
    this.schema.primaryColumns = [];
    this.schema.primaryKeyName = undefined;
    return this;
  }

  unique(columns: string[], name?: string) {
    this.schema.uniqueConstraints ??= [];
    this.schema.uniqueConstraints.push({
      name: name ?? `${this.schema.name}_uniq_${columns.join("_")}`,
      columns,
    });
    return this;
  }

  addUnique(columns: string[], name?: string) {
    return this.unique(columns, name);
  }

  dropUnique(identifier: string | string[]) {
    const match = createConstraintMatcher(identifier);
    this.schema.uniqueConstraints = (
      this.schema.uniqueConstraints ?? []
    ).filter((constraint) => !match(constraint));
    return this;
  }

  foreign(
    columns: string[],
    referencedTable: string,
    referencedColumns: string[],
    options: {
      name?: string;
      onDelete?: ReferentialAction;
      onUpdate?: ReferentialAction;
    } = {},
  ) {
    this.schema.foreignKeys ??= [];
    this.schema.foreignKeys.push({
      name:
        options.name ??
        `${this.schema.name}_fk_${columns.join("_")}_${referencedTable}`,
      columns,
      referencedTable,
      referencedColumns,
      onDelete: options.onDelete,
      onUpdate: options.onUpdate,
    });
    return this;
  }

  addForeign(
    columns: string[],
    referencedTable: string,
    referencedColumns: string[],
    options: {
      name?: string;
      onDelete?: ReferentialAction;
      onUpdate?: ReferentialAction;
    } = {},
  ) {
    return this.foreign(columns, referencedTable, referencedColumns, options);
  }

  dropForeign(identifier: string | string[]) {
    const match =
      typeof identifier === "string"
        ? (fk: ForeignKeySchema) => fk.name === identifier
        : (fk: ForeignKeySchema) =>
            normalizeColumns(fk.columns) === normalizeColumns(identifier);
    this.schema.foreignKeys = (this.schema.foreignKeys ?? []).filter(
      (fk) => !match(fk),
    );
    return this;
  }

  build(): TableSchema {
    return this.schema;
  }

  private findColumn(name: string): ColumnSchema | undefined {
    return this.schema.columns.find((column) => column.name === name);
  }
}

const createConstraintMatcher = (
  identifier: string | string[],
): ((constraint: UniqueConstraintSchema) => boolean) => {
  if (typeof identifier === "string") {
    return (constraint) => constraint.name === identifier;
  }
  const signature = normalizeColumns(identifier);
  return (constraint) => normalizeColumns(constraint.columns) === signature;
};

const normalizeColumns = (columns: string[]): string =>
  [...columns].sort().join("|");

const createEmptySchema = (name: string): TableSchema => ({
  name,
  columns: [],
  primaryColumns: [],
  uniqueConstraints: [],
  foreignKeys: [],
  primaryKeyName: `${name}_pk`,
});

const cloneSchema = (schema: TableSchema): TableSchema => ({
  name: schema.name,
  columns: schema.columns.map((column) => ({ ...column })),
  primaryColumns: [...(schema.primaryColumns ?? [])],
  primaryKeyName: schema.primaryKeyName,
  uniqueConstraints: (schema.uniqueConstraints ?? []).map((constraint) => ({
    name: constraint.name,
    columns: [...constraint.columns],
  })),
  foreignKeys: (schema.foreignKeys ?? []).map((fk) => ({
    name: fk.name,
    columns: [...fk.columns],
    referencedTable: fk.referencedTable,
    referencedColumns: [...fk.referencedColumns],
    onDelete: fk.onDelete,
    onUpdate: fk.onUpdate,
  })),
});
