#!/usr/bin/env node
import { Command } from "commander";
import { promises as fs } from "node:fs";
import path from "node:path";
import kleur from "kleur";

type ArtifactType = "module" | "service" | "controller";

const program = new Command();

program
  .name("ocd")
  .description(
    "OCD-JS companion CLI for scaffolding applications, modules, services, and controllers",
  )
  .version("0.1.0");

program
  .command("new")
  .argument("<name>", "Project folder name")
  .option("--directory <path>", "Parent directory", ".")
  .option("--force", "Overwrite existing files", false)
  .action(
    async (name: string, options: { directory?: string; force?: boolean }) => {
      const slug = toKebabCase(name);
      const targetDir = path.resolve(
        process.cwd(),
        options.directory ?? ".",
        slug,
      );
      await scaffoldProject(targetDir, slug, options.force ?? false);
    },
  );

program
  .command("generate")
  .alias("g")
  .argument("<type>", "Artifact type: module|service|controller")
  .argument("<name>", "Artifact name (PascalCase suggested)")
  .option("--path <path>", "Base directory for generated files", "src/modules")
  .option("--force", "Overwrite files when they already exist", false)
  .action(
    async (
      type: string,
      name: string,
      options: { path: string; force?: boolean },
    ) => {
      const artifact = normalizeType(type);
      const pascal = toPascalCase(name);
      const kebab = toKebabCase(name);
      const baseDir = path.resolve(
        process.cwd(),
        options.path ?? "src/modules",
      );
      const targetDir =
        artifact === "module" ? path.join(baseDir, kebab) : baseDir;
      await fs.mkdir(targetDir, { recursive: true });

      const actions: Array<[string, string]> = [];
      if (artifact === "module") {
        const moduleDir = path.join(baseDir, kebab);
        await fs.mkdir(moduleDir, { recursive: true });
        actions.push([
          path.join(moduleDir, `${kebab}.module.ts`),
          moduleTemplate(pascal, kebab),
        ]);
        actions.push([
          path.join(moduleDir, `${kebab}.service.ts`),
          serviceTemplate(pascal, kebab),
        ]);
        actions.push([
          path.join(moduleDir, `${kebab}.controller.ts`),
          controllerTemplate(pascal, kebab),
        ]);
      } else if (artifact === "service") {
        actions.push([
          path.join(targetDir, `${kebab}.service.ts`),
          serviceTemplate(pascal, kebab),
        ]);
      } else {
        actions.push([
          path.join(targetDir, `${kebab}.controller.ts`),
          controllerTemplate(pascal, kebab),
        ]);
      }

      for (const [filePath, content] of actions) {
        await writeArtifact(filePath, content, options.force ?? false);
      }
    },
  );

program
  .command("migrate")
  .argument("[direction]", "up or down", "up")
  .requiredOption("--entry <path>", "Path to compiled migrations entry file")
  .option("--driver <driver>", "json or memory driver", "json")
  .option(
    "--data <file>",
    "JSON driver data file (only for json driver)",
    "orm-data.json",
  )
  .action(
    async (
      direction: string,
      options: { entry: string; driver?: string; data?: string },
    ) => {
      const target = path.resolve(process.cwd(), options.entry);
      await import(target);
      const orm = await import("@ocd-js/orm");
      const driver = createDriver(orm, options);
      const runner = new orm.MigrationRunner(driver);
      await runner.run(direction === "down" ? "down" : "up");
      console.log(
        kleur.green(
          `migrations ${direction === "down" ? "rolled back" : "applied"}`,
        ),
      );
    },
  );

program
  .command("schema:plan")
  .requiredOption(
    "--entry <path>",
    "Path to compiled entry file registering entities",
  )
  .option(
    "--driver <driver>",
    "json|memory|sqlite|postgres|mysql driver",
    "json",
  )
  .option(
    "--data <file>",
    "JSON driver data file (for json driver)",
    "orm-data.json",
  )
  .option("--dialect <dialect>", "Target SQL dialect: sqlite|postgres|mysql")
  .action(
    async (options: {
      entry: string;
      driver?: string;
      data?: string;
      dialect?: string;
    }) => {
      const target = path.resolve(process.cwd(), options.entry);
      await import(target);
      const orm = await import("@ocd-js/orm");
      const driver = createDriver(orm, options);
      const differ = new orm.SchemaDiffer(driver);
      const plan = await differ.diff();
      if (!plan.changes.length) {
        console.log(kleur.green("Schema already synchronized."));
        return;
      }
      const dialect = normalizeDialect(options.dialect, options.driver);
      const statements = orm.generateSchemaStatements(plan, { dialect });
      console.log(
        kleur.cyan(
          `Schema plan (${dialect}) - ${statements.length} statement${statements.length === 1 ? "" : "s"}:`,
        ),
      );
      statements.forEach((statement) => {
        console.log(kleur.gray("-"), statement);
      });
    },
  );

program.parseAsync(process.argv).catch((error) => {
  console.error(
    kleur.red(error instanceof Error ? error.message : String(error)),
  );
  process.exit(1);
});

const writeArtifact = async (
  filePath: string,
  content: string,
  force: boolean,
) => {
  const exists = await fileExists(filePath);
  if (exists && !force) {
    console.log(
      kleur.yellow(`skip  ${path.relative(process.cwd(), filePath)}`),
    );
    return;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
  console.log(kleur.green(`write ${path.relative(process.cwd(), filePath)}`));
};

const fileExists = async (filePath: string) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const normalizeType = (value: string): ArtifactType => {
  const normalized = value.toLowerCase();
  if (
    normalized === "module" ||
    normalized === "service" ||
    normalized === "controller"
  ) {
    return normalized;
  }
  throw new Error(
    `Unsupported artifact type "${value}". Use module|service|controller`,
  );
};

const toPascalCase = (value: string) =>
  value
    .replace(/[-_\s]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map(
      (segment) =>
        segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase(),
    )
    .join("");

const toKebabCase = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();

const moduleTemplate = (
  pascal: string,
  kebab: string,
) => `import { Module } from "@ocd-js/core";
import { ${pascal}Controller } from "./${kebab}.controller";
import { ${pascal}Service } from "./${kebab}.service";

@Module({
  controllers: [${pascal}Controller],
  providers: [${pascal}Service],
})
export class ${pascal}Module {}
`;

const serviceTemplate = (
  pascal: string,
  _kebab: string,
) => `import { Injectable } from "@ocd-js/core";

@Injectable()
export class ${pascal}Service {
  findAll() {
    return [];
  }
}
`;

const controllerTemplate = (
  pascal: string,
  kebab: string,
) => `import { Controller, Get, Inject } from "@ocd-js/core";
import { ${pascal}Service } from "./${kebab}.service";

@Controller({ basePath: "/${kebab}" })
export class ${pascal}Controller {
  constructor(@Inject(${pascal}Service) private readonly service: ${pascal}Service) {}

  @Get("/")
  list() {
    return this.service.findAll();
  }
}
`;

const scaffoldProject = async (root: string, slug: string, force: boolean) => {
  const plan: Array<[string, string]> = [
    ["package.json", projectPackageJson(slug)],
    ["tsconfig.json", projectTsconfig()],
    ["src/app.module.ts", projectAppModuleTemplate()],
    ["src/app.service.ts", projectAppServiceTemplate()],
    ["src/app.controller.ts", projectAppControllerTemplate()],
    ["src/main.ts", projectMainTemplate()],
    [".gitignore", gitignoreTemplate()],
  ];

  for (const [relative, content] of plan) {
    await writeArtifact(path.join(root, relative), content, force);
  }
};

const projectPackageJson = (slug: string) => `{
  "name": "${slug}",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/main.js",
    "dev": "ts-node-esm src/main.ts"
  },
  "dependencies": {
    "@ocd-js/core": "^1.1.2-beta"
  },
  "devDependencies": {
    "ts-node": "^10.9.2",
    "typescript": "^5.4.5"
  }
}
`;

const projectTsconfig = () => `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ES2020",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": false
  },
  "include": ["src"]
}
`;

const projectAppModuleTemplate = () => `import { Module } from "@ocd-js/core";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";

@Module({
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
`;

const projectAppServiceTemplate =
  () => `import { Injectable } from "@ocd-js/core";

@Injectable()
export class AppService {
  getMessage() {
    return "Hello from OCD-JS";
  }
}
`;

const projectAppControllerTemplate =
  () => `import { Controller, Get, Inject } from "@ocd-js/core";
import { AppService } from "./app.service";

@Controller({ basePath: "/hello", version: "v1" })
export class AppController {
  constructor(@Inject(AppService) private readonly service: AppService) {}

  @Get("/")
  handle() {
    return { message: this.service.getMessage() };
  }
}
`;

const projectMainTemplate =
  () => `import { createApplicationContext } from "@ocd-js/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = createApplicationContext(AppModule);
  console.log("Available routes", app.routes);
}

bootstrap().catch((error) => {
  console.error("Failed to bootstrap", error);
  process.exit(1);
});
`;

const gitignoreTemplate = () => `node_modules
dist
.DS_Store
*.log
`;

function createDriver(
  orm: typeof import("@ocd-js/orm"),
  options: { driver?: string; data?: string },
) {
  if ((options.driver ?? "json").toLowerCase() === "memory") {
    return new orm.MemoryDatabaseDriver();
  }
  return new orm.JsonDatabaseDriver({
    filePath: path.resolve(process.cwd(), options.data ?? "orm-data.json"),
  });
}

function normalizeDialect(
  dialect: string | undefined,
  driver?: string,
): "sqlite" | "postgres" | "mysql" {
  if (dialect && isDialect(dialect)) {
    return dialect;
  }
  if (driver && isDialect(driver)) {
    return driver as "sqlite" | "postgres" | "mysql";
  }
  return "sqlite";
}

const isDialect = (value: string): value is "sqlite" | "postgres" | "mysql" =>
  ["sqlite", "postgres", "mysql"].includes(value.toLowerCase());
