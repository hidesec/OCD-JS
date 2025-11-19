import { Constructor, InjectionToken } from "../di/types";

export type ValidationTarget = "body" | "query" | "params";

export interface ValidationEnhancer {
  kind: "validation";
  target: ValidationTarget;
  schema: unknown;
}

export interface SecurityEnhancer {
  kind: "security";
  middlewares: InjectionToken[];
}

export interface GuardEnhancer {
  kind: "guard";
  guardToken: InjectionToken;
  options?: Record<string, unknown>;
}

export type RouteEnhancer = ValidationEnhancer | SecurityEnhancer | GuardEnhancer;

type HandlerKey = string | symbol;

const enhancerRegistry = new WeakMap<Constructor, Map<HandlerKey, RouteEnhancer[]>>();

export const registerRouteEnhancer = (
  controller: Constructor,
  handlerKey: HandlerKey | undefined,
  enhancer: RouteEnhancer
): void => {
  if (!handlerKey) {
    throw new Error("Route enhancer requires a handler key");
  }
  const controllerRegistry = enhancerRegistry.get(controller) ?? new Map<HandlerKey, RouteEnhancer[]>();
  const enhancers = controllerRegistry.get(handlerKey) ?? [];
  enhancers.push(enhancer);
  controllerRegistry.set(handlerKey, enhancers);
  enhancerRegistry.set(controller, controllerRegistry);
};

export const getRouteEnhancers = (controller: Constructor, handlerKey: HandlerKey): RouteEnhancer[] => {
  const controllerRegistry = enhancerRegistry.get(controller);
  if (!controllerRegistry) {
    return [];
  }
  return controllerRegistry.get(handlerKey) ?? [];
};

export const consumeRouteEnhancers = (controller: Constructor, handlerKey: HandlerKey): RouteEnhancer[] => {
  const controllerRegistry = enhancerRegistry.get(controller);
  if (!controllerRegistry) {
    return [];
  }
  const enhancers = controllerRegistry.get(handlerKey) ?? [];
  controllerRegistry.delete(handlerKey);
  return enhancers;
};
