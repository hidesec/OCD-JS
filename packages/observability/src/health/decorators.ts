import type { Constructor } from "@ocd-js/core";
import { ProbeResult, ProbeType, registerProbe } from "./probes";

const createProbeDecorator =
  (type: ProbeType) =>
  (name?: string): MethodDecorator => {
    return (target, propertyKey, descriptor) => {
      const controller = (
        typeof target === "function" ? target : target.constructor
      ) as Constructor;
      const handler = descriptor?.value as
        | ((...args: unknown[]) => unknown)
        | undefined;
      if (!handler) {
        throw new Error("Probe decorator can only be applied to methods");
      }
      const probeName =
        name ?? propertyKey?.toString() ?? handler.name ?? "probe";
      registerProbe(type, {
        name: probeName,
        factory: (container) => {
          const instance = container?.resolve(controller);
          const targetInstance = instance ?? controller;
          return async () =>
            (await Promise.resolve(
              handler.apply(targetInstance),
            )) as ProbeResult;
        },
      });
      return descriptor;
    };
  };

export const HealthCheck = createProbeDecorator("health");
export const ReadinessCheck = createProbeDecorator("readiness");
export const LivenessCheck = createProbeDecorator("liveness");
