import type { Constructor, Container } from "@ocd-js/core";
import type { IncomingHttpHeaders } from "http";
import type { Server } from "http";
import type { Socket } from "net";

export type NextFunction = (err?: unknown) => void;

export interface Request {
  method: string;
  url: string;
  path: string;
  headers: IncomingHttpHeaders;
  ip: string;
  socket: Socket;
  params: Record<string, string>;
  query: Record<string, unknown>;
  body?: unknown;
  // convenience for compatibility
  get(header: string): string | undefined;
}

export interface Response {
  status(code: number): Response;
  json(payload: unknown): void;
  send(payload?: unknown): void;
  setHeader(name: string, value: string): void;
  end(payload?: unknown): void;
  readonly headersSent: boolean;
}

export type RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => void | Promise<void>;

export type ErrorRequestHandler = (
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
) => void | Promise<void>;

export interface AppLike {
  (
    nodeReq: import("http").IncomingMessage,
    nodeRes: import("http").ServerResponse,
  ): void;
  use: ((mw: RequestHandler) => void) & ((mw: ErrorRequestHandler) => void);
  listen: (...args: any[]) => Server;
  get: (path: string, handler: RequestHandler) => void;
  post: (path: string, handler: RequestHandler) => void;
  put: (path: string, handler: RequestHandler) => void;
  patch: (path: string, handler: RequestHandler) => void;
  delete: (path: string, handler: RequestHandler) => void;
  head: (path: string, handler: RequestHandler) => void;
  options: (path: string, handler: RequestHandler) => void;
}

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

export interface HttpAdapterOptions {
  module: Constructor;
  app?: AppLike;
  globalPrefix?: string;
  jsonLimit?: string | number;
  middlewares?: RequestHandler[];
  versioning?: VersioningStrategy;
  onError?: (error: unknown, req: Request, res: Response) => void;
}
