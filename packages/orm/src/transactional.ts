import type { Connection, TransactionOptions } from "./connection";

export interface TransactionalOptions {
  connection?: (instance: any) => Connection;
  connectionProperty?: string;
  transaction?: TransactionOptions;
}

export const Transactional = (
  options: TransactionalOptions = {},
): MethodDecorator => {
  return (target, propertyKey, descriptor) => {
    if (!descriptor || typeof descriptor.value !== "function") {
      throw new Error("@Transactional can only decorate methods");
    }
    const original = descriptor.value as (...args: unknown[]) => unknown;
    const resolveConnection = (instance: any): Connection => {
      if (options.connection) {
        const resolved = options.connection.call(instance, instance);
        if (!resolved) {
          throw new Error("Transactional connection resolver returned null");
        }
        return resolved;
      }
      const property = options.connectionProperty ?? "connection";
      const conn = instance[property];
      if (!conn) {
        throw new Error(
          `Transactional decorator expects property "${property}" on target instance`,
        );
      }
      return conn;
    };
    const wrapped = function (this: any, ...args: unknown[]) {
      const connection = resolveConnection(this);
      return connection.transaction(
        (manager) => original.apply(this, [...args, manager]),
        options.transaction,
      );
    };
    descriptor.value = wrapped as unknown as typeof descriptor.value;
  };
};
