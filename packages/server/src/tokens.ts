import type { Request, Response } from "./types";

export const HTTP_REQUEST = Symbol.for("OCD_HTTP_REQUEST_TOKEN");
export const HTTP_RESPONSE = Symbol.for("OCD_HTTP_RESPONSE_TOKEN");

export type HttpRequest = Request & {
  user?: Record<string, unknown>;
  [key: string]: unknown;
};

export type HttpResponse = Response;
