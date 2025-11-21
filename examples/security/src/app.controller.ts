import { Controller, Post } from "@ocd-js/core";
import {
  AdaptiveRateLimiter,
  AuditLogger,
  CsrfProtector,
  InputSanitizer,
  UseSecurity,
} from "@ocd-js/security";

export interface CommentInput {
  message: string;
  tags?: string[];
}

@Controller({ basePath: "/security", version: "v1" })
export class SecurityController {
  @Post("/comments")
  @UseSecurity(InputSanitizer, CsrfProtector, AdaptiveRateLimiter, AuditLogger)
  submitComment(body: CommentInput) {
    return {
      acceptedAt: new Date().toISOString(),
      sanitizedBody: body,
    };
  }
}
