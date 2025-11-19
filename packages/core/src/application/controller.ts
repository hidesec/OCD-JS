import { assignInjectableMetadata } from "../di/decorators";
import { Constructor } from "../di/types";
import { ApiVersion, DEFAULT_VERSION, resolveVersion } from "../routing/versioning";

export interface ControllerOptions {
  basePath: string;
  version?: ApiVersion;
  tags?: string[];
}

export interface ControllerMetadata extends Required<Omit<ControllerOptions, "version">> {
  version: ApiVersion;
}

const controllerDefinitions = new WeakMap<Constructor, ControllerMetadata>();

export const Controller = (options: ControllerOptions): ClassDecorator => {
  if (!options?.basePath) {
    throw new Error("Controller decorator requires a basePath");
  }

  return (target) => {
    const ctor = target as unknown as Constructor;
    const metadata: ControllerMetadata = {
      basePath: normalizeBasePath(options.basePath),
      version: resolveVersion(options.version, DEFAULT_VERSION),
      tags: options.tags ?? [],
    };
    controllerDefinitions.set(ctor, metadata);
    assignInjectableMetadata(ctor);
  };
};

export const getControllerMetadata = (target: Constructor): ControllerMetadata => {
  const metadata = controllerDefinitions.get(target);
  if (!metadata) {
    throw new Error(`Controller ${target.name} is missing @Controller decorator`);
  }
  return metadata;
};

const normalizeBasePath = (basePath: string) => {
  if (!basePath.startsWith("/")) {
    return `/${basePath}`;
  }
  return basePath.replace(/\/$/, "");
};
