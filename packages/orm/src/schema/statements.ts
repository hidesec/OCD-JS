import { ColumnSchema, ForeignKeySchema, TableSchema } from "../driver";
import { SchemaPlan, SchemaChange, TableUpdateDetails } from "./differ";

export type SqlDialect = "sqlite" | "postgres" | "mysql";

export interface SchemaStatementsOptions {
  dialect: SqlDialect;
}

export const generateSchemaStatements = (
  plan: SchemaPlan,
  options: SchemaStatementsOptions,
): string[] => {
  const dialect = options.dialect;
  return plan.changes.flatMap((change) =>
    generateStatementsForChange(change, dialect),
  );
};

const generateStatementsForChange = (
  change: SchemaChange,
  dialect: SqlDialect,
): string[] => {
  if (change.type === "create-table") {
    return [createTableStatement(change.schema, dialect)];
  }
  return buildUpdateStatements(
    change.table,
    change.schema,
    change.details,
    dialect,
  );
};

const createTableStatement = (schema: TableSchema, dialect: SqlDialect) => {
  const columns = schema.columns
    .map((column) => columnDefinition(column, dialect))
    .join(",\n  ");
  const constraints: string[] = [];
  if (schema.primaryColumns?.length) {
    constraints.push(
      `PRIMARY KEY (${schema.primaryColumns
        .map((col) => quoteIdent(col, dialect))
        .join(", ")})`,
    );
  }
  (schema.uniqueConstraints ?? []).forEach((constraint) =>
    constraints.push(
      `CONSTRAINT ${quoteIdent(constraint.name ?? uniqueName(schema, constraint.columns), dialect)} UNIQUE (${constraint.columns
        .map((col) => quoteIdent(col, dialect))
        .join(", ")})`,
    ),
  );
  (schema.foreignKeys ?? []).forEach((fk) =>
    constraints.push(
      `CONSTRAINT ${quoteIdent(fk.name ?? foreignName(schema, fk.columns), dialect)} ${foreignKeyClause(fk, dialect)}`,
    ),
  );
  const all = [columns, ...constraints].filter(Boolean).join(",\n  ");
  return `CREATE TABLE IF NOT EXISTS ${quoteIdent(schema.name, dialect)} (\n  ${all}\n);`;
};

const buildUpdateStatements = (
  table: string,
  schema: TableSchema,
  details: TableUpdateDetails,
  dialect: SqlDialect,
): string[] => {
  const statements: string[] = [];
  details.addColumns.forEach((column) => {
    statements.push(
      `ALTER TABLE ${quoteIdent(table, dialect)} ADD COLUMN ${columnDefinition(column, dialect)};`,
    );
  });
  details.dropColumns.forEach((column) => {
    if (dialect === "sqlite") {
      statements.push(
        `-- SQLite requires table rebuild to drop column ${column} on ${table}`,
      );
    } else {
      statements.push(
        `ALTER TABLE ${quoteIdent(table, dialect)} DROP COLUMN ${quoteIdent(column, dialect)};`,
      );
    }
  });
  details.alterColumns.forEach(({ column }) => {
    if (dialect === "sqlite") {
      statements.push(
        `-- SQLite requires table rebuild to alter column ${column.name} on ${table}`,
      );
    } else if (dialect === "postgres") {
      statements.push(
        `ALTER TABLE ${quoteIdent(table, dialect)} ALTER COLUMN ${quoteIdent(column.name, dialect)} TYPE ${sqlType(column.type, dialect)};`,
      );
      if (column.nullable === false) {
        statements.push(
          `ALTER TABLE ${quoteIdent(table, dialect)} ALTER COLUMN ${quoteIdent(column.name, dialect)} SET NOT NULL;`,
        );
      } else {
        statements.push(
          `ALTER TABLE ${quoteIdent(table, dialect)} ALTER COLUMN ${quoteIdent(column.name, dialect)} DROP NOT NULL;`,
        );
      }
    } else {
      statements.push(
        `ALTER TABLE ${quoteIdent(table, dialect)} MODIFY ${columnDefinition(column, dialect)};`,
      );
    }
  });
  details.addUniqueConstraints.forEach((constraint) => {
    const name = constraint.name ?? uniqueName(schema, constraint.columns);
    if (dialect === "sqlite") {
      statements.push(
        `CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIdent(name, dialect)} ON ${quoteIdent(table, dialect)} (${constraint.columns
          .map((col) => quoteIdent(col, dialect))
          .join(", ")});`,
      );
    } else {
      statements.push(
        `ALTER TABLE ${quoteIdent(table, dialect)} ADD CONSTRAINT ${quoteIdent(name, dialect)} UNIQUE (${constraint.columns
          .map((col) => quoteIdent(col, dialect))
          .join(", ")});`,
      );
    }
  });
  details.dropUniqueConstraints.forEach((name) => {
    if (dialect === "sqlite") {
      statements.push(`DROP INDEX IF EXISTS ${quoteIdent(name, dialect)};`);
    } else {
      statements.push(
        `ALTER TABLE ${quoteIdent(table, dialect)} DROP CONSTRAINT ${quoteIdent(name, dialect)};`,
      );
    }
  });
  details.addForeignKeys.forEach((fk) => {
    const name = fk.name ?? foreignName(schema, fk.columns);
    statements.push(
      `ALTER TABLE ${quoteIdent(table, dialect)} ADD CONSTRAINT ${quoteIdent(name, dialect)} ${foreignKeyClause(fk, dialect)};`,
    );
  });
  details.dropForeignKeys.forEach((name) => {
    if (dialect === "sqlite") {
      statements.push(
        `-- SQLite requires table rebuild to drop foreign key constraint ${name} on ${table}`,
      );
    } else {
      statements.push(
        `ALTER TABLE ${quoteIdent(table, dialect)} DROP CONSTRAINT ${quoteIdent(name, dialect)};`,
      );
    }
  });
  return statements;
};

const columnDefinition = (
  column: ColumnSchema,
  dialect: SqlDialect,
): string => {
  const nullable = column.nullable === false ? " NOT NULL" : "";
  const defaultValue =
    column.default !== undefined
      ? ` DEFAULT ${formatDefault(column.default)}`
      : "";
  return `${quoteIdent(column.name, dialect)} ${sqlType(column.type, dialect)}${nullable}${defaultValue}`;
};

const sqlType = (type: string | undefined, dialect: SqlDialect): string => {
  switch ((type ?? "string").toLowerCase()) {
    case "number":
      return dialect === "postgres" ? "DOUBLE PRECISION" : "DOUBLE";
    case "boolean":
      return dialect === "mysql" ? "TINYINT(1)" : "BOOLEAN";
    case "date":
      return dialect === "postgres" ? "TIMESTAMPTZ" : "DATETIME";
    case "json":
      if (dialect === "postgres") return "JSONB";
      if (dialect === "mysql") return "JSON";
      return "TEXT";
    default:
      return "TEXT";
  }
};

const foreignKeyClause = (
  fk: ForeignKeySchema,
  dialect: SqlDialect,
): string => {
  const base = `FOREIGN KEY (${fk.columns
    .map((col) => quoteIdent(col, dialect))
    .join(
      ", ",
    )}) REFERENCES ${quoteIdent(fk.referencedTable, dialect)} (${fk.referencedColumns
    .map((col) => quoteIdent(col, dialect))
    .join(", ")})`;
  const onDelete = fk.onDelete ? ` ON DELETE ${fk.onDelete.toUpperCase()}` : "";
  const onUpdate = fk.onUpdate ? ` ON UPDATE ${fk.onUpdate.toUpperCase()}` : "";
  return `${base}${onDelete}${onUpdate}`.trim();
};

const quoteIdent = (identifier: string, dialect: SqlDialect) => {
  if (dialect === "mysql") {
    return `\`${identifier.replace(/`/g, "``")}\``;
  }
  return `"${identifier.replace(/"/g, '""')}"`;
};

const uniqueName = (schema: TableSchema, columns: string[]) =>
  `${schema.name}_${columns.join("_")}_uniq`;

const foreignName = (schema: TableSchema, columns: string[]) =>
  `${schema.name}_${columns.join("_")}_fk`;

const formatDefault = (value: unknown): string => {
  if (value === null) return "NULL";
  if (typeof value === "number") return value.toString();
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${String(value).replace(/'/g, "''")}'`;
};
