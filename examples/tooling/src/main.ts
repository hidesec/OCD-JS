import { promises as fs } from "node:fs";
import path from "node:path";
import { createApplicationContext } from "@ocd-js/core";
import {
  analyzeWorkspace,
  generateApiDocs,
  renderPluginGuidelines,
  runUpgradeAssistant,
} from "@ocd-js/tooling";
import { AppModule } from "./app.module";

async function bootstrap() {
  const context = createApplicationContext(AppModule);

  const docs = generateApiDocs(context);
  const docsPath = path.resolve(__dirname, "../dist/api-docs.json");
  await fs.mkdir(path.dirname(docsPath), { recursive: true });
  await fs.writeFile(docsPath, JSON.stringify(docs, null, 2), "utf8");
  console.log("API docs written to", docsPath);

  const workspaceRoot = path.resolve(__dirname, "../../..");
  const report = analyzeWorkspace(workspaceRoot);
  console.log("Upgrade assistant report:");
  report.entries.forEach((entry) =>
    console.log(
      ` - ${entry.name}: ${entry.current ?? "(missing)"} -> ${entry.recommended} (${entry.action})`,
    ),
  );
  console.log("\nRunning upgrade assistant for workspace root...\n");
  runUpgradeAssistant(workspaceRoot);

  console.log("\nPlugin authoring guidelines:\n");
  console.log(renderPluginGuidelines());
}

bootstrap().catch((error) => {
  console.error("Tooling example failed", error);
  process.exit(1);
});
