import { Constructor, registerRouteEnhancer } from "@ocd-js/core";
import { AuthGuard } from "./guards/auth.guard";
import { RoleGuard } from "./guards/role.guard";
import { PolicyGuard } from "./guards/policy.guard";

export const Authenticated = (): MethodDecorator => (target, propertyKey) => {
  const controller = target.constructor as Constructor;
  registerRouteEnhancer(controller, propertyKey as string | symbol, {
    kind: "guard",
    guardToken: AuthGuard,
  });
};

export const Roles = (...roles: string[]): MethodDecorator => (target, propertyKey) => {
  const controller = target.constructor as Constructor;
  registerRouteEnhancer(controller, propertyKey as string | symbol, {
    kind: "guard",
    guardToken: RoleGuard,
    options: { roles },
  });
};

export const Policies = (...policies: string[]): MethodDecorator => (target, propertyKey) => {
  const controller = target.constructor as Constructor;
  registerRouteEnhancer(controller, propertyKey as string | symbol, {
    kind: "guard",
    guardToken: PolicyGuard,
    options: { policies },
  });
};
