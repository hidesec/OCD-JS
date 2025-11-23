const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");

const runOracleTests = process.env.OCD_JS_ORACLE_TEST === "true";

if (runOracleTests) {
  describe("Oracle Driver", async () => {
    let OracleDatabaseDriver;
    let Connection;
    let Entity;
    let Column;
    let PrimaryColumn;
    let driver;
    let connection;

    before(async () => {
      const orm = await import("../packages/orm/dist/index.js");
      OracleDatabaseDriver = orm.OracleDatabaseDriver;
      Connection = orm.Connection;
      Entity = orm.Entity;
      Column = orm.Column;
      PrimaryColumn = orm.PrimaryColumn;

      driver = new OracleDatabaseDriver({
        user: process.env.ORACLE_USER || "system",
        password: process.env.ORACLE_PASSWORD || "oracle",
        connectString:
          process.env.ORACLE_CONNECT_STRING || "localhost:1521/FREE",
      });

      await driver.init();
    });

    after(async () => {
      if (connection) {
        await connection.close();
      }
    });

    it("should connect to Oracle database", async () => {
      assert.ok(driver, "Driver should be initialized");
    });

    it("should create a table", async () => {
      const schema = {
        name: "test_users",
        columns: [
          { name: "id", type: "string", nullable: false },
          { name: "name", type: "string", nullable: true },
          { name: "age", type: "number", nullable: true },
          { name: "active", type: "boolean", nullable: true },
          { name: "created_at", type: "date", nullable: true },
        ],
        primaryColumns: ["id"],
      };

      await driver.ensureTable(schema);
      const retrievedSchema = await driver.getSchema("test_users");
      assert.ok(retrievedSchema, "Schema should be retrieved");
      assert.strictEqual(retrievedSchema.name, "test_users");
    });

    it("should insert and read records", async () => {
      const records = [
        {
          id: "user1",
          name: "John Doe",
          age: 30,
          active: true,
          created_at: new Date("2024-01-01"),
        },
        {
          id: "user2",
          name: "Jane Smith",
          age: 25,
          active: false,
          created_at: new Date("2024-01-02"),
        },
      ];

      await driver.writeTable("test_users", records);
      const readRecords = await driver.readTable("test_users");

      assert.strictEqual(readRecords.length, 2);
      assert.strictEqual(readRecords[0].name, "John Doe");
      assert.strictEqual(readRecords[1].name, "Jane Smith");
    });

    it("should handle transactions", async () => {
      const tx = await driver.beginTransaction();

      try {
        const records = [
          {
            id: "user3",
            name: "Bob Wilson",
            age: 35,
            active: true,
            created_at: new Date(),
          },
        ];

        await tx.writeTable("test_users", records);
        await tx.commit();

        const allRecords = await driver.readTable("test_users");
        assert.ok(
          allRecords.find((r) => r.id === "user3"),
          "Transaction should commit successfully",
        );
      } catch (error) {
        await tx.rollback();
        throw error;
      }
    });

    it("should support savepoints", async () => {
      const tx = await driver.beginTransaction();

      try {
        await tx.createSavepoint("sp1");

        const records = [
          {
            id: "user4",
            name: "Alice Brown",
            age: 28,
            active: true,
            created_at: new Date(),
          },
        ];
        await tx.writeTable("test_users", records);

        await tx.rollbackToSavepoint("sp1");
        await tx.commit();

        const allRecords = await driver.readTable("test_users");
        assert.ok(
          !allRecords.find((r) => r.id === "user4"),
          "Savepoint rollback should work",
        );
      } catch (error) {
        await tx.rollback();
        throw error;
      }
    });

    it("should drop table", async () => {
      await driver.dropTable("test_users");
      const schema = await driver.getSchema("test_users");
      assert.strictEqual(schema, undefined, "Table should be dropped");
    });

    it("should work with ORM Connection", async () => {
      connection = new Connection({ driver });
      await connection.initialize();

      class TestEntity {
        constructor() {
          this.id = "";
          this.email = "";
          this.count = 0;
        }
      }

      Entity({ table: "test_entities" })(TestEntity);
      PrimaryColumn({ type: "string" })(TestEntity.prototype, "id");
      Column({ type: "string" })(TestEntity.prototype, "email");
      Column({ type: "number" })(TestEntity.prototype, "count");

      const repo = connection.getRepository(TestEntity);
      const entity = repo.create({
        id: "test1",
        email: "test@oracle.com",
        count: 42,
      });

      await repo.save(entity);
      const found = await repo.findOne({ where: { id: "test1" } });

      assert.ok(found, "Entity should be found");
      assert.strictEqual(found.email, "test@oracle.com");
      assert.strictEqual(found.count, 42);

      await driver.dropTable("test_entities");
    });
  });
} else {
  describe("Oracle Driver (skipped)", () => {
    it("skipped - set OCD_JS_ORACLE_TEST=true to enable", () => {
      console.log(
        "Oracle tests skipped. Set OCD_JS_ORACLE_TEST=true and configure connection to run.",
      );
    });
  });
}
