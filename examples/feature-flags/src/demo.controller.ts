import { Controller, Get, Inject } from "@ocd-js/core";
import { FeatureGate } from "@ocd-js/feature-flags";
import { FeatureFlagPreviewService } from "./demo.service";

@Controller({ basePath: "/flags", version: "v1" })
export class FeatureFlagPreviewController {
  constructor(
    @Inject(FeatureFlagPreviewService)
    private readonly preview: FeatureFlagPreviewService,
  ) {}

  @Get("/")
  state() {
    return this.preview.snapshot(["beta-ui", "refactor"]);
  }

  @Get("/beta")
  @FeatureGate("beta-ui")
  betaExperience() {
    return {
      message: "Welcome to the beta UI rollout!",
      flag: "beta-ui",
    };
  }
}
