import { Module } from "@ocd-js/core";
import { AppController } from "./app.controller";

@Module({
  controllers: [AppController],
})
export class AppModule {}
