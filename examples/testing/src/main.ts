import { applyMocks, withIntegrationTest, withUnitTest } from "@ocd-js/testing";
import {
  PIPELINE_MANAGER,
  AsyncPipeline,
  Cached,
  CacheManager,
} from "@ocd-js/performance";
import { AppModule } from "./app.module";
import { AppService } from "./app.service";
import { AppController } from "./app.controller";
import { APP_MESSAGE } from "./tokens";

async function runUnitScenario() {
  await withUnitTest(AppModule, async (app) => {
    const service = app.context.container.resolve(AppService);
    console.log("unit: default message", service.getMessage());
  });

  await withUnitTest(AppModule, async (app) => {
    applyMocks(app, [{ token: APP_MESSAGE, useValue: "Mocked greeting" }]);
    const service = app.context.container.resolve(AppService);
    console.log("unit: mocked message", service.getMessage());
  });
}

async function runIntegrationScenario() {
  await withIntegrationTest(AppModule, async (request) => {
    const controller = request.resolve(AppController);
    console.log("integration: users", controller.users());
    console.log("integration: message", controller.message());
    const cachedService = new CachedCalculationService(new CacheManager());
    const first = await cachedService.expensive();
    const second = await cachedService.expensive();
    console.log("integration: cached calculation stable", first === second);
    const pipeline = request.container.resolve(
      PIPELINE_MANAGER,
    ) as AsyncPipeline;
    const result = await pipeline
      .use(async (ctx) => {
        ctx.events = [...(ctx.events ?? []), "sanitize"];
        ctx.payload = ctx.payload.trim();
        return ctx;
      })
      .use(async (ctx) => {
        ctx.events.push("uppercase");
        ctx.payload = ctx.payload.toUpperCase();
        return ctx;
      })
      .run({ payload: " sample payload ", events: [] });
    console.log("integration: pipeline result", result);
  });
}

runUnitScenario()
  .then(runIntegrationScenario)
  .catch((error) => {
    console.error("Testing scenarios failed", error);
    process.exit(1);
  });
