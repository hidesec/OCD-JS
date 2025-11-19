import { Module } from "@ocd-js/core";
import { FeatureFlagService } from "./feature-flag.service";
import { FeatureFlagGuard } from "./feature-flag.guard";
import {
  FEATURE_FLAG_CONFIG,
  FEATURE_FLAG_GUARD,
  FEATURE_FLAG_SERVICE,
} from "./tokens";

@Module({
  providers: [
    {
      token: FEATURE_FLAG_CONFIG,
      useFactory: () => parseEnvFlags(process.env.OCD_FEATURE_FLAGS),
    },
    {
      token: FEATURE_FLAG_SERVICE,
      useFactory: ({ container }) =>
        new FeatureFlagService(
          container.resolve(FEATURE_FLAG_CONFIG) as Record<string, boolean>,
        ),
    },
    {
      token: FEATURE_FLAG_GUARD,
      useFactory: ({ container }) =>
        new FeatureFlagGuard(
          container.resolve(FEATURE_FLAG_SERVICE) as FeatureFlagService,
        ),
    },
  ],
  exports: [FEATURE_FLAG_SERVICE, FEATURE_FLAG_GUARD],
})
export class FeatureFlagsModule {}

const parseEnvFlags = (value?: string): Record<string, boolean> => {
  if (!value) {
    return {};
  }
  return value.split(",").reduce(
    (acc, pair) => {
      const [flag, state] = pair.split(":");
      if (flag) {
        acc[flag.trim()] = state?.trim() !== "off";
      }
      return acc;
    },
    {} as Record<string, boolean>,
  );
};
