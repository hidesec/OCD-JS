const { test } = require("node:test");
const assert = require("node:assert");

const { withUnitTest, applyMocks } = require("../packages/testing/dist");
const { analyzeWorkspace } = require("../packages/tooling/dist");
const core = require("../packages/core/dist");

class WorkspaceService {
  constructor(config) {
    this.config = config;
  }

  value() {
    return this.config.message;
  }
}

core.Injectable()(WorkspaceService);
core.Inject("CONFIG_TOKEN")(WorkspaceService, undefined, 0);

class WorkspaceModule {}

core.Module({
  providers: [
    { token: "CONFIG_TOKEN", useValue: { message: "hello" } },
    WorkspaceService,
  ],
})(WorkspaceModule);

test("testing harness applies mocks", async () => {
  await withUnitTest(WorkspaceModule, (app) => {
    applyMocks(app, [{ token: "CONFIG_TOKEN", useValue: { message: "mock" } }]);
    const service = app.context.container.resolve(WorkspaceService);
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
