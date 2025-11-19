import { Constructor, InjectionToken } from "@ocd-js/core";
import { registerRouteEnhancer } from "@ocd-js/core";
import type { SecurityMiddleware } from "./types";

export const UseSecurity = (
  ...middlewares: InjectionToken<SecurityMiddleware>[]
): MethodDecorator => {
  return (target, propertyKey) => {
    const controller = target.constructor as Constructor;
    registerRouteEnhancer(controller, propertyKey as string | symbol, {
      kind: "security",
      middlewares,
    });
  };
};
