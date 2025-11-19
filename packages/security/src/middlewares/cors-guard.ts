import { Injectable } from "@ocd-js/core";
import type { SecurityContext, SecurityMiddleware, SecurityNext } from "../types";

export interface CorsOptions {
  origins: string[];
  methods?: string[];
  headers?: string[];
  credentials?: boolean;
}

@Injectable()
export class CorsGuard implements SecurityMiddleware {
  public readonly name = "CorsGuard";

  constructor(private readonly options: CorsOptions) {}

  async handle(context: SecurityContext, next: SecurityNext): Promise<void> {
    const origin = context.headers["origin"];
    if (origin && !this.options.origins.includes("*") && !this.options.origins.includes(origin)) {
      throw new Error("Origin not allowed");
    }
    const metadata = context.metadata ?? {};
    const existingHeaders = (metadata.responseHeaders as Record<string, string> | undefined) ?? {};
    context.metadata = {
      ...metadata,
      responseHeaders: {
        ...existingHeaders,
        "Access-Control-Allow-Origin": origin ?? this.options.origins[0] ?? "*",
        "Access-Control-Allow-Methods": (this.options.methods ?? ["GET", "POST"]).join(","),
        "Access-Control-Allow-Headers": (this.options.headers ?? ["Content-Type", "Authorization"]).join(","),
        "Access-Control-Allow-Credentials": this.options.credentials ? "true" : "false",
      },
    };
    await next();
  }
}
