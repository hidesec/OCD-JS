import { DatabaseDriver } from "./driver";

export type DriverFactory<TOptions = any> = (
  options?: TOptions,
) => DatabaseDriver;

export type DriverConstructor<TOptions = any> = new (
  options?: TOptions,
) => DatabaseDriver;

interface DriverDefinition<TOptions = any> {
  name: string;
  factory: DriverFactory<TOptions>;
}

const driverRegistry = new Map<string, DriverDefinition>();

const normalizeName = (name: string) => name.trim().toLowerCase();

export const OrmDriver = (name: string): ClassDecorator => {
  if (!name) {
    throw new Error("OrmDriver decorator requires a driver name");
  }
  return (target) => {
    if (typeof target !== "function") {
      throw new Error("OrmDriver can only be applied to classes");
    }
    const ctor = target as unknown as DriverConstructor;
    registerDriver(name, (options) => new ctor(options));
  };
};

export const registerDriver = <TOptions>(
  name: string,
  factory: DriverFactory<TOptions>,
): void => {
  const key = normalizeName(name);
  if (driverRegistry.has(key)) {
    throw new Error(`Driver with name "${name}" already registered`);
  }
  driverRegistry.set(key, { name: key, factory });
};

export const createRegisteredDriver = <TOptions>(
  name: string,
  options?: TOptions,
): DatabaseDriver => {
  const key = normalizeName(name);
  const definition = driverRegistry.get(key);
  if (!definition) {
    throw new Error(`Unknown ORM driver "${name}"`);
  }
  return definition.factory(options);
};

export const hasDriver = (name: string): boolean =>
  driverRegistry.has(normalizeName(name));

export const listRegisteredDrivers = (): string[] =>
  Array.from(driverRegistry.keys());
