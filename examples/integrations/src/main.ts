import { createApplicationContext } from "@ocd-js/core";
import { CLOUD_SECRETS } from "@ocd-js/integrations";
import { AppModule } from "./app.module";
import { IntegrationService } from "./integration.service";

async function bootstrap() {
  const app = createApplicationContext(AppModule);
  const request = app.beginRequest();
  const secrets = request.container.resolve(CLOUD_SECRETS) as {
    setSecret?: (key: string, value: string) => void;
  };
  secrets?.setSecret?.("third-party/api-key", "demo-api-key-123");

  const service = request.container.resolve(IntegrationService);
  const report = await service.runScenario();
  console.log("integration pipelines executed", report);
}

bootstrap().catch((error) => {
  console.error("Integrations example failed", error);
  process.exit(1);
});
