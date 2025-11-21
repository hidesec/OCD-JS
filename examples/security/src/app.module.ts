import { Module } from "@ocd-js/core";
import {
  AdaptiveRateLimiter,
  AuditLogger,
  SecurityModule,
} from "@ocd-js/security";
import { SecurityController } from "./app.controller";

@Module({
  imports: [SecurityModule],
  controllers: [SecurityController],
  providers: [
    {
      token: AdaptiveRateLimiter,
      useFactory: () =>
        new AdaptiveRateLimiter({ windowMs: 5_000, baseLimit: 1 }),
    },
    {
      token: AuditLogger,
      useFactory: () =>
        new AuditLogger({
          log(entry) {
            console.log("audit entry", entry);
          },
        }),
    },
  ],
})
export class AppModule {}
