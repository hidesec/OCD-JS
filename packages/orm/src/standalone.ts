import { Connection, ConnectionCacheOptions } from "./connection";
import { DatabaseDriver } from "./driver";
import { createRegisteredDriver } from "./driver-registry";
import "./standalone-drivers";

export interface StandaloneOrmOptions<TOptions = unknown> {
  driver: string | DatabaseDriver;
  driverOptions?: TOptions;
  cache?: ConnectionCacheOptions;
}

export const createStandaloneConnection = async <TOptions = unknown>(
  options: StandaloneOrmOptions<TOptions>,
) => {
  const driver =
    typeof options.driver === "string"
      ? createRegisteredDriver(options.driver, options.driverOptions)
      : options.driver;

  const connection = new Connection({ driver, cache: options.cache });
  await connection.initialize();
  return connection;
};
