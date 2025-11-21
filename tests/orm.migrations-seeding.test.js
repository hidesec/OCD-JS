const test = require("node:test");
const assert = require("node:assert/strict");

const {
  Entity,
  Column,
  PrimaryColumn,
  Connection,
  MemoryDatabaseDriver,
  Migration,
  MigrationRunner,
  SeedRunner,
  Seeder,
  resetMigrations,
  resetSeeders,
} = require("@ocd-js/orm");

test("migration and seed runners execute registered classes", async () => {
  resetMigrations();
  resetSeeders();

  class SeedUser {}
  Entity({ table: "seed_users" })(SeedUser);
  PrimaryColumn({ type: "string" })(SeedUser.prototype, "id");
  Column({ type: "string" })(SeedUser.prototype, "email");
  Column({ type: "string" })(SeedUser.prototype, "status");

  class SeedUsersTable {
    async up({ schema }) {
      schema.createTable("seed_users", (table) => {
        table.column("id", "string", { nullable: false });
        table.column("email", "string", { nullable: false });
        table.column("status", "string", { nullable: false });
        table.primary(["id"], "seed_users_pk");
        table.unique(["email"], "seed_users_email_unique");
      });
    }

    async down({ schema }) {
      schema.dropTable("seed_users");
    }
  }
  Migration({ id: "2024112101_seed_users" })(SeedUsersTable);

  class CoreUserSeed {
    async run(ctx) {
      await ctx.truncate(SeedUser);
      await ctx.insert(SeedUser, [
        { id: "seed-basic", email: "seed@demo.test", status: "active" },
        { id: "seed-pro", email: "seed+pro@demo.test", status: "vip" },
      ]);
    }
  }
  Seeder({ id: "seed-core-users", transactional: true })(CoreUserSeed);

  const driver = new MemoryDatabaseDriver();
  const migrationRunner = new MigrationRunner(driver);
  await migrationRunner.run("up");

  const connection = new Connection({ driver });
  await connection.initialize();

  const seedRunner = new SeedRunner(connection);
  await seedRunner.run();

  const repo = connection.getRepository(SeedUser);
  const seeded = await repo
    .queryBuilder()
    .orderBy("email", "asc")
    .getMany();

  assert.equal(seeded.length, 2);
  const statuses = seeded.map((user) => user.status).sort();
  assert.deepEqual(statuses, ["active", "vip"]);

  await migrationRunner.run("down");
  const schema = await driver.getSchema("seed_users");
  assert.equal(schema, undefined);
});
