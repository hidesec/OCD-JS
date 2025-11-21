import { Module } from "@ocd-js/core";
import { AuthModule } from "@ocd-js/auth";
import { AuthFlowController } from "./auth.controller";

@Module({
  imports: [AuthModule],
  controllers: [AuthFlowController],
})
export class AppModule {}
