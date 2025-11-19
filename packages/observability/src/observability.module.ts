import { Module } from "@ocd-js/core";
import { LoggingModule } from "./logging/logging.module";
import { MetricsRegistry } from "./metrics/registry";
import { METRICS_REGISTRY } from "./metrics/tokens";
import { ProbeRegistry } from "./health/probes";
import { PROBE_REGISTRY } from "./health/tokens";
import { ErrorBoundary } from "./errors/error-boundary";
import { ERROR_BOUNDARY } from "./errors/tokens";
import { LOGGER } from "./logging/tokens";
import { StructuredLogger } from "./logging/structured-logger";

@Module({
  imports: [LoggingModule],
  providers: [
    {
      token: METRICS_REGISTRY,
      useValue: new MetricsRegistry(),
    },
    {
      token: PROBE_REGISTRY,
      useFactory: ({ container }) => new ProbeRegistry(container),
    },
    {
      token: ERROR_BOUNDARY,
      useFactory: ({ container }) =>
        new ErrorBoundary({
          logger: container.resolve(LOGGER) as StructuredLogger,
          metrics: container.resolve(METRICS_REGISTRY) as MetricsRegistry,
        }),
      deps: [LOGGER, METRICS_REGISTRY],
    },
  ],
  exports: [METRICS_REGISTRY, PROBE_REGISTRY, ERROR_BOUNDARY, LOGGER],
})
export class ObservabilityModule {}
