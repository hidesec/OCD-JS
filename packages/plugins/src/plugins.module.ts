import { Module } from "@ocd-js/core";
import { PluginManager } from "./plugin-manager";
import { PLUGIN_MANAGER } from "./tokens";

@Module({
  providers: [
    {
      token: PLUGIN_MANAGER,
      useValue: new PluginManager({
        coreVersion: process.env.OCD_CORE_VERSION ?? "0.1.0",
      }),
    },
  ],
  exports: [PLUGIN_MANAGER],
})
export class PluginsModule {}
