import { Injectable } from "@ocd-js/core";
import type {
  SecurityContext,
  SecurityMiddleware,
  SecurityNext,
} from "../types";

export interface AuditSink {
  write?(entry: AuditLogEntry): void;
  log?(entry: AuditLogEntry): void;
}

export interface AuditLogEntry {
  requestId: string;
  method: string;
  path: string;
  status?: number;
  latencyMs: number;
  user?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditLogger implements SecurityMiddleware {
  public readonly name = "AuditLogger";

  constructor(private readonly sink: AuditSink = console) {}

  async handle(context: SecurityContext, next: SecurityNext): Promise<void> {
    const start = Date.now();
    try {
      await next();
      this.emit({
        requestId: context.requestId,
        method: context.method,
        path: context.path,
        latencyMs: Date.now() - start,
        user: context.user,
        metadata: context.metadata,
      });
    } catch (error) {
      this.emit({
        requestId: context.requestId,
        method: context.method,
        path: context.path,
        status: 500,
        latencyMs: Date.now() - start,
        user: context.user,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }

  private emit(entry: AuditLogEntry): void {
    if (this.sink.write) {
      this.sink.write(entry);
      return;
    }
    if (this.sink.log) {
      this.sink.log(entry);
      return;
    }
    console.log(entry);
  }
}
