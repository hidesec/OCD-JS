import type { MigrationContext, SeederOptions } from "./types";
import { registerMigration, registerSeeder } from "./registry";

type MigrationClass = new () => {
  up: (context: MigrationContext) => Promise<void> | void;
  down?: (context: MigrationContext) => Promise<void> | void;
};

type SeederClass = new () => {
  run: (...args: any[]) => Promise<void> | void;
};

export const Migration = (options: { id: string }): ClassDecorator => {
  return (target) => {
    const ctor = target as unknown as MigrationClass;
    const instance = new ctor();
    registerMigration({
      id: options.id,
      up: instance.up.bind(instance),
      down: instance.down?.bind(instance),
    });
  };
};

export const Seeder = (options: SeederOptions): ClassDecorator => {
  return (target) => {
    const ctor = target as unknown as SeederClass;
    const instance = new ctor();
    registerSeeder({
      id: options.id,
      handler: instance.run.bind(instance),
      dependsOn: options.dependsOn ?? [],
      tags: options.tags ?? [],
      transactional: options.transactional ?? true,
    });
  };
};
