import {
  ColumnOptions,
  EntityCacheOptions,
  registerColumn,
  registerEntity,
  registerUniqueConstraint,
  setEntityCacheOptions,
} from "./metadata";

export const Entity = (options: { table?: string } = {}): ClassDecorator => {
  return (target) => {
    registerEntity(target, options.table);
  };
};

export const Column = (options: ColumnOptions = {}): PropertyDecorator => {
  return (target, propertyKey) => {
    registerColumn(target.constructor, propertyKey.toString(), {
      type:
        options.type ??
        resolveColumnTypeHint(target, propertyKey) ??
        inferTypeFromDesign(target, propertyKey),
      ...options,
    });
  };
};

export const PrimaryColumn = (options: ColumnOptions = {}): PropertyDecorator =>
  Column({ ...options, primary: true });

export const Unique = (columns: string[], name?: string): ClassDecorator => {
  return (target) => registerUniqueConstraint(target, columns, name);
};

export const CacheEntity = (
  options: EntityCacheOptions = {},
): ClassDecorator => {
  return (target) => setEntityCacheOptions(target, options);
};

export { ManyToOne, OneToMany, ManyToMany, OneToOne } from "./relations";

export type { ReferentialAction } from "./metadata";

const columnTypeHints = new WeakMap<
  Function,
  Map<string, ColumnOptions["type"]>
>();

export const ColumnTypeHint = (
  type: ColumnOptions["type"],
): PropertyDecorator => {
  if (!type) {
    throw new Error("ColumnTypeHint decorator requires a type");
  }
  return (target, propertyKey) => {
    const ctor = target.constructor as Function;
    const registry = columnTypeHints.get(ctor) ?? new Map();
    registry.set(propertyKey.toString(), type);
    columnTypeHints.set(ctor, registry);
  };
};

const resolveColumnTypeHint = (target: object, propertyKey: string | symbol) =>
  columnTypeHints
    .get(target.constructor as Function)
    ?.get(propertyKey.toString());

const inferTypeFromDesign = (
  target: object,
  propertyKey: string | symbol,
): ColumnOptions["type"] => {
  const type = getDesignType(target, propertyKey);
  if (!type) {
    return "string";
  }
  if (type === Number) return "number";
  if (type === Boolean) return "boolean";
  if (type === Date) return "date";
  return "string";
};

const getDesignType = (target: object, propertyKey: string | symbol) => {
  const reflect = (globalThis as any).Reflect;
  if (reflect && typeof reflect.getMetadata === "function") {
    return reflect.getMetadata("design:type", target, propertyKey);
  }
  return undefined;
};
