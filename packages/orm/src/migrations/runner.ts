import type { Connection, EntityManager } from "../connection";
import {
  type DatabaseDriver,
  type QueryCapableDriver,
  type TransactionDriver,
} from "../driver";
import { executePlan } from "../query/plan-executor";
import { getEntityMetadata } from "../metadata";
import type { Repository } from "../repository";
import { SchemaBuilder } from "../schema/builder";
import type { QueryPlan } from "../query/criteria";
import { listMigrations, listSeeders } from "./registry";
import type {
  Constructor,
  MigrationContext,
  SeedContext,
  SeederDefinition,
} from "./types";

export class MigrationRunner {
  constructor(private readonly driver: DatabaseDriver) {}

  async run(direction: "up" | "down" = "up"): Promise<void> {
    await this.driver.init();
    await this.ensureHistoryTable();
    const history = await this.driver.readTable<{ id: string }>("__migrations");
    const executed = new Set(history.map((record) => record.id));
    const migrations = listMigrations().sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    if (direction === "up") {
      for (const migration of migrations) {
        if (executed.has(migration.id)) continue;
        const context = this.createContext();
        await migration.up(context);
        await context.schema.execute();
        history.push({ id: migration.id });
        await this.driver.writeTable("__migrations", history);
      }
      return;
    }
    for (const migration of [...migrations].reverse()) {
      if (!executed.has(migration.id)) continue;
      const context = this.createContext();
      await migration.down?.(context);
      await context.schema.execute();
      const index = history.findIndex((record) => record.id === migration.id);
      if (index >= 0) {
        history.splice(index, 1);
        await this.driver.writeTable("__migrations", history);
      }
    }
  }

  private async ensureHistoryTable(): Promise<void> {
    await this.driver.ensureTable({
      name: "__migrations",
      columns: [{ name: "id", type: "string", nullable: false }],
      primaryColumns: ["id"],
    });
  }

  private createContext(): MigrationContext {
    const schema = new SchemaBuilder(this.driver);
    return {
      driver: this.driver,
      createTable: (definition) => this.driver.ensureTable(definition),
      dropTable: (name) => this.driver.dropTable(name),
      schema,
    };
  }
}

export interface SeedRunnerOptions {
  tags?: string[];
  only?: string[];
}

export class SeedRunner {
  constructor(private readonly connection: Connection) {}

  async run(options: SeedRunnerOptions = {}): Promise<void> {
    const seeders = resolveSeedExecutionOrder(listSeeders(), options);
    if (!seeders.length) {
      return;
    }
    for (const seeder of seeders) {
      if (seeder.transactional) {
        await this.connection.transaction(async (manager) => {
          const ctx = this.createSeedContext(
            manager,
            manager.getDriver?.() ?? this.connection.getDriver(),
          );
          await seeder.handler(ctx);
        });
      } else {
        const ctx = this.createSeedContext(
          undefined,
          this.connection.getDriver(),
        );
        await seeder.handler(ctx);
      }
    }
  }

  private createSeedContext(
    manager: EntityManager | undefined,
    driver: DatabaseDriver | TransactionDriver,
  ): SeedContext {
    const repoFactory = manager
      ? (entity: Constructor) => manager.getRepository(entity)
      : (entity: Constructor) => this.connection.getRepository(entity);
    return {
      connection: this.connection,
      driver,
      manager,
      getRepository: repoFactory,
      truncate: (target) => this.truncateTarget(target, driver),
      insert: (entity, values) =>
        this.insertEntities(repoFactory(entity), values),
      insertTable: (table, rows) => driver.writeTable(table, rows),
      rawQuery: (plan) => this.executeRawQuery(driver, plan),
    };
  }

  private async truncateTarget(
    target: Constructor | string,
    driver: DatabaseDriver | TransactionDriver,
  ): Promise<void> {
    if (typeof target === "string") {
      await driver.writeTable(target, []);
      return;
    }
    const metadata = getEntityMetadata(target);
    await driver.writeTable(metadata.tableName, []);
  }

  private async insertEntities<T extends object>(
    repository: Repository<T>,
    values: Array<Partial<T>> | Partial<T>,
  ): Promise<T[]> {
    const list = Array.isArray(values) ? values : [values];
    const saved: T[] = [];
    for (const entry of list) {
      const entity = repository.create(entry);
      saved.push(await repository.save(entity));
    }
    return saved;
  }

  private async executeRawQuery<T>(
    driver: DatabaseDriver | TransactionDriver,
    plan: QueryPlan,
  ): Promise<T[]> {
    const candidate = driver as QueryCapableDriver;
    if (typeof candidate.executeQuery === "function") {
      if (candidate.supportsQuery && candidate.supportsQuery(plan) === false) {
        const fallbackRows = await driver.readTable<Record<string, unknown>>(
          plan.table,
        );
        return executePlan(fallbackRows, plan) as T[];
      }
      const rows = await candidate.executeQuery(plan);
      return rows as T[];
    }
    const rows = await driver.readTable<Record<string, unknown>>(plan.table);
    return executePlan(rows, plan) as T[];
  }
}

const resolveSeedExecutionOrder = (
  seeders: SeederDefinition[],
  options: SeedRunnerOptions,
): SeederDefinition[] => {
  const filtered = seeders.filter((seeder) => {
    if (options.only?.length && !options.only.includes(seeder.id)) {
      return false;
    }
    if (options.tags?.length) {
      return seeder.tags.some((tag) => options.tags!.includes(tag));
    }
    return true;
  });
  const map = new Map(filtered.map((entry) => [entry.id, entry]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const ordered: SeederDefinition[] = [];

  const visit = (seeder: SeederDefinition) => {
    if (visited.has(seeder.id)) return;
    if (visiting.has(seeder.id)) {
      throw new Error(`Circular seeder dependency detected for ${seeder.id}`);
    }
    visiting.add(seeder.id);
    for (const dependency of seeder.dependsOn) {
      const target = map.get(dependency);
      if (target) {
        visit(target);
      }
    }
    visiting.delete(seeder.id);
    visited.add(seeder.id);
    ordered.push(seeder);
  };

  filtered.forEach(visit);
  return ordered;
};
