const test = require("node:test");
const assert = require("node:assert/strict");

const { MySqlDatabaseDriver, MemoryDatabaseDriver } = require("@ocd-js/orm");

const shouldUseReal = /^(true|1)$/i.test(
  (process.env.OCD_JS_MYSQL_TEST ?? "").trim(),
);

test("mysql driver integration", async () => {
  if (!shouldUseReal) {
    const fallback = new MemoryDatabaseDriver();
    await fallback.init();
    await fallback.ensureTable({
      name: "mysql_users",
      columns: [
        { name: "id", type: "string", nullable: false },
        { name: "email", type: "string" },
      ],
      primaryColumns: ["id"],
    });
    await fallback.writeTable("mysql_users", [
      { id: "mysql-1", email: "memory@ocd.dev" },
    ]);
    const rows = await fallback.readTable("mysql_users");
    assert.equal(rows.length, 1);
    return;
  }

  const driver = new MySqlDatabaseDriver({
    host: process.env.OCD_JS_MYSQL_HOST,
    port: process.env.OCD_JS_MYSQL_PORT
      ? Number(process.env.OCD_JS_MYSQL_PORT)
      : undefined,
    user: process.env.OCD_JS_MYSQL_USER ?? "root",
    password: process.env.OCD_JS_MYSQL_PASSWORD ?? "root",
    database: process.env.OCD_JS_MYSQL_DATABASE ?? "ocd_js",
  });
  await driver.init();
  await driver.ensureTable({
    name: "mysql_users",
    columns: [
      { name: "id", type: "string", nullable: false },
      { name: "email", type: "string" },
    ],
    primaryColumns: ["id"],
  });
  await driver.writeTable("mysql_users", [
    { id: "mysql-1", email: "driver@ocd.dev" },
  ]);
  const rows = await driver.readTable("mysql_users");
  assert.equal(rows.length > 0, true);
  await driver.dropTable("mysql_users");
});
