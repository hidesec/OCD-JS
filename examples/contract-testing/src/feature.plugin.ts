import { Container } from "@ocd-js/core";
import { OcdPlugin, PluginContext, PluginLifecycle } from "@ocd-js/plugins";
import { LOGGER, StructuredLogger } from "@ocd-js/observability";
import { FEATURE_REGISTRY } from "./tokens";

export interface FeatureFlagRegistry {
  list(): string[];
  enable(flag: string): void;
}

class InMemoryFeatureRegistry implements FeatureFlagRegistry {
  private readonly flags = new Set<string>();

  list(): string[] {
    return Array.from(this.flags.values());
  }

  enable(flag: string): void {
    this.flags.add(flag);
  }
}

export interface FeaturePluginConfig {
  defaultFlags?: string[];
}

@OcdPlugin({
  name: "feature-registry-plugin",
  version: "1.0.0",
  description: "Registers an in-memory feature registry",
  compatibility: { core: ">=1.1.0" },
})
export class FeatureRegistryPlugin implements PluginLifecycle {
  private logger?: StructuredLogger;

  async onRegister(context: PluginContext<FeaturePluginConfig>) {
    this.logger = context.container.resolve(LOGGER) as StructuredLogger;
    context.container.register({
      token: FEATURE_REGISTRY,
      useValue: new InMemoryFeatureRegistry(),
    });
    this.logger.info("feature plugin registered", { config: context.config });
  }

  async onReady(context: PluginContext<FeaturePluginConfig>) {
    const registry = context.container.resolve(
      FEATURE_REGISTRY,
    ) as FeatureFlagRegistry;
    for (const flag of context.config.defaultFlags ?? []) {
      registry.enable(flag);
    }
    this.logger?.info("feature plugin ready", {
      enabled: registry.list(),
    });
  }
}

export const resolveRegistry = (container: Container): FeatureFlagRegistry =>
  container.resolve(FEATURE_REGISTRY) as FeatureFlagRegistry;
