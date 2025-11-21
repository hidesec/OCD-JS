import { Module } from "@ocd-js/core";
import { LOGGING_OPTIONS, ObservabilityModule } from "@ocd-js/observability";

@Module({
  imports: [ObservabilityModule],
  providers: [
    {
      token: LOGGING_OPTIONS,
      useValue: {
        serviceName: "example-audit-plugin-host",
        logLevel: "debug",
      },
    },
  ],
})
export class AppModule {}
