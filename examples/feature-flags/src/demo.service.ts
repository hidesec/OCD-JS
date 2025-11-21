import { Inject, Injectable } from "@ocd-js/core";
import {
  FEATURE_FLAG_SERVICE,
  FeatureFlagService,
} from "@ocd-js/feature-flags";

@Injectable()
export class FeatureFlagPreviewService {
  constructor(
    @Inject(FEATURE_FLAG_SERVICE)
    private readonly flags: FeatureFlagService,
  ) {}

  snapshot(flagNames: string[]): Record<string, boolean> {
    return flagNames.reduce(
      (state, flag) => {
        state[flag] = this.flags.isEnabled(flag);
        return state;
      },
      {} as Record<string, boolean>,
    );
  }

  setFlag(flag: string, value: boolean): void {
    this.flags.setFlag(flag, value);
  }
}
