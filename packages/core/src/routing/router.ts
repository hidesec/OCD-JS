import { Constructor } from "../di/types";
import { getControllerMetadata } from "../application/controller";
import { RouteDefinition, RouteSchema, RouteEnhancer, getControllerRoutes } from "./routes";
import { ApiVersion, resolveVersion } from "./versioning";

export interface CompiledRoute {
  method: RouteDefinition["method"];
  path: string;
  version: ApiVersion;
  controller: Constructor;
  handlerKey: string | symbol;
  schema?: RouteSchema;
  tags?: string[];
  enhancers?: RouteEnhancer[];
}

export const compileControllerRoutes = (controllers: Constructor[]): CompiledRoute[] => {
  return controllers.flatMap((controller) => {
    const metadata = getControllerMetadata(controller);
    const controllerRoutes = getControllerRoutes(controller);
    return controllerRoutes.map((route) => ({
      method: route.method,
      path: joinPaths(metadata.basePath, route.path),
      version: resolveVersion(route.version, metadata.version),
      controller,
      handlerKey: route.handlerKey,
      schema: route.schema,
      tags: metadata.tags,
      enhancers: route.enhancers,
    }));
  });
};

const joinPaths = (prefix: string, path: string) => {
  const normalizedPrefix = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedPrefix}${normalizedPath}`.replace(/\/+/g, "/");
};
