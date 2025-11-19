import { Module } from "@ocd-js/core";
import { loadAppConfig } from "../config/app-config";
import { UserController } from "./user.controller";
import { UserService } from "./user.service";

export const APP_CONFIG = Symbol("APP_CONFIG");

@Module({
  controllers: [UserController],
  providers: [
    {
      token: APP_CONFIG,
      useValue: loadAppConfig(),
    },
    UserService,
  ],
})
export class AppModule {}
