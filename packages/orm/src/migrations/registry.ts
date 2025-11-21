import type { MigrationDefinition, SeederDefinition } from "./types";

const migrationRegistry: MigrationDefinition[] = [];
const seederRegistry: SeederDefinition[] = [];

export const registerMigration = (definition: MigrationDefinition): void => {
  if (migrationRegistry.some((entry) => entry.id === definition.id)) {
    throw new Error(`Migration with id ${definition.id} already registered`);
  }
  migrationRegistry.push(definition);
};

export const registerSeeder = (definition: SeederDefinition): void => {
  if (seederRegistry.some((entry) => entry.id === definition.id)) {
    throw new Error(`Seeder with id ${definition.id} already registered`);
  }
  seederRegistry.push(definition);
};

export const listMigrations = (): MigrationDefinition[] =>
  migrationRegistry.slice();

export const listSeeders = (): SeederDefinition[] => seederRegistry.slice();

export const resetMigrations = (): void => {
  migrationRegistry.splice(0, migrationRegistry.length);
};

export const resetSeeders = (): void => {
  seederRegistry.splice(0, seederRegistry.length);
};
