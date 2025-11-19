const { test } = require("node:test");
const assert = require("node:assert");

const {
  PolicyService,
  ReleaseChecklist,
  OWASP_TOP10_BUNDLE,
} = require("../packages/governance/dist");
const { FeatureFlagService } = require("../packages/feature-flags/dist");
const core = require("../packages/core/dist");
const { generateApiDocs, renderPluginGuidelines } = require("../packages/tooling/dist");

test("policy service reports failures", async () => {
  const service = new PolicyService();
  const bundle = {
    ...OWASP_TOP10_BUNDLE,
    rules: [
      { id: "A01", description: "pass", check: () => true },
      { id: "A02", description: "fail", check: () => false },
    ],
  };
  const result = await service.evaluate(bundle);
  assert.strictEqual(result.passed, false);
  assert.deepStrictEqual(result.failures, ["A02"]);
});

test("release checklist aggregates items", async () => {
  const checklist = new ReleaseChecklist([
    { id: "tests", description: "tests", verify: () => true },
    { id: "docs", description: "docs", verify: () => false },
  ]);
  const results = await checklist.run();
  assert.deepStrictEqual(results, [
    { id: "tests", passed: true },
    { id: "docs", passed: false },
  ]);
});

test("feature flag service toggles flags", () => {
  const service = new FeatureFlagService({ beta: true });
  assert.ok(service.isEnabled("beta"));
  service.setFlag("beta", false);
  assert.strictEqual(service.isEnabled("beta"), false);
});

test("api docs generator exports routes", () => {
  class DocsController {
    list() {
      return [];
    }
  }
  core.Controller({ basePath: "/docs", version: "v1" })(DocsController);
  core.Get("/")(
    DocsController.prototype,
    "list",
    Object.getOwnPropertyDescriptor(DocsController.prototype, "list"),
  );

  class DocsModule {}
  core.Module({ controllers: [DocsController] })(DocsModule);

  const context = core.createApplicationContext(DocsModule);
  const docs = generateApiDocs(context);
  assert.ok(docs.routes.length >= 1);
  const guidelines = renderPluginGuidelines();
  assert.ok(guidelines.includes("semantic versioning"));
});
