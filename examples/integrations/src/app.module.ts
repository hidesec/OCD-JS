import { Module } from "@ocd-js/core";
import {
  CloudModule,
  DatabaseModule,
  QueueModule,
  StorageModule,
} from "@ocd-js/integrations";
import { IntegrationService } from "./integration.service";

@Module({
  imports: [DatabaseModule, QueueModule, StorageModule, CloudModule],
  providers: [IntegrationService],
  exports: [IntegrationService],
})
export class AppModule {}
