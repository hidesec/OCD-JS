import { createApplicationContext } from "@ocd-js/core";
import { AppModule } from "./app.module";
import { ComplianceService } from "./compliance.service";

async function bootstrap() {
  const app = createApplicationContext(AppModule);
  const request = app.beginRequest();
  const compliance = request.container.resolve(ComplianceService);
  const report = await compliance.runGovernanceSweep();
  console.log("governance report", report);
}

bootstrap().catch((error) => {
  console.error("Governance example failed", error);
  process.exit(1);
});
