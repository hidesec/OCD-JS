import type { EntityMetadata } from "./metadata";
import type { Connection } from "./connection";
import type { EntityChangeSet } from "./entity-hooks";

export type OrmEvent =
  | "afterLoad"
  | "afterCommit"
  | "beforeEntityPersist"
  | "afterEntityPersist"
  | "beforeEntityRemove"
  | "afterEntityRemove";

export interface AfterLoadEvent {
  entity: object;
  metadata: EntityMetadata;
}

export interface AfterCommitEvent {
  connection: Connection;
  scope: "transaction" | "unitOfWork";
}

export type LifecycleAction = "insert" | "update" | "remove";

export interface EntityLifecycleEvent<T = any> {
  entity: T;
  metadata: EntityMetadata;
  changeSet: EntityChangeSet<T>;
  action: LifecycleAction;
  timestamp: number;
}

export type OrmEventPayloads = {
  afterLoad: AfterLoadEvent;
  afterCommit: AfterCommitEvent;
  beforeEntityPersist: EntityLifecycleEvent;
  afterEntityPersist: EntityLifecycleEvent;
  beforeEntityRemove: EntityLifecycleEvent;
  afterEntityRemove: EntityLifecycleEvent;
};

export type OrmEventListener<K extends OrmEvent> = (
  payload: OrmEventPayloads[K],
) => void | Promise<void>;

const listenerRegistry: {
  [K in OrmEvent]: Set<OrmEventListener<K>>;
} = {
  afterLoad: new Set(),
  afterCommit: new Set(),
  beforeEntityPersist: new Set(),
  afterEntityPersist: new Set(),
  beforeEntityRemove: new Set(),
  afterEntityRemove: new Set(),
};

export const registerOrmEventListener = <K extends OrmEvent>(
  event: K,
  listener: OrmEventListener<K>,
): (() => void) => {
  const set = listenerRegistry[event];
  set.add(listener);
  return () => {
    set.delete(listener);
  };
};

export const emitOrmEvent = <K extends OrmEvent>(
  event: K,
  payload: OrmEventPayloads[K],
): Promise<void> => {
  const listeners = Array.from(listenerRegistry[event]);
  const pending: Promise<void>[] = [];
  for (const listener of listeners) {
    try {
      const result = listener(payload);
      if (result && typeof (result as Promise<void>).then === "function") {
        pending.push(
          (result as Promise<void>).catch((error) => {
            console.error(`[ocd-js][orm] ${event} listener failed`, error);
          }),
        );
      }
    } catch (error) {
      console.error(`[ocd-js][orm] ${event} listener failed`, error);
    }
  }
  if (!pending.length) {
    return Promise.resolve();
  }
  return Promise.all(pending).then(() => undefined);
};

const createEventDecorator = <K extends OrmEvent>(
  event: K,
): MethodDecorator => {
  return (target, propertyKey, descriptor) => {
    if (!descriptor || typeof descriptor.value !== "function") {
      throw new Error(`@${event} listener must decorate a method`);
    }
    if (typeof target !== "function") {
      throw new Error(`@${event} listener must be applied to a static method`);
    }
    const handler = descriptor.value.bind(target);
    registerOrmEventListener(event, handler as OrmEventListener<K>);
  };
};

export const AfterLoadListener = (): MethodDecorator =>
  createEventDecorator("afterLoad");
export const AfterCommitListener = (): MethodDecorator =>
  createEventDecorator("afterCommit");
export const BeforeEntityPersistListener = (): MethodDecorator =>
  createEventDecorator("beforeEntityPersist");
export const AfterEntityPersistListener = (): MethodDecorator =>
  createEventDecorator("afterEntityPersist");
export const BeforeEntityRemoveListener = (): MethodDecorator =>
  createEventDecorator("beforeEntityRemove");
export const AfterEntityRemoveListener = (): MethodDecorator =>
  createEventDecorator("afterEntityRemove");
