import { Module } from "@ocd-js/core";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { APP_MESSAGE } from "./tokens";

@Module({
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
