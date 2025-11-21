import { AsyncLocalStorage } from "node:async_hooks";
import {
  DatabaseDriver,
  JsonDatabaseDriver,
  TableSchema,
  TransactionDriver,
} from "./driver";
import { EntityMetadata, getEntityMetadata, listEntities } from "./metadata";
import { Repository } from "./repository";
import { getRelations, ManyToManyRelationMetadata } from "./relations";
import { UnitOfWork } from "./unit-of-work";
import { buildTableSchema } from "./schema/utils";
import { SchemaDiffer, SchemaPlan } from "./schema/differ";
import { IdentityMap } from "./identity-map";
import {
  withSecondLevelCache,
  SecondLevelCacheOptions,
} from "./second-level-cache";
import { emitOrmEvent } from "./events";

export interface ConnectionCacheOptions extends SecondLevelCacheOptions {
  enabled?: boolean;
}

export interface ConnectionOptions {
  driver?: DatabaseDriver;
  cache?: ConnectionCacheOptions;
}

export interface TransactionOptions {
  identityScope?: "shared" | "isolated";
}

export class Connection {
  private readonly driver: DatabaseDriver;
  private readonly transactionContext =
    new AsyncLocalStorage<TransactionState>();
  private readonly identityMap = new IdentityMap();

  constructor(options: ConnectionOptions = {}) {
    const baseDriver = options.driver ?? new JsonDatabaseDriver();
    const { enabled = true, ...cacheOptions } = options.cache ?? {};
    this.driver = enabled
      ? withSecondLevelCache(baseDriver, cacheOptions)
      : baseDriver;
  }

  async initialize(): Promise<void> {
    await this.driver.init();
    for (const entityMetadata of listEntities()) {
      await this.driver.ensureTable(buildTableSchema(entityMetadata));
    }
    await this.ensureJoinTables();
  }
  async previewSchemaChanges(): Promise<SchemaPlan> {
    const differ = new SchemaDiffer(this.driver);
    return differ.diff();
  }

  async synchronizeSchema(): Promise<SchemaPlan> {
    const differ = new SchemaDiffer(this.driver);
    const plan = await differ.diff();
    await differ.apply(plan);
    return plan;
  }

  getRepository<T extends object>(entity: new () => T): Repository<T> {
    const active = this.transactionContext.getStore();
    const driver = active?.driver ?? this.driver;
    const identityMap = active?.identityMap ?? this.identityMap;
    return this.createRepository(entity, driver, identityMap);
  }

  getDriver(): DatabaseDriver {
    return this.driver;
  }

  async beginUnitOfWork(): Promise<UnitOfWork> {
    const tx = await this.driver.beginTransaction();
    const identityMap = new IdentityMap();
    const manager = this.buildEntityManager(tx, identityMap);
    return new UnitOfWork(tx, (entity) => manager.getRepository(entity), {
      onCommit: async () => {
        this.identityMap.adoptFrom(identityMap);
        await emitOrmEvent("afterCommit", {
          connection: this,
          scope: "unitOfWork",
        });
      },
    });
  }

  async transaction<R>(
    handler: (manager: EntityManager) => Promise<R> | R,
    options: TransactionOptions = {},
  ): Promise<R> {
    const active = this.transactionContext.getStore();
    if (active) {
      return this.runNestedTransaction(active, handler, options);
    }
    return this.runRootTransaction(handler);
  }

  private async runNestedTransaction<R>(
    state: TransactionState,
    handler: (manager: EntityManager) => Promise<R> | R,
    options: TransactionOptions,
  ): Promise<R> {
    const driver = state.driver;
    const identityScope = options.identityScope ?? "shared";
    if (
      driver.createSavepoint &&
      driver.releaseSavepoint &&
      driver.rollbackToSavepoint
    ) {
      state.savepointCounter += 1;
      const savepoint = `sp_${state.savepointCounter}`;
      await driver.createSavepoint(savepoint);
      const identityMap =
        identityScope === "isolated" ? new IdentityMap() : state.identityMap;
      const manager =
        identityScope === "isolated"
          ? this.buildEntityManager(driver, identityMap)
          : state.manager;
      const nestedState: TransactionState = {
        driver,
        manager,
        savepointCounter: state.savepointCounter,
        identityMap,
      };
      try {
        const result = await this.transactionContext.run(
          nestedState,
          async () => handler(manager),
        );
        await driver.releaseSavepoint(savepoint);
        if (identityScope === "isolated") {
          state.identityMap.adoptFrom(identityMap);
        }
        return result;
      } catch (error) {
        await driver.rollbackToSavepoint(savepoint);
        throw error;
      }
    }
    return handler(state.manager);
  }

  private async ensureJoinTables(): Promise<void> {
    const ensured = new Set<string>();
    for (const metadata of listEntities()) {
      const relations = getRelations(metadata.target);
      for (const relation of relations) {
        if (relation.kind !== "many-to-many" || !relation.owner) {
          continue;
        }
        if (ensured.has(relation.joinTable.name)) continue;
        const schema = this.createJoinTableSchema(metadata, relation);
        await this.driver.ensureTable(schema);
        ensured.add(relation.joinTable.name);
      }
    }
  }

  private createJoinTableSchema(
    source: EntityMetadata,
    relation: ManyToManyRelationMetadata,
  ): TableSchema {
    const target = getEntityMetadata(relation.targetFactory());
    if (
      source.primaryColumns.length !== 1 ||
      target.primaryColumns.length !== 1
    ) {
      throw new Error(
        `ManyToMany ${relation.propertyKey} requires both ${source.tableName} and ${target.tableName} to have a single primary column`,
      );
    }
    const sourcePrimary = source.primaryColumns[0];
    const targetPrimary = target.primaryColumns[0];
    return {
      name: relation.joinTable.name,
      columns: [
        {
          name: relation.joinTable.joinColumn,
          type: sourcePrimary.options.type ?? "string",
          nullable: false,
        },
        {
          name: relation.joinTable.inverseJoinColumn,
          type: targetPrimary.options.type ?? "string",
          nullable: false,
        },
      ],
      primaryColumns: [
        relation.joinTable.joinColumn,
        relation.joinTable.inverseJoinColumn,
      ],
      primaryKeyName: `${relation.joinTable.name}_pk`,
      foreignKeys: [
        {
          name: `${relation.joinTable.name}_${relation.joinTable.joinColumn}_fk`,
          columns: [relation.joinTable.joinColumn],
          referencedTable: source.tableName,
          referencedColumns: [sourcePrimary.propertyKey],
          onDelete: "cascade",
          onUpdate: "cascade",
        },
        {
          name: `${relation.joinTable.name}_${relation.joinTable.inverseJoinColumn}_fk`,
          columns: [relation.joinTable.inverseJoinColumn],
          referencedTable: target.tableName,
          referencedColumns: [targetPrimary.propertyKey],
          onDelete: "cascade",
          onUpdate: "cascade",
        },
      ],
    };
  }

  private createRepository<T extends object>(
    entity: new () => T,
    driver: DatabaseDriver | TransactionDriver,
    identityMap: IdentityMap = this.identityMap,
  ): Repository<T> {
    const metadata = getEntityMetadata(entity);
    return new Repository<T>(
      metadata,
      driver,
      (next) => this.createRepository(next, driver, identityMap),
      identityMap,
    );
  }

  private buildEntityManager(
    driver: DatabaseDriver | TransactionDriver,
    identityMap: IdentityMap,
  ): EntityManager {
    return new EntityManager(
      (entity) => this.createRepository(entity, driver, identityMap),
      driver,
    );
  }

  private async runRootTransaction<R>(
    handler: (manager: EntityManager) => Promise<R> | R,
  ): Promise<R> {
    const tx = await this.driver.beginTransaction();
    const identityMap = new IdentityMap();
    const manager = this.buildEntityManager(tx, identityMap);
    const state: TransactionState = {
      driver: tx,
      manager,
      savepointCounter: 0,
      identityMap,
    };
    return this.transactionContext.run(state, async () => {
      try {
        const result = await handler(manager);
        await tx.commit();
        this.identityMap.adoptFrom(identityMap);
        await emitOrmEvent("afterCommit", {
          connection: this,
          scope: "transaction",
        });
        return result;
      } catch (error) {
        await tx.rollback();
        throw error;
      }
    });
  }
}

export class EntityManager {
  constructor(
    private readonly resolver: <T extends object>(
      entity: new () => T,
    ) => Repository<T>,
    private readonly driver: DatabaseDriver | TransactionDriver,
  ) {}

  getRepository<T extends object>(entity: new () => T): Repository<T> {
    return this.resolver(entity);
  }

  getDriver(): DatabaseDriver | TransactionDriver {
    return this.driver;
  }
}

interface TransactionState {
  driver: TransactionDriver;
  manager: EntityManager;
  savepointCounter: number;
  identityMap: IdentityMap;
}
