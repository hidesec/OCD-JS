import { Module } from "@ocd-js/core";
import { AdaptiveRateLimiter } from "./middlewares/adaptive-rate-limiter";
import { AuditLogger } from "./middlewares/audit-logger";
import { CorsGuard } from "./middlewares/cors-guard";
import { CspGuard } from "./middlewares/csp-guard";
import { CsrfProtector } from "./middlewares/csrf-protector";
import { InputSanitizer } from "./middlewares/input-sanitizer";

@Module({
  providers: [
    AdaptiveRateLimiter,
    AuditLogger,
    CorsGuard,
    CspGuard,
    CsrfProtector,
    InputSanitizer,
  ],
  exports: [
    AdaptiveRateLimiter,
    AuditLogger,
    CorsGuard,
    CspGuard,
    CsrfProtector,
    InputSanitizer,
  ],
})
export class SecurityModule {}
