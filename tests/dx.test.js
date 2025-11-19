const { test } = require("node:test");
const assert = require("node:assert");

const { withUnitTest, applyMocks } = require("../packages/testing/dist");
const { analyzeWorkspace } = require("../packages/tooling/dist");
const core = require("../packages/core/dist");

class DemoService {
  constructor(config) {
    this.config = config;
  }

  value() {
    return this.config.message;
  }
}

core.Injectable()(DemoService);
core.Inject("CONFIG_TOKEN")(DemoService, undefined, 0);

class DemoModule {}

core.Module({
  providers: [
    { token: "CONFIG_TOKEN", useValue: { message: "hello" } },
    DemoService,
  ],
})(DemoModule);

test("testing harness applies mocks", async () => {
  await withUnitTest(DemoModule, (app) => {
    applyMocks(app, [{ token: "CONFIG_TOKEN", useValue: { message: "mock" } }]);
    const service = app.context.container.resolve(DemoService);
    assert.strictEqual(service.value(), "mock");
  });
});

test("upgrade assistant detects outdated packages", () => {
  const report = analyzeWorkspace();
  assert.ok(Array.isArray(report.entries));
  const coreEntry = report.entries.find((entry) => entry.name === "@ocd-js/core");
  assert.ok(coreEntry);
  assert.ok(coreEntry.recommended);
});
