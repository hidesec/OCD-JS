import {
  ForeignKeySchema,
  TableSchema,
  UniqueConstraintSchema,
} from "../driver";
import { EntityMetadata, getEntityMetadata } from "../metadata";

const ensureColumnsExist = (
  metadata: EntityMetadata,
  columns: string[],
): string[] => {
  const known = new Set(metadata.columns.map((column) => column.propertyKey));
  columns.forEach((column) => {
    if (!known.has(column)) {
      throw new Error(
        `Column "${column}" is not defined on entity ${metadata.tableName}`,
      );
    }
  });
  return columns;
};

const toUniqueConstraints = (
  metadata: EntityMetadata,
): UniqueConstraintSchema[] =>
  metadata.uniqueConstraints.map((constraint, index) => ({
    name:
      constraint.name ??
      `${metadata.tableName}_uniq_${constraint.columns.join("_")}_${index}`,
    columns: ensureColumnsExist(metadata, constraint.columns),
  }));

const toForeignKeys = (metadata: EntityMetadata): ForeignKeySchema[] =>
  metadata.foreignKeys.map((fk, index) => {
    const target = getEntityMetadata(fk.referenced());
    const referencedColumns = fk.referencedColumns?.length
      ? fk.referencedColumns
      : target.primaryColumns.map((column) => column.propertyKey);
    if (!referencedColumns.length) {
      throw new Error(
        `Foreign key declared on ${metadata.tableName} but target ${target.tableName} has no primary columns`,
      );
    }
    return {
      name:
        fk.name ?? `${metadata.tableName}_fk_${fk.columns.join("_")}_${index}`,
      columns: ensureColumnsExist(metadata, fk.columns),
      referencedTable: target.tableName,
      referencedColumns,
      onDelete: fk.onDelete,
      onUpdate: fk.onUpdate,
    } satisfies ForeignKeySchema;
  });

export const buildTableSchema = (metadata: EntityMetadata): TableSchema => ({
  name: metadata.tableName,
  columns: metadata.columns.map((column) => ({
    name: column.propertyKey,
    type: column.options.type ?? "string",
    nullable: column.options.nullable,
    default: column.options.default,
  })),
  primaryColumns: metadata.primaryColumns.map((column) => column.propertyKey),
  primaryKeyName: `${metadata.tableName}_pk`,
  uniqueConstraints: toUniqueConstraints(metadata),
  foreignKeys: toForeignKeys(metadata),
});
