const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const cliEntry = path.resolve(__dirname, "../packages/cli/dist/index.js");

test("ocd new scaffolds a layered application", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ocd-cli-"));
  const projectName = "Scaffold Portal";
  const slug = projectName
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();

  try {
    runCli([
      "new",
      projectName,
      "--directory",
      tempRoot,
      "--skip-install",
      "--force",
    ]);

    const projectDir = path.join(tempRoot, slug);
    const packageJson = JSON.parse(
      await fs.readFile(path.join(projectDir, "package.json"), "utf8"),
    );
    assert.equal(packageJson.name, slug);
    assert.ok(packageJson.dependencies["ocd-js"], "ocd-js dependency missing");

    const controllerPath = path.join(
      projectDir,
      "src",
      "modules",
      "app",
      "app.controller.ts",
    );
    const controllerContent = await fs.readFile(controllerPath, "utf8");
    assert.match(controllerContent, /@Controller/);
    assert.match(controllerContent, /@Get/);
    assert.match(controllerContent, /async readStatus/);

    const bootstrapContent = await fs.readFile(
      path.join(projectDir, "src", "bootstrap.ts"),
      "utf8",
    );
    assert.match(bootstrapContent, /HttpAdapter/);

    const rootModule = await fs.readFile(
      path.join(projectDir, "src", "root.module.ts"),
      "utf8",
    );
    assert.match(rootModule, /@Module/);
    assert.match(rootModule, /AppModule/);

    const eslintConfig = await fs.readFile(
      path.join(projectDir, ".eslintrc.cjs"),
      "utf8",
    );
    assert.match(eslintConfig, /@typescript-eslint/);

    const prettierConfig = await fs.readFile(
      path.join(projectDir, ".prettierrc.cjs"),
      "utf8",
    );
    assert.match(prettierConfig, /singleQuote/);

    const workflow = await fs.readFile(
      path.join(projectDir, ".github", "workflows", "ci.yml"),
      "utf8",
    );
    assert.match(workflow, /npm run lint/);

    runCli(
      [
        "generate",
        "modular",
        "InventoryEngine",
        "--path",
        path.join("src", "modules"),
        "--force",
      ],
      { cwd: projectDir },
    );

    const modularIndex = await fs.readFile(
      path.join(
        projectDir,
        "src",
        "modules",
        "inventory-engine",
        "index.ts",
      ),
      "utf8",
    );
    assert.match(modularIndex, /export \* from "\.\/inventory-engine\.module"/);

    runCli(
      [
        "generate",
        "microservice",
        "BillingWorker",
        "--path",
        path.join("src", "microservices"),
        "--force",
      ],
      { cwd: projectDir },
    );

    const microserviceFile = await fs.readFile(
      path.join(
        projectDir,
        "src",
        "microservices",
        "billing-worker",
        "billing-worker.microservice.ts",
      ),
      "utf8",
    );
    assert.match(microserviceFile, /bootstrapBillingWorkerMicroservice/);
    assert.match(microserviceFile, /class BillingWorkerWorker/);


    runCli(
      [
        "crud",
        "PortfolioRecord",
        "--path",
        path.join("src", "modules"),
        "--fields",
        "title:string,owner:string,budget:number,active:boolean",
        "--route",
        "/portfolio",
        "--force",
      ],
      { cwd: projectDir },
    );

    const crudService = await fs.readFile(
      path.join(
        projectDir,
        "src",
        "modules",
        "portfolio-record",
        "portfolio-record.service.ts",
      ),
      "utf8",
    );
    assert.match(crudService, /class PortfolioRecordService/);
    assert.match(crudService, /listRecords/);

    const crudController = await fs.readFile(
      path.join(
        projectDir,
        "src",
        "modules",
        "portfolio-record",
        "portfolio-record.controller.ts",
      ),
      "utf8",
    );
    assert.match(crudController, /@Del\("\/\:id"\)/);
    assert.match(crudController, /UseSecurity/);

    const crudSpec = await fs.readFile(
      path.join(
        projectDir,
        "src",
        "modules",
        "portfolio-record",
        "portfolio-record.spec.ts",
      ),
      "utf8",
    );
    assert.match(crudSpec, /PortfolioRecord service executes CRUD pipeline/);
    const specContent = await fs.readFile(
      path.join(
        projectDir,
        "src",
        "modules",
        "app",
        "app.controller.spec.ts",
      ),
      "utf8",
    );
    assert.match(specContent, /AppController returns status/);
    assert.match(specContent, /AppModule/);

    const upgradeResult = runCli([
      "upgrade",
      "--dry-run",
      "--packages",
      "ocd-js",
    ]);
    assert.match(upgradeResult.stdout, /npm install ocd-js@latest/);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

function runCli(args, options = {}) {
  const result = spawnSync("node", [cliEntry, ...args], {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}
