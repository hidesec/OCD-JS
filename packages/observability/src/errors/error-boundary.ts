import { StructuredLogger } from "../logging/structured-logger";
import { MetricsRegistry } from "../metrics/registry";

export interface ErrorMapping {
  match: (error: unknown) => boolean;
  status: number;
  code?: string;
}

export interface ErrorBoundaryOptions {
  logger?: StructuredLogger;
  metrics?: MetricsRegistry;
  mappings?: ErrorMapping[];
  defaultStatus?: number;
}

export interface BoundaryResult<T> {
  success: boolean;
  data?: T;
  error?: BoundaryError;
}

export interface BoundaryError {
  status: number;
  message: string;
  code?: string;
}

export class ErrorBoundary {
  private readonly mappings: ErrorMapping[];
  private readonly defaultStatus: number;

  constructor(private readonly options: ErrorBoundaryOptions = {}) {
    this.mappings = options.mappings ?? [];
    this.defaultStatus = options.defaultStatus ?? 500;
  }

  async execute<T>(handler: () => Promise<T> | T): Promise<BoundaryResult<T>> {
    try {
      const data = await handler();
      return { success: true, data };
    } catch (error) {
      const boundaryError = this.mapError(error);
      this.options.logger?.error(
        `Error boundary captured ${boundaryError.code ?? boundaryError.status}`,
        {
          error: serializeError(error),
        },
      );
      this.options.metrics
        ?.counter("ocd_error_boundary_total", "Total boundary errors")
        .inc();
      return { success: false, error: boundaryError };
    }
  }

  private mapError(error: unknown): BoundaryError {
    const mapping = this.mappings.find((candidate) => candidate.match(error));
    if (mapping) {
      return {
        status: mapping.status,
        message: error instanceof Error ? error.message : String(error),
        code: mapping.code,
      };
    }
    return {
      status: this.defaultStatus,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

const serializeError = (error: unknown) => {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { message: String(error) };
};
