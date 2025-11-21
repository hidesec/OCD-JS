import assert from "node:assert/strict";
import { ContractHarness } from "@ocd-js/contract-testing";
import { FeatureRegistryPlugin, resolveRegistry } from "./feature.plugin";

async function bootstrap() {
  const harness = new ContractHarness({ coreVersion: "1.1.2-beta" });
  harness.registerPlugin(FeatureRegistryPlugin, {
    defaultFlags: ["beta-ui", "refactor"],
  });

  harness.addScenario({
    name: "registry is available",
    verify: (container) => {
      const registry = resolveRegistry(container);
      assert.ok(registry, "feature registry should be registered");
      registry.enable("runtime-check");
      assert.ok(registry.list().includes("runtime-check"));
    },
  });

  harness.addScenario({
    name: "default flags enabled",
    verify: (container) => {
      const registry = resolveRegistry(container);
      const flags = registry.list();
      assert.deepEqual(flags.sort(), ["beta-ui", "refactor"].sort());
    },
  });

  await harness.run();
  console.log("All plugin contracts satisfied ✅");
}

bootstrap().catch((error) => {
  console.error("Contract testing run failed", error);
  process.exit(1);
});
