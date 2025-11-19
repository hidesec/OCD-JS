import fs from "node:fs";
import path from "node:path";
import semver from "semver";

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
    return {
      name,
      current,
      recommended: range,
      action:
        current &&
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
