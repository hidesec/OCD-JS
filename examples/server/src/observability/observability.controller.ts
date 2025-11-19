import { Controller, Get, Inject } from "@ocd-js/core";
import {
  METRICS_REGISTRY,
  MetricsRegistry,
  PROBE_REGISTRY,
  ProbeRegistry,
  LOGGER,
  StructuredLogger,
  renderOpenMetrics,
} from "@ocd-js/observability";

@Controller({ basePath: "/ops", version: "v1" })
export class ObservabilityController {
  constructor(
    @Inject(PROBE_REGISTRY) private readonly probes: ProbeRegistry,
    @Inject(METRICS_REGISTRY) private readonly metrics: MetricsRegistry,
    @Inject(LOGGER) private readonly logger: StructuredLogger,
  ) {}

  @Get("/health")
  async health() {
    const snapshot = await this.probes.runAll();
    this.logger.info("health probe executed", {
      status: snapshot.health.status,
    });
    return snapshot;
  }

  @Get("/metrics")
  metricsSnapshot() {
    this.logger.debug("metrics scraped");
    return renderOpenMetrics(this.metrics);
  }
}
