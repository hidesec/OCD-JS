#!/usr/bin/env node
import { Command } from "commander";
import { promises as fs } from "node:fs";
import path from "node:path";
import kleur from "kleur";

type ArtifactType = "module" | "service" | "controller";

const program = new Command();

program
  .name("ocd")
  .description("OCD-JS companion CLI for scaffolding modules, services, and controllers")
  .version("0.1.0");

program
  .command("generate")
  .alias("g")
  .argument("<type>", "Artifact type: module|service|controller")
  .argument("<name>", "Artifact name (PascalCase suggested)")
  .option("--path <path>", "Base directory for generated files", "src/modules")
  .option("--force", "Overwrite files when they already exist", false)
  .action(async (type: string, name: string, options: { path: string; force?: boolean }) => {
    const artifact = normalizeType(type);
    const pascal = toPascalCase(name);
    const kebab = toKebabCase(name);
    const baseDir = path.resolve(process.cwd(), options.path ?? "src/modules");
    const targetDir = artifact === "module" ? path.join(baseDir, kebab) : baseDir;
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
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(kleur.red(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});

const writeArtifact = async (filePath: string, content: string, force: boolean) => {
  const exists = await fileExists(filePath);
  if (exists && !force) {
    console.log(kleur.yellow(`skip  ${path.relative(process.cwd(), filePath)}`));
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
  if (normalized === "module" || normalized === "service" || normalized === "controller") {
    return normalized;
  }
  throw new Error(`Unsupported artifact type "${value}". Use module|service|controller`);
};

const toPascalCase = (value: string) =>
  value
    .replace(/[-_\s]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join("");

const toKebabCase = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();

const moduleTemplate = (pascal: string, kebab: string) => `import { Module } from "@ocd-js/core";
import { ${pascal}Controller } from "./${kebab}.controller";
import { ${pascal}Service } from "./${kebab}.service";

@Module({
  controllers: [${pascal}Controller],
  providers: [${pascal}Service],
})
export class ${pascal}Module {}
`;

const serviceTemplate = (pascal: string, _kebab: string) => `import { Injectable } from "@ocd-js/core";

@Injectable()
export class ${pascal}Service {
  findAll() {
    return [];
  }
}
`;

const controllerTemplate = (pascal: string, kebab: string) => `import { Controller, Get, Inject } from "@ocd-js/core";
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
