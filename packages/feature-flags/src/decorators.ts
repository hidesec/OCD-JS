import { registerRouteEnhancer } from "@ocd-js/core";
import { FEATURE_FLAG_GUARD } from "./tokens";

export const FeatureGate = (flag: string): MethodDecorator => {
  return (target, propertyKey) => {
    registerRouteEnhancer(
      target.constructor as any,
      propertyKey as string | symbol,
      {
        kind: "guard",
        guardToken: FEATURE_FLAG_GUARD,
        options: { flag },
      },
    );
  };
};
