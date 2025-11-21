import { applyMocks, withIntegrationTest, withUnitTest } from "@ocd-js/testing";
import {
  PIPELINE_MANAGER,
  AsyncPipeline,
  Cached,
  CacheManager,
  PipelineContext,
} from "@ocd-js/performance";
import { AppModule } from "./app.module";
import { AppService } from "./app.service";
import { AppController } from "./app.controller";
import { APP_MESSAGE } from "./tokens";

interface MessagePipelineState {
  payload: string;
  events: string[];
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class CachedCalculationService {
  public readonly cache: CacheManager;
  private executions = 0;

  constructor(cacheManager?: CacheManager) {
    this.cache = cacheManager ?? new CacheManager();
  }

  @Cached({
    key: (..._args: unknown[]) => "calc:expensive",
    ttlMs: 500,
    tags: (_result: unknown) => ["calc"],
  })
  async expensive(): Promise<number> {
    this.executions += 1;
    await delay(10);
    return this.executions;
  }
}

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
    const controller = request.container.resolve(AppController);
    console.log("integration: users", controller.users());
    console.log("integration: message", controller.message());
    const cachedService = new CachedCalculationService(new CacheManager());
    const first = await cachedService.expensive();
    const second = await cachedService.expensive();
    console.log("integration: cached calculation stable", first === second);
    const pipeline = request.container.resolve(
      PIPELINE_MANAGER,
    ) as AsyncPipeline;
    const result = (await pipeline
      .use({
        name: "SanitizePayload",
        async execute(
          state: MessagePipelineState,
          _context: PipelineContext,
        ): Promise<MessagePipelineState> {
          return {
            payload: state.payload.trim(),
            events: [...state.events, "sanitize"],
          };
        },
      })
      .use({
        name: "UppercasePayload",
        async execute(
          state: MessagePipelineState,
          _context: PipelineContext,
        ): Promise<MessagePipelineState> {
          return {
            payload: state.payload.toUpperCase(),
            events: [...state.events, "uppercase"],
          };
        },
      })
      .run(
        { payload: " sample payload ", events: [] },
        { requestId: "integration-test", headers: {} },
      )) as MessagePipelineState;
    console.log("integration: pipeline result", result);
  });
}

runUnitScenario()
  .then(runIntegrationScenario)
  .catch((error) => {
    console.error("Testing scenarios failed", error);
    process.exit(1);
  });
