import { DatabaseDriver } from "./driver";
import { ColumnMetadata, EntityMetadata, getEntityMetadata } from "./metadata";
import { In, QueryBuilder, QueryOptions } from "./query-builder";
import {
  findRelation,
  getRelations,
  ManyToManyRelationMetadata,
  ManyToOneRelationMetadata,
  OneToManyRelationMetadata,
  OneToOneRelationMetadata,
  RelationMetadata,
} from "./relations";
import { LazyReference } from "./relations/lazy-reference";
import {
  EntityChangeSet,
  HookContextInput,
  HookType,
  runEntityHooks,
} from "./entity-hooks";
import { IdentityMap } from "./identity-map";
import { emitOrmEvent } from "./events";

export class Repository<T extends object> {
  constructor(
    private readonly metadata: EntityMetadata,
    private readonly driver: DatabaseDriver,
    private readonly resolveRelated: <U extends object>(
      entity: new () => U,
    ) => Repository<U>,
    private readonly identityMap?: IdentityMap,
  ) {}

  create(initial: Partial<T> = {}): T {
    const instance = Object.assign(
      new (this.metadata.target as new () => T)(),
      initial,
    );
    this.initializeLazyRelations(instance as T);
    if (!this.identityMap) {
      return instance;
    }
    return this.identityMap.trackNew(this.metadata, instance);
  }

  async save(entity: T): Promise<T> {
    const rows = await this.driver.readTable<any>(this.metadata.tableName);
    const primaryColumns = this.getPrimaryColumns();
    let plain = this.toPlain(entity);
    this.ensurePrimaryValues(plain, primaryColumns);
    let index = rows.findIndex((row) =>
      primaryColumns.every(
        (column) => row[column.propertyKey] === plain[column.propertyKey],
      ),
    );
    const isUpdate = index >= 0;
    const previousRow = isUpdate ? { ...rows[index] } : undefined;

    const invokeHooks = async (type: HookType) => {
      const snapshot = this.toPlain(entity);
      await runEntityHooks(
        entity,
        type,
        this.buildHookOptions(previousRow, snapshot, !isUpdate),
      );
    };

    if (isUpdate) {
      await invokeHooks("beforeUpdate");
    } else {
      await invokeHooks("beforeInsert");
    }
    await invokeHooks("validate");

    plain = this.toPlain(entity);
    this.ensurePrimaryValues(plain, primaryColumns);
    index = rows.findIndex((row) =>
      primaryColumns.every(
        (column) => row[column.propertyKey] === plain[column.propertyKey],
      ),
    );
    if (index >= 0) {
      rows[index] = plain;
    } else {
      rows.push(plain);
    }
    await this.driver.writeTable(this.metadata.tableName, rows);
    await this.syncManyToManyRelations(entity, plain);
    this.identityMap?.updateAfterPersist(this.metadata, entity, plain);
    if (this.identityMap) {
      this.resetLazyRelations(entity);
    }
    return this.materialize(plain);
  }

  async delete(criteria: Partial<T>): Promise<void> {
    const rows = await this.driver.readTable<any>(this.metadata.tableName);
    const removed = rows.filter((row) => matches(row, criteria));
    for (const row of removed) {
      const entity = this.materialize(row);
      await runEntityHooks(
        entity,
        "beforeRemove",
        this.buildHookOptions(row, undefined, false),
      );
      this.identityMap?.evict(entity);
    }
    const filtered = rows.filter((row) => !matches(row, criteria));
    await this.driver.writeTable(this.metadata.tableName, filtered);
  }

  async find(options?: QueryOptions<T>): Promise<T[]> {
    return this.queryBuilder().setOptions(options).getMany();
  }

  async findOne(options?: QueryOptions<T>): Promise<T | null> {
    return this.queryBuilder().setOptions(options).getOne();
  }

  queryBuilder(): QueryBuilder<T> {
    const hasEagerRelations = getRelations(this.metadata.target).some(
      (relation) => relation.eager,
    );
    return new QueryBuilder<T>(
      this.metadata,
      this.driver,
      (entities, relations) => this.populateRelations(entities, relations),
      { hasEagerRelations, rowFactory: (row) => this.materialize(row) },
    );
  }

  private toPlain(entity: T): Record<string, unknown> {
    return this.metadata.columns.reduce(
      (acc, column) => {
        acc[column.propertyKey] = (entity as any)[column.propertyKey];
        return acc;
      },
      {} as Record<string, unknown>,
    );
  }

  private materialize(row: Record<string, unknown>): T {
    let entity: T;
    if (this.identityMap) {
      entity = this.identityMap.hydrate(
        this.metadata,
        row,
        () => this.instantiate(row),
        (entity) => this.initializeLazyRelations(entity),
      );
    } else {
      entity = this.instantiate(row);
    }
    void emitOrmEvent("afterLoad", {
      entity,
      metadata: this.metadata,
    });
    return entity;
  }

  private instantiate(row: Record<string, unknown>): T {
    const instance = this.metadata.columns.reduce(
      (acc, column) => {
        (acc as any)[column.propertyKey] = row[column.propertyKey];
        return acc;
      },
      new (this.metadata.target as new () => T)(),
    );
    this.initializeLazyRelations(instance as T);
    return instance;
  }

  private initializeLazyRelations(entity: T): void {
    this.initializeLazyRelationsInternal(entity, false);
  }

  private resetLazyRelations(entity: T): void {
    this.initializeLazyRelationsInternal(entity, true);
  }

  private initializeLazyRelationsInternal(entity: T, force: boolean): void {
    const relations = getRelations(this.metadata.target);
    relations.forEach((relation) => {
      if (!relation.lazy) return;
      if (!force && (entity as any)[relation.propertyKey] !== undefined) {
        return;
      }
      const reference = this.createLazyReference(entity, relation);
      if (reference) {
        (entity as any)[relation.propertyKey] = reference;
      }
    });
  }

  private createLazyReference(
    entity: T,
    relation: RelationMetadata,
  ): LazyReference<any> | undefined {
    switch (relation.kind) {
      case "many-to-one": {
        const rel = relation as ManyToOneRelationMetadata;
        return new LazyReference(async () => {
          await this.loadManyToOne([entity], rel, []);
          return (entity as any)[rel.propertyKey] ?? null;
        });
      }
      case "one-to-one": {
        const rel = relation as OneToOneRelationMetadata;
        return new LazyReference(async () => {
          await this.loadOneToOne([entity], rel, []);
          return (entity as any)[rel.propertyKey] ?? null;
        });
      }
      case "one-to-many": {
        const rel = relation as OneToManyRelationMetadata;
        return new LazyReference(async () => {
          await this.loadOneToMany([entity], rel, []);
          return (entity as any)[rel.propertyKey] ?? [];
        });
      }
      case "many-to-many": {
        const rel = relation as ManyToManyRelationMetadata;
        return new LazyReference(async () => {
          await this.loadManyToMany([entity], rel, []);
          return (entity as any)[rel.propertyKey] ?? [];
        });
      }
      default:
        return undefined;
    }
  }

  private getPrimaryColumns(): ColumnMetadata[] {
    if (!this.metadata.primaryColumns.length) {
      throw new Error(`Primary column missing for ${this.metadata.tableName}`);
    }
    return this.metadata.primaryColumns;
  }

  private ensurePrimaryValues(
    plain: Record<string, unknown>,
    primaryColumns: ColumnMetadata[],
  ) {
    if (primaryColumns.length === 1) {
      const [column] = primaryColumns;
      if (
        plain[column.propertyKey] === undefined ||
        plain[column.propertyKey] === null
      ) {
        plain[column.propertyKey] = this.generateId();
      }
      return;
    }
    const missing = primaryColumns.filter((column) => {
      const value = plain[column.propertyKey];
      return value === undefined || value === null;
    });
    if (missing.length) {
      throw new Error(
        `Composite primary keys require explicit values for ${missing
          .map((column) => column.propertyKey)
          .join(", ")}`,
      );
    }
  }

  private generateId(): string {
    const counter = (idCounters.get(this.metadata.tableName) ?? 0) + 1;
    idCounters.set(this.metadata.tableName, counter);
    return `${this.metadata.tableName}_${Date.now().toString(36)}_${counter}`;
  }

  private async populateRelations(
    entities: T[],
    relations: string[],
  ): Promise<T[]> {
    if (!entities.length) return entities;
    const eager = getRelations(this.metadata.target)
      .filter((relation) => relation.eager)
      .map((relation) => relation.propertyKey);
    const normalized = new Set(relations ?? []);
    eager.forEach((path) => normalized.add(path));
    const grouped = groupRelations(Array.from(normalized));
    for (const [property, nested] of grouped.entries()) {
      const relation = findRelation(this.metadata.target, property);
      if (!relation) continue;
      if (relation.kind === "many-to-one") {
        await this.loadManyToOne(entities, relation, nested);
      } else if (relation.kind === "one-to-many") {
        await this.loadOneToMany(entities, relation, nested);
      } else if (relation.kind === "many-to-many") {
        await this.loadManyToMany(entities, relation, nested);
      } else if (relation.kind === "one-to-one") {
        await this.loadOneToOne(entities, relation, nested);
      }
    }
    return entities;
  }

  private async loadManyToOne(
    entities: T[],
    relation: ManyToOneRelationMetadata,
    nested: string[],
  ) {
    const foreignKey = relation.joinColumn ?? `${relation.propertyKey}Id`;
    const ids = Array.from(
      new Set(
        entities
          .map((entity: any) => entity[foreignKey])
          .filter((value) => value !== undefined && value !== null),
      ),
    );
    if (!ids.length) {
      entities.forEach((entity: any) => {
        entity[relation.propertyKey] = entity[relation.propertyKey] ?? null;
      });
      return;
    }
    const target = relation.targetFactory() as new () => any;
    const repo = this.resolveRelated(target);
    const targetMetadata = getEntityMetadata(target);
    if (targetMetadata.primaryColumns.length !== 1) {
      throw new Error(
        `ManyToOne ${relation.propertyKey} requires the target to have a single primary column`,
      );
    }
    const primary = targetMetadata.primaryColumns[0];
    const related = await repo.find({
      where: {
        [primary.propertyKey]: In(ids),
      } as any,
      relations: nested,
    });
    const map = new Map(
      related.map((item: any) => [item[primary.propertyKey], item]),
    );
    entities.forEach((entity: any) => {
      const fk = entity[foreignKey];
      entity[relation.propertyKey] = fk ? (map.get(fk) ?? null) : null;
    });
  }

  private async loadManyToMany(
    entities: T[],
    relation: ManyToManyRelationMetadata,
    nested: string[],
  ) {
    const primaryColumns = this.getPrimaryColumns();
    if (primaryColumns.length !== 1) {
      throw new Error(
        `ManyToMany ${relation.propertyKey} requires the owner to have a single primary column`,
      );
    }
    const ownerPrimary = primaryColumns[0];
    const ownerIds = entities
      .map((entity: any) => entity[ownerPrimary.propertyKey])
      .filter((value) => value !== undefined && value !== null);
    if (!ownerIds.length) {
      entities.forEach((entity: any) => {
        entity[relation.propertyKey] = [];
      });
      return;
    }
    const joinRows = await this.driver.readTable<any>(relation.joinTable.name);
    const filteredRows = joinRows.filter((row) =>
      ownerIds.includes(row[relation.joinTable.joinColumn]),
    );
    if (!filteredRows.length) {
      entities.forEach((entity: any) => {
        entity[relation.propertyKey] = [];
      });
      return;
    }
    const target = relation.targetFactory() as new () => any;
    const repo = this.resolveRelated(target);
    const targetMetadata = getEntityMetadata(target);
    if (targetMetadata.primaryColumns.length !== 1) {
      throw new Error(
        `ManyToMany ${relation.propertyKey} requires the target to have a single primary column`,
      );
    }
    const targetPrimary = targetMetadata.primaryColumns[0];
    const targetIds = Array.from(
      new Set(
        filteredRows.map((row) => row[relation.joinTable.inverseJoinColumn]),
      ),
    );
    const related = await repo.find({
      where: {
        [targetPrimary.propertyKey]: In(targetIds),
      } as any,
      relations: nested,
    });
    const relatedMap = new Map(
      related.map((item: any) => [item[targetPrimary.propertyKey], item]),
    );
    entities.forEach((entity: any) => {
      const ownerId = entity[ownerPrimary.propertyKey];
      const rows = filteredRows.filter(
        (row) => row[relation.joinTable.joinColumn] === ownerId,
      );
      entity[relation.propertyKey] = rows
        .map((row) => relatedMap.get(row[relation.joinTable.inverseJoinColumn]))
        .filter(Boolean);
    });
  }

  private async syncManyToManyRelations(
    entity: T,
    plain: Record<string, unknown>,
  ) {
    const relations = getRelations(this.metadata.target).filter(
      (relation) => relation.kind === "many-to-many" && relation.owner,
    ) as ManyToManyRelationMetadata[];
    if (!relations.length) return;
    const primaryColumns = this.getPrimaryColumns();
    if (primaryColumns.length !== 1) {
      throw new Error(
        `Many-to-many synchronization requires a single-column primary key for ${this.metadata.tableName}`,
      );
    }
    const primary = primaryColumns[0];
    const ownerId = plain[primary.propertyKey];
    for (const relation of relations) {
      const value = (entity as any)[relation.propertyKey];
      if (value === undefined || value instanceof LazyReference) continue;
      await this.persistManyToManyRelation(ownerId, value, relation);
    }
  }

  private async persistManyToManyRelation(
    ownerId: unknown,
    value: any,
    relation: ManyToManyRelationMetadata,
  ) {
    if (ownerId === undefined || ownerId === null) {
      return;
    }
    const rows = await this.driver.readTable<any>(relation.joinTable.name);
    const remaining = rows.filter(
      (row) => row[relation.joinTable.joinColumn] !== ownerId,
    );
    if (!Array.isArray(value)) {
      await this.driver.writeTable(relation.joinTable.name, remaining);
      return;
    }
    const target = relation.targetFactory() as new () => any;
    const targetMetadata = getEntityMetadata(target);
    if (targetMetadata.primaryColumns.length !== 1) {
      throw new Error(
        `ManyToMany ${relation.propertyKey} requires the target to have a single primary column`,
      );
    }
    const targetPrimary = targetMetadata.primaryColumns[0];
    const nextRows = value
      .map((item: any) =>
        typeof item === "object" ? item[targetPrimary.propertyKey] : item,
      )
      .filter((id: unknown) => id !== undefined && id !== null)
      .map((id: unknown) => ({
        [relation.joinTable.joinColumn]: ownerId,
        [relation.joinTable.inverseJoinColumn]: id,
      }));
    await this.driver.writeTable(relation.joinTable.name, [
      ...remaining,
      ...nextRows,
    ]);
  }

  private buildHookOptions(
    before: Record<string, unknown> | undefined,
    after: Record<string, unknown> | undefined,
    isNew: boolean,
  ): HookContextInput<T> {
    return {
      metadata: this.metadata,
      driver: this.driver,
      changeSet: this.buildChangeSet(before, after),
      isNew,
    };
  }

  private buildChangeSet(
    before?: Record<string, unknown>,
    after?: Record<string, unknown>,
  ): EntityChangeSet<T> | undefined {
    if (!before && !after) {
      return undefined;
    }
    const keys = new Set<string>();
    this.metadata.columns.forEach((column) => keys.add(column.propertyKey));
    Object.keys(before ?? {}).forEach((key) => keys.add(key));
    Object.keys(after ?? {}).forEach((key) => keys.add(key));
    const changedFields = Array.from(keys).filter((key) => {
      const prev = before ? before[key] : undefined;
      const next = after ? after[key] : undefined;
      return prev !== next;
    });
    return {
      before: before ? ({ ...before } as Partial<T>) : undefined,
      after: after ? ({ ...after } as Partial<T>) : undefined,
      changedFields,
    };
  }
  private async loadOneToMany(
    entities: T[],
    relation: OneToManyRelationMetadata,
    nested: string[],
  ) {
    const target = relation.targetFactory() as new () => any;
    const repo = this.resolveRelated(target);
    const primaryColumns = this.getPrimaryColumns();
    if (primaryColumns.length !== 1) {
      throw new Error(
        `OneToMany ${relation.propertyKey} requires the owner to have a single primary column`,
      );
    }
    const ownerPrimary = primaryColumns[0];
    const ownerIds = entities
      .map((entity: any) => entity[ownerPrimary.propertyKey])
      .filter((value) => value !== undefined && value !== null);
    if (!ownerIds.length) {
      entities.forEach((entity: any) => {
        entity[relation.propertyKey] = [];
      });
      return;
    }
    const inverse = findRelation(target, relation.inverseSide ?? "");
    const joinColumn =
      inverse && inverse.kind === "many-to-one"
        ? inverse.joinColumn
        : `${relation.inverseSide}Id`;
    const children = await repo.find({
      where: {
        [joinColumn]: In(ownerIds),
      } as any,
      relations: nested,
    });
    const groupedChildren = children.reduce((acc, child: any) => {
      const ownerId = child[joinColumn];
      if (!acc.has(ownerId)) acc.set(ownerId, [] as any[]);
      acc.get(ownerId)!.push(child);
      return acc;
    }, new Map<any, any[]>());
    entities.forEach((entity: any) => {
      const key = entity[ownerPrimary.propertyKey];
      entity[relation.propertyKey] = groupedChildren.get(key) ?? [];
    });
  }

  private async loadOneToOne(
    entities: T[],
    relation: OneToOneRelationMetadata,
    nested: string[],
  ) {
    const target = relation.targetFactory() as new () => any;
    const repo = this.resolveRelated(target);
    const targetMetadata = getEntityMetadata(target);
    if (targetMetadata.primaryColumns.length !== 1) {
      throw new Error(
        `OneToOne ${relation.propertyKey} requires the target to have a single primary column`,
      );
    }
    const targetPrimary = targetMetadata.primaryColumns[0];
    if (relation.owner && relation.joinColumn) {
      const foreignKey = relation.joinColumn;
      const ids = Array.from(
        new Set(
          entities
            .map((entity: any) => entity[foreignKey])
            .filter((value) => value !== undefined && value !== null),
        ),
      );
      if (!ids.length) {
        entities.forEach((entity: any) => {
          entity[relation.propertyKey] = entity[relation.propertyKey] ?? null;
        });
        return;
      }
      const related = await repo.find({
        where: {
          [targetPrimary.propertyKey]: In(ids),
        } as any,
        relations: nested,
      });
      const map = new Map(
        related.map((item: any) => [item[targetPrimary.propertyKey], item]),
      );
      entities.forEach((entity: any) => {
        const fk = entity[foreignKey];
        entity[relation.propertyKey] = fk ? (map.get(fk) ?? null) : null;
      });
      return;
    }
    const ownerRelation = relation.inverseSide
      ? findRelation(target, relation.inverseSide)
      : undefined;
    if (
      !ownerRelation ||
      ownerRelation.kind !== "one-to-one" ||
      !ownerRelation.joinColumn
    ) {
      throw new Error(
        `Inverse one-to-one ${relation.propertyKey} missing owning side metadata`,
      );
    }
    const ownerPrimaryColumns = this.getPrimaryColumns();
    if (ownerPrimaryColumns.length !== 1) {
      throw new Error(
        `OneToOne ${relation.propertyKey} requires the source to have a single primary column`,
      );
    }
    const sourcePrimary = ownerPrimaryColumns[0];
    const ownerIds = entities
      .map((entity: any) => entity[sourcePrimary.propertyKey])
      .filter((value) => value !== undefined && value !== null);
    if (!ownerIds.length) {
      entities.forEach((entity: any) => {
        entity[relation.propertyKey] = null;
      });
      return;
    }
    const related = await repo.find({
      where: {
        [ownerRelation.joinColumn]: In(ownerIds),
      } as any,
      relations: nested,
    });
    const map = new Map(
      related.map((item: any) => [item[ownerRelation.joinColumn!], item]),
    );
    entities.forEach((entity: any) => {
      const id = entity[sourcePrimary.propertyKey];
      entity[relation.propertyKey] = map.get(id) ?? null;
    });
  }
}

const matches = <T extends object>(row: any, criteria: Partial<T>): boolean => {
  return Object.entries(criteria).every(([key, value]) => {
    if (value === undefined) return true;
    return row[key] === value;
  });
};

const idCounters = new Map<string, number>();

const groupRelations = (paths: string[]): Map<string, string[]> => {
  const map = new Map<string, string[]>();
  for (const path of paths) {
    const [root, ...rest] = path.split(".");
    const remainder = rest.join(".");
    const list = map.get(root) ?? [];
    if (remainder) {
      list.push(remainder);
    }
    map.set(root, list);
  }
  return map;
};
