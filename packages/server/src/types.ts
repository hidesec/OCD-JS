import type { Express, Request, Response, RequestHandler } from "express";
import type { Constructor, Container } from "@ocd-js/core";

export interface HttpContext {
  readonly request: Request;
  readonly response: Response;
  readonly container: Container;
  readonly params: Record<string, string>;
  readonly query: Record<string, unknown>;
  readonly body?: unknown;
}

export type VersioningStrategy =
  | { strategy: "none" }
  | { strategy: "path"; prefix?: string };

export interface ExpressAdapterOptions {
  module: Constructor;
  app?: Express;
  globalPrefix?: string;
  jsonLimit?: string | number;
  middlewares?: RequestHandler[];
  versioning?: VersioningStrategy;
  onError?: (error: unknown, req: Request, res: Response) => void;
}
