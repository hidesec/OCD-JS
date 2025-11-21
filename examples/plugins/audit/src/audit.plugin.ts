import type { PluginContext } from "@ocd-js/plugins";
import { OcdPlugin, PluginLifecycle } from "@ocd-js/plugins";
import {
  LOGGER,
  METRICS_REGISTRY,
  MetricsRegistry,
  StructuredLogger,
} from "@ocd-js/observability";

export const AUDIT_PLUGIN = Symbol("AUDIT_PLUGIN_INSTANCE");

export interface AuditPluginConfig {
  capturePayloads?: boolean;
  redactKeys?: string[];
}

@OcdPlugin({
  name: "lifecycle-audit-plugin",
  version: "1.0.0",
  description: "Provides structured audit logging hooks",
  compatibility: { core: ">=1.1.0" },
})
export class LifecycleAuditPlugin implements PluginLifecycle {
  private logger?: StructuredLogger;
  private metrics?: MetricsRegistry;
  private totalEvents = 0;

  async onRegister(context: PluginContext<AuditPluginConfig>) {
    this.logger = context.container.resolve(LOGGER) as StructuredLogger;
    this.metrics = context.container.resolve(
      METRICS_REGISTRY,
    ) as MetricsRegistry;
    this.logger.info("Audit plugin registered", {
      metadata: context.metadata,
      config: context.config,
    });
    context.container.register({ token: AUDIT_PLUGIN, useValue: this });
  }

  async onInit(context: PluginContext<AuditPluginConfig>) {
    this.logger?.info("Audit plugin initializing", {
      capturePayloads: context.config.capturePayloads ?? true,
    });
    this.metrics?.counter("plugin_audit_events", "Total audit events recorded");
  }

  async onReady(context: PluginContext<AuditPluginConfig>) {
    this.logger?.info("Audit plugin ready", {
      redactKeys: context.config.redactKeys ?? [],
    });
    this.captureEvent("plugin.ready", { timestamp: Date.now() });
  }

  async onShutdown() {
    this.logger?.info("Audit plugin shutting down", {
      totalEvents: this.totalEvents,
    });
  }

  captureEvent(event: string, payload: Record<string, unknown>) {
    this.totalEvents += 1;
    this.metrics?.counter("plugin_audit_events").inc();
    this.logger?.info("audit.event", {
      event,
      payload,
    });
  }
}
