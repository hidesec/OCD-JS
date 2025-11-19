export type FlagState = Record<string, boolean>;

export class FeatureFlagService {
  private readonly flags = new Map<string, boolean>();

  constructor(initialState: FlagState = {}) {
    Object.entries(initialState).forEach(([key, value]) =>
      this.flags.set(key, value),
    );
  }

  static fromEnv(value?: string): FeatureFlagService {
    if (!value) {
      return new FeatureFlagService();
    }
    const entries = value.split(",").reduce((acc, pair) => {
      const [flag, state] = pair.split(":");
      if (flag) {
        acc[flag.trim()] = state?.trim() !== "off";
      }
      return acc;
    }, {} as FlagState);
    return new FeatureFlagService(entries);
  }

  isEnabled(flag: string): boolean {
    return this.flags.get(flag) ?? false;
  }

  setFlag(flag: string, value: boolean): void {
    this.flags.set(flag, value);
  }
}
