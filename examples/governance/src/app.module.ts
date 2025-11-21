import { Module } from "@ocd-js/core";
import { GovernanceModule } from "@ocd-js/governance";
import { ComplianceService } from "./compliance.service";

@Module({
  imports: [GovernanceModule],
  providers: [ComplianceService],
  exports: [ComplianceService],
})
export class AppModule {}
