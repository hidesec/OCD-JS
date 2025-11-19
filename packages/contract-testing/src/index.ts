import { Container } from "@ocd-js/core";
import { PluginClass, PluginManager } from "@ocd-js/plugins";
import { LOGGER } from "@ocd-js/observability";

export interface ContractScenario {
  name: string;
  verify: (container: Container) => Promise<void> | void;
}

export interface HarnessOptions {
  coreVersion?: string;
}

export class ContractHarness {
  private readonly container = new Container();
  private readonly manager: PluginManager;
  private readonly scenarios: ContractScenario[] = [];

  constructor(options: HarnessOptions = {}) {
    this.manager = new PluginManager({
      coreVersion: options.coreVersion ?? "0.1.0",
    });
    this.container.register({
      token: LOGGER,
      useValue: createNoopLogger(),
    });
  }

  registerPlugin(plugin: PluginClass, config: Record<string, unknown> = {}) {
    this.manager.register(plugin, config);
  }

  addScenario(scenario: ContractScenario) {
    this.scenarios.push(scenario);
  }

  async run(): Promise<void> {
    await this.manager.bootstrap(this.container);
    for (const scenario of this.scenarios) {
      await scenario.verify(this.container);
    }
    await this.manager.shutdown(this.container);
  }
}

const createNoopLogger = () => ({
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  profile: async (_label: string, fn: () => Promise<unknown> | unknown) => fn(),
  withCorrelation: (_id: string, fn: () => Promise<unknown> | unknown) => fn(),
});
