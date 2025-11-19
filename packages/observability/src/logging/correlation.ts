import { AsyncLocalStorage } from "node:async_hooks";

export interface CorrelationContext {
  correlationId: string;
  attributes?: Record<string, unknown>;
}

const storage = new AsyncLocalStorage<CorrelationContext>();

export const runWithCorrelation = <T>(
  correlationId: string,
  fn: () => Promise<T> | T,
  attributes?: Record<string, unknown>,
): Promise<T> | T => storage.run({ correlationId, attributes }, fn as any);

export const useCorrelationId = (): string | undefined =>
  storage.getStore()?.correlationId;

export const getCorrelationAttributes = ():
  | Record<string, unknown>
  | undefined => storage.getStore()?.attributes;
