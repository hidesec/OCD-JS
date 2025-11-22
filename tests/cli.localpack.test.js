const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const cliEntry = path.resolve(__dirname, "../packages/cli/dist/index.js");

function runCli(args, options = {}) {
  const result = spawnSync(process.execPath, [cliEntry, ...args], {
    encoding: "utf8",
    stdio: "pipe",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `CLI exited with code ${result.status}:\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }
  return result;
}

test("ocd new uses local pack when available", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ocd-cli-pack-"));
  // Create a fake local pack file name matching detection pattern
  const localPack = path.join(tempRoot, "ocd-js-9.9.9.tgz");
  await fs.writeFile(localPack, "dummy", "utf8");

  const projectName = "Local Pack App";
  const slug = projectName
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();

  runCli(
    [
      "new",
      projectName,
      "--directory",
      ".",
      "--skip-install",
    ],
    { cwd: tempRoot },
  );

  const projectDir = path.join(tempRoot, slug);
  const pkgJsonPath = path.join(projectDir, "package.json");
  const pkg = JSON.parse(await fs.readFile(pkgJsonPath, "utf8"));
  assert.ok(pkg.dependencies["ocd-js"].startsWith("file:"));
  const pinned = pkg.dependencies["ocd-js"].slice("file:".length);
  // Ensure path points to the tempRoot pack
  assert.equal(path.resolve(projectDir, pinned), localPack);
});
