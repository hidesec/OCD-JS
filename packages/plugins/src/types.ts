import type { Container } from "@ocd-js/core";

export interface PluginMetadata {
  name: string;
  version: string;
  compatibility?: PluginCompatibility;
  description?: string;
}

export interface PluginCompatibility {
  core: string;
  plugins?: Record<string, string>;
}

export interface PluginContext<TConfig = Record<string, unknown>> {
  container: Container;
  config: TConfig;
  metadata: PluginMetadata;
}

export interface PluginLifecycle {
  onRegister?(context: PluginContext): Promise<void> | void;
  onInit?(context: PluginContext): Promise<void> | void;
  onReady?(context: PluginContext): Promise<void> | void;
  onShutdown?(context: PluginContext): Promise<void> | void;
}

export type PluginClass<T extends PluginLifecycle = PluginLifecycle> =
  new () => T;
