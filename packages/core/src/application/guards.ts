import { Container } from "../di/container";
import { InjectionToken } from "../di/types";
import { registerRouteEnhancer } from "../routing/enhancers";

export interface GuardContext<TRequest = any> {
  request: TRequest;
  container: Container;
}

export interface Guard {
  canActivate(
    context: GuardContext,
    options?: Record<string, unknown>,
  ): Promise<boolean> | boolean;
}

export const UseGuards = (
  ...guards: InjectionToken<Guard>[]
): MethodDecorator => {
  return (target, propertyKey) => {
    const controller = target.constructor as { new (...args: any[]): any };
    guards.forEach((guardToken) =>
      registerRouteEnhancer(controller, propertyKey as string | symbol, {
        kind: "guard",
        guardToken,
      }),
    );
  };
};

export const GuardTokens = {
  Authenticated: Symbol.for("OCD_GUARD_AUTHENTICATED"),
};
