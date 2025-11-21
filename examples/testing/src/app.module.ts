import { Module } from "@ocd-js/core";
import { PerformanceModule } from "@ocd-js/performance";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { APP_MESSAGE } from "./tokens";

@Module({
  imports: [PerformanceModule],
  controllers: [AppController],
  providers: [
    AppService,
    {
      token: APP_MESSAGE,
      useValue: "Hello from testing example",
    },
  ],
})
export class AppModule {}
