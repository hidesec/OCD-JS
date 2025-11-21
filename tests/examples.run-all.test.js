const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs/promises");

const workspaceRoot = path.resolve(__dirname, "..");

const EXAMPLES = [
  { name: "auth", relative: "examples/auth" },
  {
    name: "cli",
    relative: "examples/cli",
    timeoutMs: 45000,
    cleanupPaths: ["examples/cli/cli"],
  },
  { name: "contract-testing", relative: "examples/contract-testing" },
  { name: "core", relative: "examples/core" },
  {
    name: "dev-server",
    relative: "examples/dev-server",
    timeoutMs: 35000,
    cleanupPaths: ["examples/dev-server/mock-app/dist"],
  },
  { name: "feature-flags", relative: "examples/feature-flags" },
  { name: "governance", relative: "examples/governance" },
  { name: "integrations", relative: "examples/integrations" },
  { name: "observability", relative: "examples/observability" },
  { name: "orm", relative: "examples/orm", timeoutMs: 45000 },
  { name: "performance", relative: "examples/performance", timeoutMs: 35000 },
  { name: "plugins-audit", relative: "examples/plugins/audit" },
  { name: "security", relative: "examples/security" },
  { name: "server", relative: "examples/server", timeoutMs: 35000 },
  { name: "testing", relative: "examples/testing" },
  {
    name: "tooling",
    relative: "examples/tooling",
    cleanupPaths: ["examples/tooling/dist/api-docs.json"],
  },
].map((example) => ({
  ...example,
  entry: path.resolve(workspaceRoot, example.relative, "dist", "main.js"),
  cwd: path.resolve(workspaceRoot, example.relative),
  cleanupPaths: (example.cleanupPaths ?? []).map((target) =>
    path.resolve(workspaceRoot, target),
  ),
}));

test(
  "all example entrypoints execute successfully",
  { timeout: 180_000 },
  async () => {
    for (const example of EXAMPLES) {
      await ensureEntryExists(example.entry, example.name);
      const result = await runNodeScript(example.entry, {
        cwd: example.cwd,
        timeoutMs: example.timeoutMs,
      }).finally(() => cleanupArtifacts(example.cleanupPaths));

      assert.ok(!result.timedOut, formatFailure(example, result));
      assert.equal(result.code, 0, formatFailure(example, result));
    }
  },
);

async function ensureEntryExists(entry, name) {
  try {
    await fs.access(entry);
  } catch (error) {
    throw new Error(`Example ${name} entry missing at ${entry}: ${error}`);
  }
}

function runNodeScript(entry, { cwd, timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry], {
      cwd,
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV ?? "test",
        OCD_EXAMPLES_CI: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let completed = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      if (completed) return;
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs ?? 20000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      completed = true;
      resolve({ code, signal, stdout, stderr, timedOut });
    });
  });
}

async function cleanupArtifacts(paths) {
  if (!paths?.length) {
    return;
  }
  await Promise.all(
    paths.map((target) =>
      fs.rm(target, { recursive: true, force: true }).catch(() => undefined),
    ),
  );
}

function formatFailure(example, result) {
  return `Example ${example.name} failed${
    result.timedOut ? " (timed out)" : ""
  }\nexit: ${result.code ?? "unknown"}\nsignal: ${result.signal ?? "none"}\nstdout:\n${result.stdout}\n----\nstderr:\n${result.stderr}`;
}
