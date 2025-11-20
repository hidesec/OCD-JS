import {
  ColumnSchema,
  DatabaseDriver,
  TableSchema,
  UniqueConstraintSchema,
  ForeignKeySchema,
} from "../driver";
import { EntityMetadata, getEntityMetadata, listEntities } from "../metadata";
import { buildTableSchema } from "./utils";

export interface ColumnAlteration {
  column: ColumnSchema;
  previous: ColumnSchema;
}

export interface TableUpdateDetails {
  addColumns: ColumnSchema[];
  alterColumns: ColumnAlteration[];
  dropColumns: string[];
  addUniqueConstraints: UniqueConstraintSchema[];
  dropUniqueConstraints: string[];
  addForeignKeys: ForeignKeySchema[];
  dropForeignKeys: string[];
}

export type SchemaChange =
  | { type: "create-table"; table: string; schema: TableSchema }
  | {
      type: "update-table";
      table: string;
      schema: TableSchema;
      details: TableUpdateDetails;
    };

export interface SchemaPlan {
  changes: SchemaChange[];
}

export class SchemaDiffer {
  private readonly entityTargets?: Function[];

  constructor(
    private readonly driver: DatabaseDriver,
    entities?: Function[],
  ) {
    this.entityTargets = entities;
  }

  async diff(): Promise<SchemaPlan> {
    const changes: SchemaChange[] = [];
    for (const metadata of this.getEntities()) {
      const desired = buildTableSchema(metadata);
      const current = await this.driver.getSchema(desired.name);
      if (!current) {
        changes.push({
          type: "create-table",
          table: desired.name,
          schema: desired,
        });
        continue;
      }
      const details = diffSchemas(current, desired);
      if (hasUpdates(details)) {
        changes.push({
          type: "update-table",
          table: desired.name,
          schema: desired,
          details,
        });
      }
    }
    return { changes };
  }

  async apply(plan: SchemaPlan): Promise<void> {
    for (const change of plan.changes) {
      await this.driver.ensureTable(change.schema);
    }
  }

  private getEntities(): EntityMetadata[] {
    if (this.entityTargets?.length) {
      return this.entityTargets.map((target) => getEntityMetadata(target));
    }
    return listEntities();
  }
}

const diffSchemas = (
  current: TableSchema,
  desired: TableSchema,
): TableUpdateDetails => {
  const currentColumns = new Map(
    current.columns.map((column) => [column.name, column]),
  );
  const addColumns = desired.columns.filter(
    (column) => !currentColumns.has(column.name),
  );
  const dropColumns = current.columns
    .filter((column) => !desired.columns.some((c) => c.name === column.name))
    .map((column) => column.name);
  const alterColumns: ColumnAlteration[] = desired.columns
    .map((column) => ({ column, previous: currentColumns.get(column.name) }))
    .filter(
      (entry): entry is ColumnAlteration =>
        !!entry.previous &&
        (normalizeType(entry.previous.type) !==
          normalizeType(entry.column.type) ||
          !!entry.previous.nullable !== !!entry.column.nullable ||
          normalizeDefault(entry.previous.default) !==
            normalizeDefault(entry.column.default)),
    );
  const currentUniques = signatureMap(
    current.uniqueConstraints ?? [],
    uniqueSignature,
  );
  const addUniqueConstraints = (desired.uniqueConstraints ?? []).filter(
    (constraint) => !currentUniques.has(uniqueSignature(constraint)),
  );
  const dropUniqueConstraints = (current.uniqueConstraints ?? [])
    .filter(
      (constraint) =>
        !(desired.uniqueConstraints ?? []).some(
          (next) => uniqueSignature(next) === uniqueSignature(constraint),
        ),
    )
    .map((constraint) => constraint.name ?? uniqueSignature(constraint));
  const currentFks = signatureMap(current.foreignKeys ?? [], foreignSignature);
  const addForeignKeys = (desired.foreignKeys ?? []).filter(
    (fk) => !currentFks.has(foreignSignature(fk)),
  );
  const dropForeignKeys = (current.foreignKeys ?? [])
    .filter(
      (fk) =>
        !(desired.foreignKeys ?? []).some(
          (next) => foreignSignature(next) === foreignSignature(fk),
        ),
    )
    .map((fk) => fk.name ?? foreignSignature(fk));
  return {
    addColumns,
    alterColumns,
    dropColumns,
    addUniqueConstraints,
    dropUniqueConstraints,
    addForeignKeys,
    dropForeignKeys,
  } satisfies TableUpdateDetails;
};

const hasUpdates = (details: TableUpdateDetails): boolean => {
  return (
    details.addColumns.length > 0 ||
    details.alterColumns.length > 0 ||
    details.dropColumns.length > 0 ||
    details.addUniqueConstraints.length > 0 ||
    details.dropUniqueConstraints.length > 0 ||
    details.addForeignKeys.length > 0 ||
    details.dropForeignKeys.length > 0
  );
};

const signatureMap = <T>(items: T[], signature: (value: T) => string) => {
  const map = new Map<string, T>();
  items.forEach((item) => map.set(signature(item), item));
  return map;
};

const uniqueSignature = (constraint: UniqueConstraintSchema): string =>
  `${constraint.columns.sort().join("|")}`;

const foreignSignature = (fk: ForeignKeySchema): string =>
  `${fk.columns.sort().join("|")}:${fk.referencedTable}:${fk.referencedColumns.sort().join("|")}`;

const normalizeType = (type?: string) => (type ?? "string").toLowerCase();

const normalizeDefault = (value: unknown): string => {
  if (value === undefined) return "__undefined";
  if (value === null) return "null";
  return String(value);
};
