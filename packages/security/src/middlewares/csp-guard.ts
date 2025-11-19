import { Injectable } from "@ocd-js/core";
import type {
  SecurityContext,
  SecurityMiddleware,
  SecurityNext,
} from "../types";

export interface CspOptions {
  directives: Record<string, string[]>;
}

@Injectable()
export class CspGuard implements SecurityMiddleware {
  public readonly name = "CspGuard";

  constructor(private readonly options: CspOptions) {}

  async handle(context: SecurityContext, next: SecurityNext): Promise<void> {
    const headerValue = Object.entries(this.options.directives)
      .map(([directive, values]) => `${directive} ${values.join(" ")}`)
      .join("; ");
    const metadata = context.metadata ?? {};
    const existingHeaders =
      (metadata.responseHeaders as Record<string, string> | undefined) ?? {};
    context.metadata = {
      ...metadata,
      responseHeaders: {
        ...existingHeaders,
        "Content-Security-Policy": headerValue,
      },
    };
    await next();
  }
}
