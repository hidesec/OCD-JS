import fs from "node:fs";
import path from "node:path";
import semver from "semver";
import type { ApplicationContext, CompiledRoute } from "@ocd-js/core";

const recommended: Record<string, string> = {
  "@ocd-js/core": "^0.1.0",
  "@ocd-js/observability": "^0.1.0",
  "@ocd-js/performance": "^0.1.0",
  "@ocd-js/plugins": "^0.1.0",
};

export interface UpgradeReportEntry {
  name: string;
  current?: string;
  recommended: string;
  action: "ok" | "upgrade";
}

export interface UpgradeReport {
  entries: UpgradeReportEntry[];
}

export const analyzeWorkspace = (
  root: string = process.cwd(),
): UpgradeReport => {
  const pkgPath = path.join(root, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const entries = Object.entries(recommended).map(([name, range]) => {
    const current = deps[name];
    const isFileProtocol = current?.startsWith("file:");
    return {
      name,
      current,
      recommended: range,
      action:
        current && !isFileProtocol &&
        semver.satisfies(semver.minVersion(current) ?? "0.0.0", range)
          ? "ok"
          : "upgrade",
    } satisfies UpgradeReportEntry;
  });
  return { entries };
};

export const runUpgradeAssistant = (root: string = process.cwd()) => {
  const report = analyzeWorkspace(root);
  const pending = report.entries.filter((entry) => entry.action === "upgrade");
  if (!pending.length) {
    console.log("All OCD-JS packages are up to date.");
    return;
  }
  console.log("Suggested upgrades:");
  pending.forEach((entry) => {
    console.log(
      ` - ${entry.name}: ${entry.current ?? "(missing)"} -> ${entry.recommended}`,
    );
  });
};

export interface ApiDocs {
  generatedAt: string;
  routes: ApiRouteDoc[];
}

export interface ApiRouteDoc {
  method: CompiledRoute["method"];
  path: string;
  version: CompiledRoute["version"];
  schema?: CompiledRoute["schema"];
  tags?: string[];
}

export const generateApiDocs = (
  context: Pick<ApplicationContext, "routes">,
): ApiDocs => {
  const routes = context.routes.map((route) => ({
    method: route.method,
    path: route.path,
    version: route.version,
    schema: route.schema,
    tags: route.tags,
  }));
  return {
    generatedAt: new Date().toISOString(),
    routes,
  };
};

const pluginGuidelineEntries = [
  "Follow semantic versioning and declare compatibility in metadata",
  "Expose lifecycle hooks responsibly (register, init, ready, shutdown)",
  "Avoid mutating global state; rely on DI tokens",
  "Provide contract tests so PluginManager can validate behavior",
  "Document required environment variables and configuration options",
];

export const renderPluginGuidelines = (): string => {
  return pluginGuidelineEntries
    .map((entry, index) => `${index + 1}. ${entry}`)
    .join("\n");
};
