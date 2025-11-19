import { Guard, GuardContext } from "@ocd-js/core";
import { FeatureFlagService } from "./feature-flag.service";

export class FeatureFlagGuard implements Guard {
  constructor(private readonly service: FeatureFlagService) {}

  canActivate(
    _context: GuardContext,
    options?: Record<string, unknown>,
  ): boolean {
    const flag = typeof options?.flag === "string" ? options.flag : undefined;
    if (!flag) {
      return true;
    }
    return this.service.isEnabled(flag);
  }
}
