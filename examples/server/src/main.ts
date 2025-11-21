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
import {
  PIPELINE_MANAGER,
  AsyncPipeline,
  StreamingBodyParser,
  FastSerializer,
} from "@ocd-js/performance";
import { PLUGIN_MANAGER, PluginManager } from "@ocd-js/plugins";
import { AuditPlugin } from "./plugins/audit.plugin";
import { AppModule } from "./user/user.module";
import { UserController } from "./user/user.controller";
import { CreateUserInput } from "./user/dto/create-user.dto";
import { runOrmWorkflow } from "./user/orm-demo";
import {
  POLICY_SERVICE,
  OWASP_TOP10_BUNDLE,
  ReleaseChecklist,
  PolicyService,
} from "@ocd-js/governance";
import {
  FEATURE_FLAG_SERVICE,
  FeatureFlagService,
} from "@ocd-js/feature-flags";

async function main() {
  const app = createApplicationContext(AppModule);

  console.log("routes", app.routes);

  const request = app.beginRequest();
  const controller = request.container.resolve(UserController);
  const logger = request.container.resolve(LOGGER) as StructuredLogger;
  const probes = request.container.resolve(PROBE_REGISTRY) as ProbeRegistry;
  const metrics = request.container.resolve(
    METRICS_REGISTRY,
  ) as MetricsRegistry;
  const pipeline = request.container.resolve(PIPELINE_MANAGER) as AsyncPipeline;
  const pluginManager = request.container.resolve(
    PLUGIN_MANAGER,
  ) as PluginManager;
  const policyService = request.container.resolve(
    POLICY_SERVICE,
  ) as PolicyService;
  const featureFlags = request.container.resolve(
    FEATURE_FLAG_SERVICE,
  ) as FeatureFlagService;

  pipeline.use(new StreamingBodyParser()).use(new FastSerializer());

  pluginManager.register(AuditPlugin);
  await pluginManager.bootstrap(request.container);

  logger.withCorrelation("server-correlation", () => {
    logger.info("Bootstrapped reference server");
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

  const snapshot = await probes.runAll();
  logger.info("probe snapshot", snapshot.health);
  console.log("health", snapshot);

  console.log("metrics", renderOpenMetrics(metrics));

  const policyReport = await policyService.evaluate(OWASP_TOP10_BUNDLE);
  logger.info("policy report", { policyReport });

  const checklist = new ReleaseChecklist([
    { id: "tests", description: "All tests green", verify: () => true },
    {
      id: "docs",
      description: "Docs generator run",
      verify: () => true,
    },
  ]);
  console.log("release checklist", await checklist.run());

  console.log("beta flag enabled", featureFlags.isEnabled("beta-users"));

  await runOrmWorkflow(logger);
}

main().catch((error) => {
  console.error("Server bootstrap failed", error);
  process.exit(1);
});
