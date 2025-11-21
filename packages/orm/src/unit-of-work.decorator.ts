import type { Connection } from "./connection";

export interface UnitOfWorkBoundaryOptions {
  connection?: (instance: any) => Connection;
  connectionProperty?: string;
}

export const UnitOfWorkBoundary = (
  options: UnitOfWorkBoundaryOptions = {},
): MethodDecorator => {
  return (target, propertyKey, descriptor) => {
    if (!descriptor || typeof descriptor.value !== "function") {
      throw new Error("UnitOfWorkBoundary can only decorate methods");
    }
    const original = descriptor.value as (...args: unknown[]) => unknown;
    const resolveConnection = (instance: any): Connection => {
      if (options.connection) {
        const resolved = options.connection.call(instance, instance);
        if (!resolved) {
          throw new Error(
            "UnitOfWorkBoundary connection resolver returned null",
          );
        }
        return resolved;
      }
      const property = options.connectionProperty ?? "connection";
      const conn = instance[property];
      if (!conn) {
        throw new Error(
          `UnitOfWorkBoundary expects property "${property}" on target instance`,
        );
      }
      return conn;
    };
    const wrapped = async function (this: any, ...args: unknown[]) {
      const connection = resolveConnection(this);
      const unitOfWork = await connection.beginUnitOfWork();
      try {
        const result = await original.apply(this, [...args, unitOfWork]);
        await unitOfWork.commit();
        return result;
      } catch (error) {
        await unitOfWork.rollback();
        throw error;
      }
    };
    descriptor.value = wrapped as unknown as typeof descriptor.value;
  };
};
