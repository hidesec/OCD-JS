import { Module } from "@ocd-js/core";
import { AuthModule, AUTH_OPTIONS } from "@ocd-js/auth";
import { SecurityModule } from "@ocd-js/security";
import { LOGGING_OPTIONS, ObservabilityModule } from "@ocd-js/observability";
import { PerformanceModule } from "@ocd-js/performance";
import {
  DatabaseModule,
  QueueModule,
  StorageModule,
  CloudModule,
} from "@ocd-js/integrations";
import { PluginsModule } from "@ocd-js/plugins";
import { GovernanceModule } from "@ocd-js/governance";
import { FeatureFlagsModule, FEATURE_FLAG_CONFIG } from "@ocd-js/feature-flags";
import { loadAppConfig } from "../config/app-config";
import { ObservabilityController } from "../observability/observability.controller";
import { UserController } from "./user.controller";
import { UserService } from "./user.service";
import { APP_CONFIG } from "./tokens";

export { APP_CONFIG } from "./tokens";

@Module({
  imports: [
    SecurityModule,
    AuthModule,
    ObservabilityModule,
    PerformanceModule,
    PluginsModule,
    DatabaseModule,
    QueueModule,
    StorageModule,
    CloudModule,
    GovernanceModule,
    FeatureFlagsModule,
  ],
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
    {
      token: FEATURE_FLAG_CONFIG,
      useValue: {
        "beta-users": true,
      },
    },
    UserService,
  ],
})
export class AppModule {}
