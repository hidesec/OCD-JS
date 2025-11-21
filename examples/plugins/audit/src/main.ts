import { createApplicationContext } from "@ocd-js/core";
import { PluginManager } from "@ocd-js/plugins";
import { LOGGER, StructuredLogger } from "@ocd-js/observability";
import { AppModule } from "./app.module";
import { AUDIT_PLUGIN, LifecycleAuditPlugin } from "./audit.plugin";

const CORE_VERSION = "1.1.2-beta";

async function bootstrap() {
  const app = createApplicationContext(AppModule);
  const logger = app.container.resolve(LOGGER) as StructuredLogger;
  const plugins = new PluginManager({ coreVersion: CORE_VERSION });

  plugins.register(LifecycleAuditPlugin, {
    capturePayloads: true,
    redactKeys: ["secret"],
  });

  await plugins.bootstrap(app.container);

  const audit = app.container.resolve(AUDIT_PLUGIN) as LifecycleAuditPlugin;
  audit.captureEvent("user.login", { userId: "u-1", secret: "top" });
  audit.captureEvent("user.update", { userId: "u-1", field: "email" });

  logger.info("registered plugins", plugins.list());

  await plugins.shutdown(app.container);
}

bootstrap().catch((error) => {
  console.error("Audit plugin workflow failed", error);
  process.exit(1);
});
