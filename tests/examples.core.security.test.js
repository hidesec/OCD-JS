const test = require("node:test");
const assert = require("node:assert/strict");
const { createApplicationContext } = require("@ocd-js/core");
const { resolveSecurityTokens } = require("@ocd-js/security");
const { POLICY_SERVICE } = require("@ocd-js/governance");

const {
  AppModule,
} = require("../examples/core/dist/app.module.js");
const {
  ProjectController,
} = require("../examples/core/dist/app.controller.js");
const {
  ProjectService,
} = require("../examples/core/dist/project.service.js");

test("core example routes apply baseline security middlewares", () => {
  const app = createApplicationContext(AppModule);
  const createRoute = app.routes.find(
    (route) =>
      route.controller === ProjectController && route.handlerKey === "create",
  );
  assert.ok(createRoute, "create route metadata missing");
  const tokens = resolveSecurityTokens(createRoute.enhancers);
  const middlewareNames = tokens.map((token) =>
    typeof token === "function" ? token.name : String(token),
  );
  [
    "AdaptiveRateLimiter",
    "InputSanitizer",
    "CorsGuard",
    "CsrfProtector",
    "AuditLogger",
  ].forEach((expected) => {
    assert.ok(
      middlewareNames.includes(expected),
      `missing security middleware ${expected}`,
    );
  });
});

test("core example enforces governance policies before writes", async () => {
  const app = createApplicationContext(AppModule);
  const policyCalls = [];
  const policyStub = {
    async evaluate(bundle) {
      policyCalls.push(bundle.name);
      return { bundle: bundle.name, passed: true, failures: [] };
    },
  };
  const request = app.beginRequest([
    { token: POLICY_SERVICE, useValue: policyStub, scope: "request" },
  ]);
  const service = request.container.resolve(ProjectService);
  const record = await service.createProject(
    { name: "Secure Alpha", owner: "platform" },
    { id: "req-sec", user: { id: "lead" } },
  );
  assert.equal(record.name, "Secure Alpha");
  assert.deepEqual(policyCalls, ["owasp-top10"]);
});
