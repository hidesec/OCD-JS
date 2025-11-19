import { Injectable } from "@ocd-js/core";
import type { SecurityContext, SecurityMiddleware, SecurityNext } from "../types";

@Injectable()
export class InputSanitizer implements SecurityMiddleware {
  public readonly name = "InputSanitizer";

  async handle(context: SecurityContext, next: SecurityNext): Promise<void> {
    if (context.body) {
      context.body = this.sanitize(context.body);
    }
    context.headers = this.sanitizeRecord(context.headers);
    await next();
  }

  private sanitizeRecord<T extends Record<string, unknown>>(value: T): T {
    const result: Record<string, unknown> = {};
    Object.entries(value).forEach(([key, entry]) => {
      result[key] = typeof entry === "string" ? this.cleanString(entry) : entry;
    });
    return result as T;
  }

  private sanitize(value: unknown): unknown {
    if (typeof value === "string") {
      return this.cleanString(value);
    }
    if (Array.isArray(value)) {
      return value.map((entry) => this.sanitize(entry));
    }
    if (value && typeof value === "object") {
      return this.sanitizeRecord(value as Record<string, unknown>);
    }
    return value;
  }

  private cleanString(value: string): string {
    return value
      .replace(/<script.*?>.*?<\/script>/gi, "")
      .replace(/[\u0000-\u001F\u007F]/g, "")
      .trim();
  }
}
