const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SchemaBuilder,
  MemoryDatabaseDriver,
} = require("@ocd-js/orm");

test("schema builder alterTable supports advanced DDL", async () => {
  const driver = new MemoryDatabaseDriver();
  await driver.init();

  const create = new SchemaBuilder(driver);
  create.createTable("books", (table) => {
    table
      .column("id", "string")
      .column("title", "string", { nullable: false })
      .column("categoryId", "string")
      .primary(["id"], "books_pk")
      .unique(["title"], "books_title_uniq")
      .foreign(["categoryId"], "categories", ["id"], {
        name: "books_category_fk",
        onDelete: "cascade",
      });
  });
  await create.execute();

  const alter = new SchemaBuilder(driver);
  alter.alterTable("books", (table) => {
    table.dropColumn("categoryId");
    table.dropColumn("id");
    table.addColumn("slug", "string", { nullable: false });
    table.alterColumn("title", { nullable: true, default: "untitled" });
    table.dropUnique("books_title_uniq");
    table.unique(["slug"], "books_slug_uniq");
    table.dropForeign("books_category_fk");
    table.foreign(["slug"], "categories", ["slug"], {
      name: "books_slug_fk",
      onDelete: "restrict",
    });
    table.setPrimaryKey(["slug"], "books_slug_pk");
  });
  await alter.execute();

  const schema = await driver.getSchema("books");
  assert.deepEqual(
    schema.columns.map((column) => column.name).sort(),
    ["slug", "title"],
  );
  const titleColumn = schema.columns.find((column) => column.name === "title");
  assert.equal(titleColumn.nullable, true);
  assert.equal(titleColumn.default, "untitled");
  assert.deepEqual(schema.primaryColumns, ["slug"]);
  assert.equal(schema.primaryKeyName, "books_slug_pk");
  assert.equal(schema.uniqueConstraints.length, 1);
  assert.equal(schema.uniqueConstraints[0].name, "books_slug_uniq");
  assert.equal(schema.foreignKeys.length, 1);
  assert.equal(schema.foreignKeys[0].name, "books_slug_fk");
});

test("dropping columns removes dependent constraints automatically", async () => {
  const driver = new MemoryDatabaseDriver();
  await driver.init();

  const create = new SchemaBuilder(driver);
  create.createTable("orders", (table) => {
    table
      .column("id", "string")
      .column("code", "string")
      .column("customerId", "string")
      .primary(["id"], "orders_pk")
      .unique(["code"])
      .foreign(["customerId"], "customers", ["id"], {
        onDelete: "cascade",
      });
  });
  await create.execute();

  const alter = new SchemaBuilder(driver);
  alter.alterTable("orders", (table) => {
    table.dropColumn("customerId");
    table.dropPrimaryKey();
  });
  await alter.execute();

  const schema = await driver.getSchema("orders");
  assert.deepEqual(schema.primaryColumns, []);
  assert.equal(schema.uniqueConstraints.length, 1);
  assert.equal(schema.uniqueConstraints[0].columns[0], "code");
  assert.equal((schema.foreignKeys ?? []).length, 0);
});
