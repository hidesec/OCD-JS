import {
  Container,
  Guard,
  GuardContext,
  RouteEnhancer,
  createApplicationContext,
} from "@ocd-js/core";
import {
  FEATURE_FLAG_SERVICE,
  FeatureFlagService,
} from "@ocd-js/feature-flags";
import { AppModule } from "./app.module";
import { FeatureFlagPreviewController } from "./demo.controller";

type GuardEnhancer = Extract<RouteEnhancer, { kind: "guard" }>;

const guardEnhancers = (enhancers: RouteEnhancer[] = []): GuardEnhancer[] =>
  enhancers.filter((entry): entry is GuardEnhancer => entry.kind === "guard");

async function enforceGuards(
  label: string,
  enhancers: RouteEnhancer[] | undefined,
  container: Container,
  handler: () => unknown,
) {
  const context: GuardContext = { request: { id: label }, container };
  for (const enhancer of guardEnhancers(enhancers ?? [])) {
    const guard = container.resolve(enhancer.guardToken) as Guard;
    const allowed = await guard.canActivate(context, enhancer.options);
    if (!allowed) {
      console.warn(`scenario:${label} blocked`, {
        guard: guard.constructor.name,
        options: enhancer.options,
      });
      return;
    }
  }
  console.log(`scenario:${label} allowed`, handler());
}

async function bootstrap() {
  process.env.OCD_FEATURE_FLAGS = "beta-ui:off,refactor:on";

  const app = createApplicationContext(AppModule);
  const request = app.beginRequest();
  const controller = request.container.resolve(FeatureFlagPreviewController);

  console.log("initial state", controller.state());

  const betaRoute = app.routes.find(
    (route) =>
      route.controller === FeatureFlagPreviewController &&
      route.handlerKey === "betaExperience",
  );
  if (!betaRoute) {
    throw new Error("beta route metadata missing");
  }

  await enforceGuards(
    "beta-disabled",
    betaRoute.enhancers,
    request.container,
    () => controller.betaExperience(),
  );

  const flags = request.container.resolve(
    FEATURE_FLAG_SERVICE,
  ) as FeatureFlagService;
  flags.setFlag("beta-ui", true);

  console.log("after toggle", controller.state());

  await enforceGuards(
    "beta-enabled",
    betaRoute.enhancers,
    request.container,
    () => controller.betaExperience(),
  );
}

bootstrap().catch((error) => {
  console.error("Feature flags workflow failed", error);
  process.exit(1);
});
