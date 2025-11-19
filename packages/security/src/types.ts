import { RouteEnhancer } from "@ocd-js/core";

export interface SecurityMetadata {
  cookies?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  [key: string]: unknown;
}

export interface SecurityContext {
  requestId: string;
  method: string;
  path: string;
  ip?: string;
  headers: Record<string, string>;
  body?: unknown;
  user?: Record<string, unknown>;
  timestamp: number;
  metadata?: SecurityMetadata;
}

export type SecurityNext = () => Promise<void> | void;

export interface SecurityMiddleware {
  name: string;
  handle(context: SecurityContext, next: SecurityNext): Promise<void> | void;
}

export interface SecurityResult {
  blocked: boolean;
  reason?: string;
}

export const applySecurityMiddlewares = async (
  middlewares: SecurityMiddleware[],
  context: SecurityContext,
  finalHandler: () => Promise<void> | void
): Promise<SecurityResult> => {
  let blocked = false;
  let reason: string | undefined;

  const execute = async (index: number): Promise<void> => {
    if (index >= middlewares.length) {
      await finalHandler();
      return;
    }
    const middleware = middlewares[index];
    let proceeded = false;
    const next = async () => {
      proceeded = true;
      await execute(index + 1);
    };
    await middleware.handle(context, next);
    if (!proceeded && index < middlewares.length) {
      blocked = true;
      reason = `${middleware.name} blocked request`;
    }
  };

  await execute(0);
  return { blocked, reason };
};

export const resolveSecurityTokens = (enhancers: RouteEnhancer[] = []) =>
  enhancers
    .filter((enhancer) => enhancer.kind === "security")
    .flatMap((enhancer) => enhancer.middlewares);
