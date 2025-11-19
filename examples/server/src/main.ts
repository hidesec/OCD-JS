import {
  applyValidationEnhancers,
  createApplicationContext,
} from "@ocd-js/core";
import { resolveSecurityTokens } from "@ocd-js/security";
import {
  LOGGER,
  METRICS_REGISTRY,
  PROBE_REGISTRY,
  ProbeRegistry,
  MetricsRegistry,
  StructuredLogger,
  renderOpenMetrics,
} from "@ocd-js/observability";
import { AppModule } from "./user/user.module";
import { UserController } from "./user/user.controller";
import { CreateUserInput } from "./user/dto/create-user.dto";

const app = createApplicationContext(AppModule);

console.log("routes", app.routes);

const request = app.beginRequest();
const controller = request.container.resolve(UserController);
const logger = request.container.resolve(LOGGER) as StructuredLogger;
const probes = request.container.resolve(PROBE_REGISTRY) as ProbeRegistry;
const metrics = request.container.resolve(METRICS_REGISTRY) as MetricsRegistry;

logger.withCorrelation("demo-correlation", () => {
  logger.info("Bootstrapped example server");
});

console.log(controller.list());

const createRoute = app.routes.find((route) => route.handlerKey === "create");
if (createRoute?.enhancers) {
  const securityTokens = resolveSecurityTokens(createRoute.enhancers);
  console.log(
    "security middlewares",
    securityTokens.map((token) =>
      typeof token === "function" ? token.name : String(token),
    ),
  );

  try {
    const validated = applyValidationEnhancers(createRoute.enhancers, {
      body: { name: "Jane", email: "jane@example.com" },
    });
    const payload = validated.body as CreateUserInput;
    console.log("create user", controller.create(payload));
  } catch (error) {
    console.error("validation failed", error);
  }
}

probes.runAll().then((snapshot) => {
  logger.info("probe snapshot", snapshot.health);
  console.log("health", snapshot);
});

console.log("metrics", renderOpenMetrics(metrics));
