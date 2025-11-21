import { DatabaseDriver } from "./driver";
import { EntityMetadata } from "./metadata";

export type HookType =
  | "beforeInsert"
  | "beforeUpdate"
  | "beforeRemove"
  | "afterInsert"
  | "afterUpdate"
  | "afterRemove"
  | "validate";

interface HookDefinition {
  type: HookType;
  methodName: string;
}

const hookRegistry = new Map<Function, HookDefinition[]>();

const registerHook = (target: Function, type: HookType, methodName: string) => {
  const existing = hookRegistry.get(target) ?? [];
  hookRegistry.set(target, [...existing, { type, methodName }]);
};

const collectHooks = (target: Function, type: HookType): HookDefinition[] => {
  if (!target) return [];
  const definitions: HookDefinition[] = [];
  let current: Function | undefined = target;
  while (current) {
    const hooks = hookRegistry.get(current) ?? [];
    hooks
      .filter((hook) => hook.type === type)
      .forEach((hook) => definitions.push(hook));
    current = Object.getPrototypeOf(current);
  }
  return definitions;
};

export interface EntityChangeSet<T = any> {
  before?: Partial<T>;
  after?: Partial<T>;
  changedFields: string[];
}

export interface HookContextInput<T = any> {
  metadata?: EntityMetadata;
  driver?: DatabaseDriver;
  changeSet?: EntityChangeSet<T>;
  isNew?: boolean;
  timestamp?: number;
}

export interface HookContext<T = any> extends HookContextInput<T> {
  entity: T;
  action: HookType;
}

export interface ValidationErrorDetail {
  path?: string;
  message: string;
}

export interface ValidationContext<T = any> extends HookContext<T> {
  addError(path: string | undefined, message: string): void;
  errors: ValidationErrorDetail[];
}

export class EntityValidationError extends Error {
  constructor(public readonly errors: ValidationErrorDetail[]) {
    super(
      errors.length
        ? `Entity validation failed with ${errors.length} error${errors.length === 1 ? "" : "s"}`
        : "Entity validation failed",
    );
    this.name = "EntityValidationError";
  }
}

const createHookDecorator = (type: HookType): MethodDecorator => {
  return (_target, propertyKey, descriptor) => {
    if (!descriptor || typeof descriptor.value !== "function") {
      throw new Error(`@${capitalize(type)} can only decorate methods`);
    }
    const ctor = _target.constructor as Function;
    registerHook(ctor, type, propertyKey as string);
  };
};

export const BeforeInsert = (): MethodDecorator =>
  createHookDecorator("beforeInsert");
export const BeforeUpdate = (): MethodDecorator =>
  createHookDecorator("beforeUpdate");
export const BeforeRemove = (): MethodDecorator =>
  createHookDecorator("beforeRemove");
export const AfterInsert = (): MethodDecorator =>
  createHookDecorator("afterInsert");
export const AfterUpdate = (): MethodDecorator =>
  createHookDecorator("afterUpdate");
export const AfterRemove = (): MethodDecorator =>
  createHookDecorator("afterRemove");
export const ValidateEntity = (): MethodDecorator =>
  createHookDecorator("validate");

export const runEntityHooks = async <T extends object>(
  entity: T,
  type: HookType,
  options?: HookContextInput<T>,
): Promise<void> => {
  const hooks = collectHooks(entity.constructor as Function, type);
  if (!hooks.length) return;
  const baseContext: HookContext<T> = {
    entity,
    action: type,
    metadata: options?.metadata,
    driver: options?.driver,
    changeSet: options?.changeSet,
    isNew: options?.isNew ?? type === "beforeInsert",
    timestamp: options?.timestamp,
  };
  if (type === "validate") {
    const validationContext = createValidationContext(baseContext);
    await invokeHooks(entity, hooks, validationContext);
    if (validationContext.errors.length) {
      throw new EntityValidationError(validationContext.errors);
    }
    return;
  }
  await invokeHooks(entity, hooks, baseContext);
};

const invokeHooks = async (
  entity: object,
  hooks: HookDefinition[],
  context: HookContext | ValidationContext,
) => {
  for (const hook of hooks) {
    const handler = (entity as any)[hook.methodName];
    if (typeof handler !== "function") continue;
    await handler.call(entity, context);
  }
};

const createValidationContext = <T extends object>(
  base: HookContext<T>,
): ValidationContext<T> => {
  const errors: ValidationErrorDetail[] = [];
  return {
    ...base,
    errors,
    addError(path: string | undefined, message: string) {
      errors.push({ path, message });
    },
  };
};

const capitalize = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1);
