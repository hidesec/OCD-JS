import { DatabaseDriver, TableSchema } from "./driver";
import { SchemaBuilder } from "./schema/builder";

export interface MigrationContext {
  driver: DatabaseDriver;
  createTable(schema: TableSchema): Promise<void>;
  dropTable(name: string): Promise<void>;
  schema: SchemaBuilder;
}

export interface MigrationDefinition {
  id: string;
  up(context: MigrationContext): Promise<void> | void;
  down?(context: MigrationContext): Promise<void> | void;
}

const migrations: MigrationDefinition[] = [];

type MigrationClass = new () => {
  up: MigrationDefinition["up"];
  down?: MigrationDefinition["down"];
};

export const Migration = (options: { id: string }): ClassDecorator => {
  return (target) => {
    const ctor = target as unknown as MigrationClass;
    const instance = new ctor();
    migrations.push({
      id: options.id,
      up: instance.up.bind(instance),
      down: instance.down?.bind(instance),
    });
  };
};

export class MigrationRunner {
  constructor(private readonly driver: DatabaseDriver) {}

  async run(direction: "up" | "down" = "up"): Promise<void> {
    await this.driver.init();
    const history = await this.driver.readTable<{ id: string }>("__migrations");
    const executed = new Set(history.map((record) => record.id));
    const sorted = [...migrations].sort((a, b) => a.id.localeCompare(b.id));
    if (direction === "up") {
      for (const migration of sorted) {
        if (executed.has(migration.id)) continue;
        const context = this.createContext();
        await migration.up(context);
        await context.schema.execute();
        history.push({ id: migration.id });
        await this.driver.writeTable("__migrations", history);
      }
    } else {
      for (const migration of [...sorted].reverse()) {
        if (!executed.has(migration.id)) continue;
        const context = this.createContext();
        await migration.down?.(context);
        await context.schema.execute();
        const idx = history.findIndex((record) => record.id === migration.id);
        if (idx >= 0) {
          history.splice(idx, 1);
          await this.driver.writeTable("__migrations", history);
        }
      }
    }
  }

  private createContext(): MigrationContext {
    const schema = new SchemaBuilder(this.driver);
    return {
      driver: this.driver,
      createTable: async (schema) => {
        await this.driver.ensureTable(schema);
      },
      dropTable: async (name) => {
        await this.driver.dropTable(name);
      },
      schema,
    };
  }
}

export const listMigrations = () => migrations.slice();
