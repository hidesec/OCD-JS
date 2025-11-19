#!/usr/bin/env node
import path from "node:path";
import { createApplicationContext } from "@ocd-js/core";
import { generateApiDocs, renderPluginGuidelines } from "./index";

const args = process.argv.slice(2);
const moduleArgIndex = args.indexOf("--module");
const modulePath =
  (moduleArgIndex >= 0 ? args[moduleArgIndex + 1] : undefined) ??
  path.join(
    process.cwd(),
    "examples",
    "server",
    "dist",
    "user",
    "user.module.js",
  );

const run = async () => {
  const imported = await import(path.resolve(modulePath));
  const moduleRef = imported.AppModule ?? imported.default;
  if (!moduleRef) {
    throw new Error(`Module not found at ${modulePath}`);
  }
  const context = createApplicationContext(moduleRef);
  const docs = generateApiDocs(context);
  console.log(JSON.stringify(docs, null, 2));
  console.log(renderPluginGuidelines());
};

run().catch((error) => {
  console.error("Failed to generate docs", error);
  process.exit(1);
});
