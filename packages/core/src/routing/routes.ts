import { Constructor } from "../di/types";
import { consumeRouteEnhancers, RouteEnhancer } from "./enhancers";
export type { RouteEnhancer } from "./enhancers";
import { ApiVersion } from "./versioning";

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export interface RouteSchema {
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  response?: Record<string, unknown>;
}

export interface RouteOptions {
  method: HttpMethod;
  path: string;
  version?: ApiVersion;
  schema?: RouteSchema;
}

export interface RouteDefinition extends RouteOptions {
  handlerKey: string | symbol;
  enhancers?: RouteEnhancer[];
}

const routeRegistry = new WeakMap<Constructor, RouteDefinition[]>();

export const Route = (options: RouteOptions): MethodDecorator => {
  return (target, propertyKey, descriptor) => {
    const controller = target.constructor as Constructor;
    const existing = routeRegistry.get(controller) ?? [];
    const descriptorHandler = descriptor?.value as { name?: string } | undefined;
    const handlerKey = (propertyKey as string | symbol | undefined) ?? descriptorHandler?.name ?? "anonymous";
    existing.push({ ...options, handlerKey });
    routeRegistry.set(controller, existing);
    return descriptor;
  };
};

const shorthand = (method: HttpMethod) =>
  (path: string, config: Omit<RouteOptions, "method" | "path"> = {}) =>
    Route({ method, path, ...config });

export const Get = shorthand("GET");
export const Post = shorthand("POST");
export const Put = shorthand("PUT");
export const Patch = shorthand("PATCH");
export const Del = shorthand("DELETE");
export const Head = shorthand("HEAD");
export const Options = shorthand("OPTIONS");

export const getControllerRoutes = (controller: Constructor): RouteDefinition[] =>
  (routeRegistry.get(controller) ?? []).map((definition) => ({
    ...definition,
    enhancers: consumeRouteEnhancers(controller, definition.handlerKey),
  }));
