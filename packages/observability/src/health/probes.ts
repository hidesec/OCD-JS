import type { Container } from "@ocd-js/core";

export type ProbeType = "health" | "readiness" | "liveness";

export interface ProbeResult {
  name: string;
  status: "up" | "down";
  details?: string;
}

type ProbeHandler = () => Promise<ProbeResult> | ProbeResult;

interface ProbeDefinition {
  name: string;
  handler?: ProbeHandler;
  factory?: (container?: Container) => ProbeHandler;
}

const registries: Record<ProbeType, Set<ProbeDefinition>> = {
  health: new Set(),
  readiness: new Set(),
  liveness: new Set(),
};

export const registerProbe = (type: ProbeType, definition: ProbeDefinition) => {
  registries[type].add(definition);
};

export class ProbeRegistry {
  constructor(private readonly container?: Container) {}

  async run(
    type: ProbeType,
  ): Promise<{ status: "ok" | "fail"; checks: ProbeResult[] }> {
    const definitions = Array.from(registries[type]);
    const checks = await Promise.all(
      definitions.map(async (definition) => {
        try {
          const handler =
            definition.handler ?? definition.factory?.(this.container);
          if (!handler) {
            throw new Error(`Probe ${definition.name} is missing handler`);
          }
          return await handler();
        } catch (error) {
          return {
            name: definition.name,
            status: "down" as const,
            details: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );
    const status = checks.some((check) => check.status === "down")
      ? "fail"
      : "ok";
    return { status, checks };
  }

  async runAll() {
    return {
      health: await this.run("health"),
      readiness: await this.run("readiness"),
      liveness: await this.run("liveness"),
    };
  }
}
