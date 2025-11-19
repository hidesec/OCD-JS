import { PluginClass, PluginMetadata } from "./types";

const metadataStore = new WeakMap<PluginClass, PluginMetadata>();

export const OcdPlugin = (metadata: PluginMetadata): ClassDecorator => {
  return (target) => {
    metadataStore.set(target as unknown as PluginClass, metadata);
  };
};

export const getPluginMetadata = (plugin: PluginClass): PluginMetadata => {
  const metadata = metadataStore.get(plugin);
  if (!metadata) {
    throw new Error(`Plugin ${plugin.name} is missing @OcdPlugin metadata`);
  }
  return metadata;
};
