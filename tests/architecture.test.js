const { test } = require("node:test");
const assert = require("node:assert");
const core = require("../packages/core/dist");

const CONFIG_TOKEN = Symbol("CONFIG_TOKEN");

class SampleService {
  constructor(config) {
    this.config = config;
  }

  list() {
    return [this.config.greeting];
  }
}

core.Inject(CONFIG_TOKEN)(SampleService, undefined, 0);
core.Injectable()(SampleService);

class SampleController {
  constructor(service) {
    this.service = service;
  }

  list() {
    return this.service.list();
  }
}

core.Inject(SampleService)(SampleController, undefined, 0);
core.Controller({ basePath: "/sample" })(SampleController);
const listDescriptor = Object.getOwnPropertyDescriptor(SampleController.prototype, "list");
core.Get("/")(SampleController.prototype, "list", listDescriptor);

class SampleModule {}
core.Module({
  controllers: [SampleController],
  providers: [
    { token: CONFIG_TOKEN, useValue: { greeting: "hello" } },
    SampleService,
  ],
})(SampleModule);

test("module wiring exposes routes and resolves controller", () => {
  const context = core.createApplicationContext(SampleModule);
  assert.ok(Array.isArray(context.routes));
  const route = context.routes.find((entry) => entry.path === "/sample/");
  assert.ok(route, "sample route should exist");

  const request = context.beginRequest();
  const controller = request.container.resolve(SampleController);
  const result = controller.list();
  assert.deepStrictEqual(result, ["hello"]);
});
