import { Module } from "@ocd-js/core";
import { loadAppConfig } from "./config";
import { ProjectController } from "./app.controller";
import { ProjectService } from "./project.service";
import { AdminGuard } from "./guards";
import { APP_CONFIG, LOGGER, AppLogger } from "./tokens";

const appConfig = loadAppConfig();

const logger: AppLogger = {
  info(message, meta) {
    console.log(`[core-app] ${message}`, meta ?? {});
  },
  warn(message, meta) {
    console.warn(`[core-app] ${message}`, meta ?? {});
  },
};

@Module({
  providers: [
    ProjectService,
    AdminGuard,
    { token: APP_CONFIG, useValue: appConfig },
    { token: LOGGER, useValue: logger },
  ],
  controllers: [ProjectController],
  exports: [APP_CONFIG, LOGGER],
})
export class AppModule {}
