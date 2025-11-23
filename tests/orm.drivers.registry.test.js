const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createRegisteredDriver,
  PostgresDatabaseDriver,
  MySqlDatabaseDriver,
} = require("@ocd-js/orm");

test("postgres driver is registered by name", async () => {
  const driver = createRegisteredDriver("postgres", { host: "localhost" });
  assert.ok(driver instanceof PostgresDatabaseDriver);
});

test("mysql driver is registered by name", async () => {
  const driver = createRegisteredDriver("mysql", { host: "localhost" });
  assert.ok(driver instanceof MySqlDatabaseDriver);
});
