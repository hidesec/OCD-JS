import { LOGGER, StructuredLogger } from "@ocd-js/observability";
import { OcdPlugin, PluginContext } from "@ocd-js/plugins";

interface AuditPluginConfig {
  onReady?: () => Promise<void> | void;
}

@OcdPlugin({
  name: "audit-plugin",
  version: "0.1.0",
  compatibility: { core: ">=0.1.0" },
})
export class AuditPlugin {
  async onReady(context: PluginContext<AuditPluginConfig>) {
    const logger = context.container.resolve(LOGGER) as StructuredLogger;
    logger.info("Audit plugin ready", { plugin: context.metadata.name });
    await context.config.onReady?.();
  }
}
