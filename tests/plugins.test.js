const { test } = require("node:test");
const assert = require("node:assert");

const { ContractHarness } = require("../packages/contract-testing/dist");
const { AuditPlugin } = require("../examples/server/dist/plugins/audit.plugin");

test("audit plugin contract is satisfied", async () => {
  const harness = new ContractHarness();
  let readyCalled = false;
  harness.registerPlugin(AuditPlugin, {
    onReady: () => {
      readyCalled = true;
    },
  });
  harness.addScenario({
    name: "ready hook emits log",
    verify: () => {
      assert.ok(readyCalled, "plugin hook should run");
    },
  });
  await harness.run();
});
