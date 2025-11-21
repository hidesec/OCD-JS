import {
  AdaptiveRateLimiter,
  AuditLogger,
  CorsGuard,
  CsrfProtector,
  InputSanitizer,
} from "@ocd-js/security";

export const BASELINE_SECURITY_MIDDLEWARES = [
  AdaptiveRateLimiter,
  InputSanitizer,
  CorsGuard,
  CsrfProtector,
  AuditLogger,
] as const;

export type BaselineSecurityMiddleware =
  (typeof BASELINE_SECURITY_MIDDLEWARES)[number];
