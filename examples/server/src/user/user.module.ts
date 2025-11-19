import { Module } from "@ocd-js/core";
import { AuthModule, AUTH_OPTIONS } from "@ocd-js/auth";
import { SecurityModule } from "@ocd-js/security";
import { loadAppConfig } from "../config/app-config";
import { UserController } from "./user.controller";
import { UserService } from "./user.service";

export const APP_CONFIG = Symbol("APP_CONFIG");

@Module({
  imports: [SecurityModule, AuthModule],
  controllers: [UserController],
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
    UserService,
  ],
})
export class AppModule {}
