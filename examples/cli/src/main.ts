import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const cliEntry = path.resolve(__dirname, "../../packages/cli/dist/index.js");
const sandboxRoot = path.resolve(__dirname, "../cli/.sandbox");
const projectName = "demo cli app";

async function main() {
  await fs.rm(sandboxRoot, { recursive: true, force: true });
  await fs.mkdir(sandboxRoot, { recursive: true });

  console.log("Using CLI entry", cliEntry);

  runCli(["new", projectName, "--directory", sandboxRoot, "--force"]);

  const slug = projectName.replace(/\s+/g, "-").toLowerCase();
  const projectDir = path.join(sandboxRoot, slug);

  runCli(
    [
      "generate",
      "module",
      "Inventory",
      "--path",
      path.join("src", "modules"),
      "--force",
    ],
    { cwd: projectDir },
  );

  runCli(
    [
      "generate",
      "service",
      "AuditTrail",
      "--path",
      path.join("src", "shared"),
      "--force",
    ],
    { cwd: projectDir },
  );

  const controllerPath = path.join(
    projectDir,
    "src",
    "modules",
    "inventory",
    "inventory.controller.ts",
  );
  const controllerPreview = await fs.readFile(controllerPath, "utf-8");

  console.log("Generated controller preview:\n", controllerPreview);
  console.log("Project tree under", projectDir);
  console.log(await listDir(projectDir));
}

function runCli(args: string[], options: { cwd?: string } = {}) {
  console.log("$ ocd", args.join(" "));
  const result = spawnSync("node", [cliEntry, ...args], {
    cwd: options.cwd ?? process.cwd(),
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(`CLI command failed: ${args.join(" ")}`);
  }
}

async function listDir(dir: string, indent = 0): Promise<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const lines = await Promise.all(
    entries.map(async (entry) => {
      const prefix =
        " ".repeat(indent) + (entry.isDirectory() ? "[dir]" : "[file]");
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return `${prefix} ${entry.name}\n${await listDir(fullPath, indent + 2)}`;
      }
      return `${prefix} ${entry.name}`;
    }),
  );
  return lines.join("\n");
}

main().catch((error) => {
  console.error("CLI example failed", error);
  process.exit(1);
});
