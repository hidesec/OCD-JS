import { Injectable } from "@ocd-js/core";
import type {
  SecurityContext,
  SecurityMiddleware,
  SecurityNext,
} from "../types";

export interface CsrfOptions {
  headerName?: string;
  cookieName?: string;
}

@Injectable()
export class CsrfProtector implements SecurityMiddleware {
  public readonly name = "CsrfProtector";

  constructor(private readonly options: CsrfOptions = {}) {}

  async handle(context: SecurityContext, next: SecurityNext): Promise<void> {
    const headerName = (
      this.options.headerName ?? "x-csrf-token"
    ).toLowerCase();
    const cookieName = this.options.cookieName ?? "csrf_token";
    const headerToken = context.headers[headerName];
    const cookieToken = context.metadata?.cookies?.[cookieName];

    if (!headerToken || !cookieToken || headerToken !== cookieToken) {
      throw new Error("CSRF token mismatch");
    }

    await next();
  }
}
