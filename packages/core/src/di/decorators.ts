import { Constructor, InjectionToken, Provider, Scope } from "./types";

export interface InjectableOptions {
  token?: InjectionToken;
  scope?: Scope;
  deps?: InjectionToken[];
}

interface InternalInjectableDefinition {
  token: InjectionToken;
  scope: Scope;
  deps?: InjectionToken[];
}

const injectableDefinitions = new WeakMap<Constructor, InternalInjectableDefinition>();
const parameterInjections = new WeakMap<Constructor, Map<number, InjectionToken>>();

export const Injectable = (options: InjectableOptions = {}): ClassDecorator => {
  return (target) => {
    assignInjectableMetadata(target as unknown as Constructor, options);
  };
};

export const Inject = (token: InjectionToken): ParameterDecorator => {
  return (target, _propertyKey, parameterIndex) => {
    const ctorTarget = typeof target === "function" ? target : target.constructor;
    const ctor = ctorTarget as Constructor;
    const existing = parameterInjections.get(ctor) ?? new Map<number, InjectionToken>();
    existing.set(parameterIndex, token);
    parameterInjections.set(ctor, existing);
  };
};

export function assignInjectableMetadata(target: Constructor, options: InjectableOptions = {}): void {
  const previous = injectableDefinitions.get(target);
  const definition: InternalInjectableDefinition = {
    token: options.token ?? previous?.token ?? target,
    scope: options.scope ?? previous?.scope ?? "singleton",
    deps: options.deps ?? previous?.deps,
  };
  injectableDefinitions.set(target, definition);
}

export function getInjectableDefinition(target: Constructor): InternalInjectableDefinition {
  const definition = injectableDefinitions.get(target);
  return (
    definition ?? {
      token: target,
      scope: "singleton",
    }
  );
}

export function provideFromClass(target: Constructor): Provider {
  const definition = getInjectableDefinition(target);
  return {
    token: definition.token,
    useClass: target,
    scope: definition.scope,
    deps: definition.deps ?? collectParameterDeps(target),
  };
}

function collectParameterDeps(target: Constructor): InjectionToken[] | undefined {
  const paramLength = target.length;
  if (paramLength === 0) {
    return [];
  }
  const injections = parameterInjections.get(target);
  if (!injections || injections.size < paramLength) {
    throw new Error(
      `Constructor for ${target.name} requires ${paramLength} dependencies. Provide @Inject() metadata or explicit deps.`
    );
  }
  return Array.from({ length: paramLength }, (_, index) => {
    const token = injections.get(index);
    if (!token) {
      throw new Error(`Missing injection token for parameter #${index} in ${target.name}`);
    }
    return token;
  });
}
