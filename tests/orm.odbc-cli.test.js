const test = require("node:test");
const assert = require("node:assert/strict");

const {
  OdbcCliDatabaseDriver,
  createRegisteredDriver,
} = require("@ocd-js/orm");

test("odbc-cli driver is registered and exposes last query info", async () => {
  // via standalone-drivers.ts the driver name "odbc-cli" should be registered
  const driver = createRegisteredDriver("odbc-cli", { dsn: "MyDSN" });
  assert.ok(driver instanceof OdbcCliDatabaseDriver);
  // avoid actually spawning CLI by stubbing private method
  driver.executeCli = async () => ({ stdout: "", stderr: "", code: 0 });
  await driver.init();
  const rows = await driver.readTable("any_table");
  assert.ok(Array.isArray(rows));
  const last = driver.__lastQueryInfo;
  assert.ok(last && typeof last.sql === "string");
});

test("odbc-cli parses pipe-delimited output", async () => {
  const driver = createRegisteredDriver("odbc-cli", { dsn: "MyDSN" });
  driver.executeCli = async () => ({
    stdout: "id | name\n1 | Alice\n2 | Bob\n",
    stderr: "",
    code: 0,
  });
  await driver.init();
  const rows = await driver.readTable("people");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, "1");
  assert.equal(rows[0].name, "Alice");
});

test("odbc-cli parses tab-delimited output", async () => {
  const driver = createRegisteredDriver("odbc-cli", { dsn: "MyDSN" });
  driver.executeCli = async () => ({
    stdout: "id\tname\n3\tCarol\n4\tDave\n",
    stderr: "",
    code: 0,
  });
  await driver.init();
  const rows = await driver.readTable("people");
  assert.equal(rows.length, 2);
  assert.equal(rows[1].id, "4");
  assert.equal(rows[1].name, "Dave");
});

test("odbc-cli parses ascii table output", async () => {
  const driver = createRegisteredDriver("odbc-cli", { dsn: "MyDSN" });
  driver.executeCli = async () => ({
    stdout: "+----+-------+\n| id | name  |\n+----+-------+\n| 5  | Erin  |\n| 6  | Frank |\n+----+-------+\n",
    stderr: "",
    code: 0,
  });
  await driver.init();
  const rows = await driver.readTable("people");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "Erin");
});
