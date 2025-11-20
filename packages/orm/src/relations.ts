import {
  getEntityMetadata,
  registerColumn,
  registerEntity,
  registerForeignKey,
  ReferentialAction,
} from "./metadata";
import { LazyReference } from "./relations/lazy-reference";

export type RelationKind =
  | "many-to-one"
  | "one-to-many"
  | "many-to-many"
  | "one-to-one";

export interface BaseRelationMetadata {
  propertyKey: string;
  kind: RelationKind;
  targetFactory: () => Function;
  inverseSide?: string;
  eager?: boolean;
  lazy?: boolean;
}

export interface ManyToOneRelationMetadata extends BaseRelationMetadata {
  kind: "many-to-one";
  joinColumn: string;
}

export interface OneToManyRelationMetadata extends BaseRelationMetadata {
  kind: "one-to-many";
}

export interface ManyToManyRelationMetadata extends BaseRelationMetadata {
  kind: "many-to-many";
  owner: boolean;
  joinTable: {
    name: string;
    joinColumn: string;
    inverseJoinColumn: string;
  };
}

export interface OneToOneRelationMetadata extends BaseRelationMetadata {
  kind: "one-to-one";
  owner: boolean;
  joinColumn?: string;
}

export type RelationMetadata =
  | ManyToOneRelationMetadata
  | OneToManyRelationMetadata
  | ManyToManyRelationMetadata
  | OneToOneRelationMetadata;

const relationRegistry = new Map<Function, RelationMetadata[]>();

const addRelation = (entity: Function, relation: RelationMetadata) => {
  const list = relationRegistry.get(entity) ?? [];
  relationRegistry.set(entity, [...list, relation]);
};

export const getRelations = (entity: Function): RelationMetadata[] =>
  relationRegistry.get(entity) ?? [];

export const findRelation = (
  entity: Function,
  propertyKey: string,
): RelationMetadata | undefined =>
  getRelations(entity).find((rel) => rel.propertyKey === propertyKey);

interface RelationOptionsBase {
  eager?: boolean;
  lazy?: boolean;
}

interface ManyToOneOptions extends RelationOptionsBase {
  joinColumn?: string;
  unique?: boolean;
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
  constraintName?: string;
  referencedColumns?: string[];
}

export const ManyToOne = (
  targetFactory: () => Function,
  options: ManyToOneOptions = {},
): PropertyDecorator => {
  return (target, propertyKey) => {
    registerEntity(target.constructor);
    const joinColumn = options.joinColumn ?? `${propertyKey.toString()}Id`;
    registerColumn(target.constructor, joinColumn, {
      type: "string",
      nullable: true,
      unique: options.unique,
    });
    defineRelationAccessors(target, propertyKey.toString(), joinColumn);
    addRelation(target.constructor, {
      propertyKey: propertyKey.toString(),
      kind: "many-to-one",
      targetFactory,
      joinColumn,
      eager: options.eager,
      lazy: options.lazy,
    });
    registerForeignKey(target.constructor, {
      columns: [joinColumn],
      referenced: targetFactory,
      referencedColumns: options.referencedColumns,
      name: options.constraintName,
      onDelete: options.onDelete,
      onUpdate: options.onUpdate,
    });
  };
};

export const OneToMany = (
  targetFactory: () => Function,
  inverseSide: string,
  options: RelationOptionsBase = {},
): PropertyDecorator => {
  return (target, propertyKey) => {
    registerEntity(target.constructor);
    addRelation(target.constructor, {
      propertyKey: propertyKey.toString(),
      kind: "one-to-many",
      targetFactory,
      inverseSide,
      lazy: options.lazy,
      eager: options.eager,
    });
  };
};

interface ManyToManyOptions extends RelationOptionsBase {
  joinTable?: {
    name?: string;
    joinColumn?: string;
    inverseJoinColumn?: string;
  };
  inverseSide?: string;
  owner?: boolean;
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
}

export const ManyToMany = (
  targetFactory: () => Function,
  options: ManyToManyOptions = {},
): PropertyDecorator => {
  return (target, propertyKey) => {
    registerEntity(target.constructor);
    const targetMeta = targetFactory();
    const owner = options.owner !== undefined ? options.owner : true;
    const joinTableName =
      options.joinTable?.name ??
      `${target.constructor.name.toLowerCase()}_${propertyKey.toString().toLowerCase()}_${targetMeta.name.toLowerCase()}`;
    const joinColumn =
      options.joinTable?.joinColumn ??
      `${target.constructor.name.toLowerCase()}Id`;
    const inverseJoinColumn =
      options.joinTable?.inverseJoinColumn ??
      `${targetMeta.name.toLowerCase()}Id`;
    addRelation(target.constructor, {
      propertyKey: propertyKey.toString(),
      kind: "many-to-many",
      targetFactory,
      inverseSide: options.inverseSide,
      owner,
      eager: options.eager,
      joinTable: {
        name: joinTableName,
        joinColumn,
        inverseJoinColumn,
      },
      lazy: options.lazy,
    });
  };
};

interface OneToOneOptions extends RelationOptionsBase {
  joinColumn?: string;
  owner?: boolean;
  nullable?: boolean;
  inverseSide?: string;
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
  constraintName?: string;
  referencedColumns?: string[];
}

export const OneToOne = (
  targetFactory: () => Function,
  options: OneToOneOptions = {},
): PropertyDecorator => {
  return (target, propertyKey) => {
    registerEntity(target.constructor);
    const owner = options.owner !== undefined ? options.owner : true;
    const joinColumn = options.joinColumn ?? `${propertyKey.toString()}Id`;
    if (owner) {
      registerColumn(target.constructor, joinColumn, {
        type: "string",
        nullable: options.nullable ?? true,
        unique: true,
      });
      defineRelationAccessors(target, propertyKey.toString(), joinColumn);
      registerForeignKey(target.constructor, {
        columns: [joinColumn],
        referenced: targetFactory,
        referencedColumns: options.referencedColumns,
        name: options.constraintName,
        onDelete: options.onDelete,
        onUpdate: options.onUpdate,
      });
    }
    addRelation(target.constructor, {
      propertyKey: propertyKey.toString(),
      kind: "one-to-one",
      targetFactory,
      inverseSide: options.inverseSide,
      eager: options.eager,
      lazy: options.lazy,
      owner,
      joinColumn: owner ? joinColumn : undefined,
    });
  };
};

const relationStore = new WeakMap<object, Record<string, unknown>>();

const getRelationState = (instance: object) => {
  let state = relationStore.get(instance);
  if (!state) {
    state = {};
    relationStore.set(instance, state);
  }
  return state;
};

const defineRelationAccessors = (
  target: Object,
  propertyKey: string,
  joinColumn: string,
) => {
  const descriptor = Object.getOwnPropertyDescriptor(target, propertyKey);
  if (descriptor && !descriptor.configurable) {
    return;
  }
  Object.defineProperty(target, propertyKey, {
    get() {
      return getRelationState(this)[propertyKey];
    },
    set(value) {
      getRelationState(this)[propertyKey] = value;
      if (value instanceof LazyReference) {
        return;
      }
      if (value) {
        const metadata = getEntityMetadata(value.constructor);
        if (!metadata.primaryColumns.length) {
          throw new Error(
            `Target entity ${metadata.tableName} is missing primary column metadata`,
          );
        }
        if (metadata.primaryColumns.length > 1) {
          throw new Error(
            `Relation ${propertyKey} requires the target to have a single primary column`,
          );
        }
        const primary = metadata.primaryColumns[0];
        (this as any)[joinColumn] = (value as any)[primary.propertyKey];
      } else {
        (this as any)[joinColumn] = undefined;
      }
    },
    enumerable: true,
    configurable: true,
  });
};
