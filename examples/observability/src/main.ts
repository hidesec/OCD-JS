import { createApplicationContext } from "@ocd-js/core";
import {
  ERROR_BOUNDARY,
  LOGGER,
  METRICS_REGISTRY,
  PROBE_REGISTRY,
  ErrorBoundary,
  MetricsRegistry,
  ProbeRegistry,
  StructuredLogger,
  renderOpenMetrics,
} from "@ocd-js/observability";
import { AppModule } from "./app.module";
import { ObservabilityProbeSuite } from "./probes";

async function bootstrap() {
  const app = createApplicationContext(AppModule);
  const request = app.beginRequest();
  const logger = request.container.resolve(LOGGER) as StructuredLogger;
  const metrics = request.container.resolve(
    METRICS_REGISTRY,
  ) as MetricsRegistry;
  const probes = request.container.resolve(PROBE_REGISTRY) as ProbeRegistry;
  const boundary = request.container.resolve(ERROR_BOUNDARY) as ErrorBoundary;
  const probeSuite = request.container.resolve(ObservabilityProbeSuite);

  logger.withCorrelation("obs-suite", () => {
    logger.info("bootstrapping observability workflow");
  });

  await logger.profile("fetch-report", async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
  });

  metrics.counter("observability_requests_total", "Request count").inc();
  metrics.gauge("observability_inflight_jobs", "Jobs currently running").set(2);
  metrics
    .histogram("observability_latency_seconds", [0.05, 0.1, 0.5])
    .observe(0.08);

  console.log("open metrics\n", renderOpenMetrics(metrics));

  console.log("probes before stabilization", await probes.runAll());
  probeSuite.simulateDatabaseOutage();
  probeSuite.simulateStabilizedDeployment();
  console.log("probes after adjustments", await probes.runAll());

  const result = await boundary.execute(async () => {
    throw new Error("payment service timeout");
  });
  console.log("boundary result", result);
}

bootstrap().catch((error) => {
  console.error("Observability workflow failed", error);
  process.exit(1);
});
