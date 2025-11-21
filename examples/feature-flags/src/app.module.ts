import { Module } from "@ocd-js/core";
import { FeatureFlagsModule } from "@ocd-js/feature-flags";
import { FeatureFlagPreviewController } from "./demo.controller";
import { FeatureFlagPreviewService } from "./demo.service";

@Module({
  imports: [FeatureFlagsModule],
  controllers: [FeatureFlagPreviewController],
  providers: [FeatureFlagPreviewService],
})
export class AppModule {}
