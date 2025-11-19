import type { Container } from "@ocd-js/core";
import semver from "semver";
import { getPluginMetadata } from "./decorators";
import {
  PluginClass,
  PluginContext,
  PluginLifecycle,
  PluginMetadata,
} from "./types";

interface PluginRegistration {
  plugin: PluginClass;
  config: Record<string, unknown>;
}

export interface PluginManagerOptions {
  coreVersion: string;
}

export class PluginManager {
  private readonly registrations: PluginRegistration[] = [];
  private readonly instances = new Map<string, PluginLifecycle>();
  private initialized = false;

  constructor(private readonly options: PluginManagerOptions) {}

  register(plugin: PluginClass, config: Record<string, unknown> = {}): void {
    this.registrations.push({ plugin, config });
  }

  async bootstrap(container: Container): Promise<void> {
    if (this.initialized) return;
    for (const entry of this.registrations) {
      const metadata = getPluginMetadata(entry.plugin);
      this.ensureCompatibility(metadata);
      const instance = new entry.plugin();
      const context = createPluginContext(container, metadata, entry.config);
      if (instance.onRegister) {
        await instance.onRegister(context);
      }
      if (instance.onInit) {
        await instance.onInit(context);
      }
      this.instances.set(metadata.name, instance);
    }
    for (const [name, instance] of this.instances.entries()) {
      const context = createPluginContext(
        container,
        getPluginMetadata(this.getPluginClass(name)),
        this.getConfig(name),
      );
      if (instance.onReady) {
        await instance.onReady(context);
      }
    }
    this.initialized = true;
  }

  async shutdown(container: Container): Promise<void> {
    const entries = Array.from(this.instances.entries());
    for (const [name, instance] of entries) {
      const context = createPluginContext(
        container,
        getPluginMetadata(this.getPluginClass(name)),
        this.getConfig(name),
      );
      if (instance.onShutdown) {
        await instance.onShutdown(context);
      }
    }
    this.instances.clear();
    this.initialized = false;
  }

  list() {
    return this.registrations.map((entry) => getPluginMetadata(entry.plugin));
  }

  private ensureCompatibility(metadata: PluginMetadata) {
    const range = metadata.compatibility?.core ?? "*";
    if (!semver.satisfies(this.options.coreVersion, range)) {
      throw new Error(
        `Plugin ${metadata.name}@${metadata.version} incompatible with core ${this.options.coreVersion} (expects ${range})`,
      );
    }
  }

  private getPluginClass(name: string): PluginClass {
    const registration = this.registrations.find(
      (entry) => getPluginMetadata(entry.plugin).name === name,
    );
    if (!registration) {
      throw new Error(`Plugin ${name} is not registered`);
    }
    return registration.plugin;
  }

  private getConfig(name: string): Record<string, unknown> {
    const registration = this.registrations.find(
      (entry) => getPluginMetadata(entry.plugin).name === name,
    );
    return registration?.config ?? {};
  }
}

const createPluginContext = (
  container: Container,
  metadata: PluginMetadata,
  config: Record<string, unknown>,
): PluginContext => ({
  container,
  metadata,
  config: Object.freeze({ ...config }),
});
