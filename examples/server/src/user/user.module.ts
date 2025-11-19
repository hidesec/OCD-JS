import { Module } from "@ocd-js/core";
import { AuthModule, AUTH_OPTIONS } from "@ocd-js/auth";
import { SecurityModule } from "@ocd-js/security";
import { LOGGING_OPTIONS, ObservabilityModule } from "@ocd-js/observability";
import { PerformanceModule } from "@ocd-js/performance";
import { loadAppConfig } from "../config/app-config";
import { ObservabilityController } from "../observability/observability.controller";
import { UserController } from "./user.controller";
import { UserService } from "./user.service";

export const APP_CONFIG = Symbol("APP_CONFIG");

@Module({
  imports: [SecurityModule, AuthModule, ObservabilityModule, PerformanceModule],
  controllers: [UserController, ObservabilityController],
  providers: [
    {
      token: APP_CONFIG,
      useValue: loadAppConfig(),
    },
    {
      token: AUTH_OPTIONS,
      useValue: {
        jwtSecret: "local-dev-secret",
        jwtTtlSeconds: 3600,
        sessionTtlSeconds: 3600,
      },
    },
    {
      token: LOGGING_OPTIONS,
      useValue: {
        serviceName: "ocd-example-server",
        logLevel: "debug",
      },
    },
    UserService,
  ],
})
export class AppModule {}
