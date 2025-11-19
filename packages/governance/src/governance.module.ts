import { Module } from "@ocd-js/core";
import { PolicyService } from "./policy-service";

export const POLICY_SERVICE = Symbol.for("OCD_POLICY_SERVICE");

@Module({
  providers: [
    {
      token: POLICY_SERVICE,
      useClass: PolicyService,
    },
  ],
  exports: [POLICY_SERVICE],
})
export class GovernanceModule {}
