import { Module } from "@ocd-js/core";
import { ObservabilityModule } from "@ocd-js/observability";
import { ObservabilityProbeSuite } from "./probes";

@Module({
  imports: [ObservabilityModule],
  providers: [ObservabilityProbeSuite],
  exports: [ObservabilityProbeSuite],
})
export class AppModule {}
