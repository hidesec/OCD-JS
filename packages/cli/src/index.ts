#!/usr/bin/env node
import { Command } from "commander";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import kleur from "kleur";

type ArtifactType =
  | "module"
  | "service"
  | "controller"
  | "modular"
  | "microservice";
type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

type CrudFieldType = "string" | "number" | "boolean";

interface CrudFieldDefinition {
  name: string;
  property: string;
  pascal: string;
  type: CrudFieldType;
}

interface DriverCliOptions {
  driver?: string;
  data?: string;
  sqliteFile?: string;
  url?: string;
  host?: string;
  port?: string;
  user?: string;
  password?: string;
  database?: string;
  ssl?: string;
}

const DEFAULT_CRUD_FIELDS = "title:string,status:string";

type MigrateCommandOptions = DriverCliOptions & { entry: string };
type SchemaPlanOptions = DriverCliOptions & { entry: string; dialect?: string };
type SeedCommandOptions = DriverCliOptions & {
  entry: string;
  tags?: string;
  only?: string;
};

const program = new Command();

program
  .name("ocd")
  .description(
    "OCD-JS companion CLI for scaffolding applications, modules, services, and controllers",
  )
  .version("0.1.0");

program
  .command("upgrade")
  .description(
    "Upgrade OCD-JS workspace packages to the latest published versions via npm",
  )
  .option("--tag <tag>", "npm dist-tag to install (default: latest)", "latest")
  .option(
    "--packages <list>",
    "Comma-separated list of packages to upgrade (defaults to ocd-js/*)",
  )
  .option("--dry-run", "Print the npm commands without executing them", false)
  .action(
    async (options: { tag?: string; packages?: string; dryRun?: boolean }) => {
      const targetTag = options.tag ?? "latest";
      const pkgs = resolveUpgradePackages(options.packages);
      if (!pkgs.length) {
        console.log(kleur.yellow("No packages resolved for upgrade."));
        return;
      }
      console.log(
        kleur.cyan(
          `Upgrading packages (${pkgs.join(", ")}) to tag ${targetTag}...`,
        ),
      );
      if (options.dryRun) {
        console.log(
          kleur.yellow(
            `Dry run: npm install ${pkgs
              .map((pkg) => `${pkg}@${targetTag}`)
              .join(" ")}`,
          ),
        );
        return;
      }
      await runNpmInstall(pkgs, targetTag);
      console.log(kleur.green("Upgrade completed."));
    },
  );

program
  .command("help")
  .description("Display OCD-JS CLI usage information")
  .action(() => {
    program.outputHelp();
    console.log("");
    console.log("Additional commands:");
    console.log("  ocd crud ResourceName --fields title:string,status:string");
    console.log(
      "  ocd new <name> --local-pack ./ocd-js-*.tgz   # scaffold using local pack",
    );
  });

program
  .command("new")
  .argument("<name>", "Project folder name")
  .option("--directory <path>", "Parent directory", ".")
  .option("--force", "Overwrite existing files", false)
  .option("--local-pack <path>", "Path to local ocd-js .tgz pack to use")
  .option(
    "--package-manager <manager>",
    "Preferred package manager (npm|pnpm|yarn|bun)",
    "npm",
  )
  .option(
    "--skip-install",
    "Skip installing dependencies (installs by default)",
    false,
  )
  .action(
    async (
      name: string,
      options: {
        directory?: string;
        force?: boolean;
        localPack?: string;
        packageManager?: string;
        skipInstall?: boolean;
      },
    ) => {
      const slug = toKebabCase(name);
      const targetDir = path.resolve(
        process.cwd(),
        options.directory ?? ".",
        slug,
      );
      const manager = normalizePackageManager(options.packageManager);
      await scaffoldProject(targetDir, slug, options.force ?? false);
      const detectedPack = await resolveLocalPack(options.localPack);
      if (detectedPack) {
        await pinLocalPackDependency(targetDir, detectedPack);
        console.log(
          kleur.green(
            `Using local pack: ${path.relative(targetDir, detectedPack)}`,
          ),
        );
      }
      if (!options.skipInstall) {
        await installDependencies(targetDir, manager);
      } else {
        console.log(
          kleur.yellow(
            `Skipped installing dependencies. Run ${manager} install inside ${slug} when ready.`,
          ),
        );
      }
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
      const defaultBase =
        artifact === "microservice" ? "src/microservices" : "src/modules";
      const baseDir = path.resolve(process.cwd(), options.path ?? defaultBase);
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
      } else if (artifact === "modular") {
        const featureDir = path.join(baseDir, kebab);
        await fs.mkdir(featureDir, { recursive: true });
        actions.push([
          path.join(featureDir, `${kebab}.module.ts`),
          moduleTemplate(pascal, kebab),
        ]);
        actions.push([
          path.join(featureDir, `${kebab}.service.ts`),
          serviceTemplate(pascal, kebab),
        ]);
        actions.push([
          path.join(featureDir, `${kebab}.controller.ts`),
          controllerTemplate(pascal, kebab),
        ]);
        actions.push([
          path.join(featureDir, `${kebab}.types.ts`),
          modularContractsTemplate(pascal),
        ]);
        actions.push([
          path.join(featureDir, `index.ts`),
          modularIndexTemplate(kebab),
        ]);
      } else if (artifact === "service") {
        actions.push([
          path.join(targetDir, `${kebab}.service.ts`),
          serviceTemplate(pascal, kebab),
        ]);
      } else if (artifact === "microservice") {
        const microDir = path.join(baseDir, kebab);
        await fs.mkdir(microDir, { recursive: true });
        actions.push([
          path.join(microDir, `${kebab}.microservice.ts`),
          microserviceTemplate(pascal, kebab),
        ]);
        actions.push([
          path.join(microDir, `index.ts`),
          microserviceIndexTemplate(kebab),
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
  .command("crud")
  .description(
    "Generate a full CRUD stack (entity, DTOs, repository, service, controller, module)",
  )
  .argument("<name>", "Resource name (PascalCase suggested)")
  .option("--path <path>", "Base directory for generated files", "src/modules")
  .option("--route <path>", "HTTP base path (defaults to kebab-case resource)")
  .option(
    "--fields <fields>",
    "Comma-separated list of fields (e.g. title:string,amount:number,active:boolean)",
    DEFAULT_CRUD_FIELDS,
  )
  .option("--force", "Overwrite files when they already exist", false)
  .action(
    async (
      name: string,
      options: {
        path?: string;
        route?: string;
        fields?: string;
        force?: boolean;
      },
    ) => {
      const pascal = toPascalCase(name);
      if (!pascal) {
        throw new Error("Resource name is required");
      }
      const kebab = toKebabCase(name);
      const baseDir = path.resolve(
        process.cwd(),
        options.path ?? "src/modules",
      );
      const targetDir = path.join(baseDir, kebab);
      await fs.mkdir(targetDir, { recursive: true });
      const fields = parseCrudFields(options.fields ?? DEFAULT_CRUD_FIELDS);
      const route = options.route ?? `/${kebab}`;
      const plan: Array<[string, string]> = [
        [
          path.join(targetDir, `${kebab}.module.ts`),
          crudModuleTemplate(pascal, kebab),
        ],
        [
          path.join(targetDir, `${kebab}.service.ts`),
          crudServiceTemplate(pascal, kebab),
        ],
        [
          path.join(targetDir, `${kebab}.controller.ts`),
          crudControllerTemplate(pascal, kebab, route),
        ],
        [
          path.join(targetDir, "domain", `${kebab}.entity.ts`),
          crudEntityTemplate(pascal, kebab, fields),
        ],
        [
          path.join(targetDir, "domain", `${kebab}.repository.ts`),
          crudRepositoryTemplate(pascal, fields),
        ],
        [
          path.join(targetDir, "dto", `create-${kebab}.dto.ts`),
          crudCreateDtoTemplate(pascal, fields),
        ],
        [
          path.join(targetDir, "dto", `update-${kebab}.dto.ts`),
          crudUpdateDtoTemplate(pascal, fields),
        ],
        [
          path.join(targetDir, "dto", `${kebab}.query.ts`),
          crudQueryDtoTemplate(pascal, fields),
        ],
        [path.join(targetDir, "dto", "index.ts"), crudDtoIndexTemplate(kebab)],
        [
          path.join(targetDir, `${kebab}.spec.ts`),
          crudSpecTemplate(pascal, kebab, fields),
        ],
      ];
      for (const [filePath, content] of plan) {
        await writeArtifact(filePath, content, options.force ?? false);
      }
    },
  );

const migrateCommand = program
  .command("migrate")
  .argument("[direction]", "up or down", "up")
  .requiredOption("--entry <path>", "Path to compiled migrations entry file");

withDriverOptions(migrateCommand);

migrateCommand.action(
  async (direction: string, options: MigrateCommandOptions) => {
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

const seedCommand = program
  .command("seed")
  .requiredOption("--entry <path>", "Path to compiled seed entry file")
  .option("--tags <tags>", "Comma-separated list of seed tags to run")
  .option(
    "--only <ids>",
    "Comma-separated list of seeder identifiers to execute",
  );

withDriverOptions(seedCommand);

seedCommand.action(async (options: SeedCommandOptions) => {
  const target = path.resolve(process.cwd(), options.entry);
  await import(target);
  const orm = await import("@ocd-js/orm");
  const driver = createDriver(orm, options);
  const connection = new orm.Connection({ driver });
  await connection.initialize();
  const runner = new orm.SeedRunner(connection);
  await runner.run({
    tags: parseListOption(options.tags),
    only: parseListOption(options.only),
  });
  console.log(kleur.green("seeders executed"));
});

const schemaPlanCommand = program
  .command("schema:plan")
  .requiredOption(
    "--entry <path>",
    "Path to compiled entry file registering entities",
  )
  .option("--dialect <dialect>", "Target SQL dialect: sqlite|postgres|mysql");

withDriverOptions(schemaPlanCommand);

schemaPlanCommand.action(async (options: SchemaPlanOptions) => {
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

function withDriverOptions(command: Command): Command {
  return command
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
    .option(
      "--sqlite-file <path>",
      "SQLite database file path (sqlite driver)",
      "orm.sqlite",
    )
    .option("--url <url>", "SQL connection string for postgres/mysql drivers")
    .option("--host <host>", "SQL host override")
    .option("--port <port>", "SQL port override")
    .option("--user <user>", "SQL user override")
    .option("--password <password>", "SQL password override")
    .option("--database <name>", "SQL database name override")
    .option(
      "--ssl <mode>",
      "SQL SSL mode (true|false|require, defaults to driver preset)",
    );
}

function parseListOption(value?: string): string[] | undefined {
  if (!value) return undefined;
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.length ? entries : undefined;
}

const normalizeType = (value: string): ArtifactType => {
  const normalized = value.toLowerCase();
  if (
    normalized === "module" ||
    normalized === "service" ||
    normalized === "controller" ||
    normalized === "modular" ||
    normalized === "microservice"
  ) {
    return normalized;
  }
  throw new Error(
    `Unsupported artifact type "${value}". Use module|service|controller|modular|microservice`,
  );
};

const toPascalCase = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
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

const toCamelCase = (value: string) => {
  const pascal = toPascalCase(value);
  if (!pascal) return pascal;
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
};

const moduleTemplate = (
  pascal: string,
  kebab: string,
) => `import { Module } from "ocd-js/core";
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
) => `import { Injectable } from "ocd-js/core";

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
) => `import { Controller, Get, Inject } from "ocd-js/core";
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

const modularContractsTemplate = (
  pascal: string,
) => `export interface ${pascal}Record {
  id: string;
  createdAt: Date;
}

export interface ${pascal}Filter {
  search?: string;
}
`;

const modularIndexTemplate = (
  kebab: string,
) => `export * from "./${kebab}.module";
export * from "./${kebab}.service";
export * from "./${kebab}.controller";
export * from "./${kebab}.types";
`;

const microserviceTemplate = (
  pascal: string,
  kebab: string,
) => `import { Injectable, Module } from "ocd-js/core";
import { createApplicationContext } from "ocd-js/core";

@Injectable()
export class ${pascal}Worker {
  async handle(payload: unknown) {
    console.log("[${kebab}] received payload", payload);
  }
}

@Module({
  providers: [${pascal}Worker],
  exports: [${pascal}Worker],
})
export class ${pascal}MicroserviceModule {}

export async function bootstrap${pascal}Microservice() {
  const context = createApplicationContext(${pascal}MicroserviceModule);
  return context.resolve(${pascal}Worker);
}
`;

const microserviceIndexTemplate = (
  kebab: string,
) => `export * from "./${kebab}.microservice";
`;

const crudModuleTemplate = (
  pascal: string,
  kebab: string,
) => `import { Module } from "ocd-js/core";
import { ${pascal}Controller } from "./${kebab}.controller";
import { ${pascal}Service } from "./${kebab}.service";
import { ${pascal}Repository } from "./domain/${kebab}.repository";

@Module({
  controllers: [${pascal}Controller],
  providers: [${pascal}Service, ${pascal}Repository],
  exports: [${pascal}Service],
})
export class ${pascal}Module {}
`;

const crudServiceTemplate = (
  pascal: string,
  kebab: string,
) => `import { Inject, Injectable } from "ocd-js/core";
import { ${pascal}Repository } from "./domain/${kebab}.repository";
import {
  Create${pascal}Dto,
  Update${pascal}Dto,
  List${pascal}Query,
} from "./dto";

@Injectable()
export class ${pascal}Service {
  constructor(
    @Inject(${pascal}Repository)
    private readonly repository: ${pascal}Repository,
  ) {}

  listRecords(query: List${pascal}Query) {
    return this.repository.findMany(query);
  }

  getRecord(id: string) {
    return this.repository.findById(id);
  }

  createRecord(payload: Create${pascal}Dto) {
    return this.repository.create(payload);
  }

  updateRecord(id: string, payload: Update${pascal}Dto) {
    return this.repository.update(id, payload);
  }

  async removeRecord(id: string) {
    await this.repository.delete(id);
    return { removed: true };
  }
}
`;

const crudControllerTemplate = (
  pascal: string,
  kebab: string,
  route: string,
) => `import {
  Controller,
  Del,
  Get,
  Inject,
  Post,
  Put,
  ValidateBody,
  ValidateQuery,
} from "ocd-js/core";
import {
  AdaptiveRateLimiter,
  AuditLogger,
  CorsGuard,
  CsrfProtector,
  InputSanitizer,
  UseSecurity,
} from "ocd-js/security";
import {
  Create${pascal}Dto,
  Update${pascal}Dto,
  List${pascal}Query,
  list${pascal}QuerySchema,
} from "./dto";
import { ${pascal}Service } from "./${kebab}.service";

interface ${pascal}RouteContext {
  params?: Record<string, string>;
}

@Controller({ basePath: "${route}", version: "1", tags: ["${kebab}"] })
export class ${pascal}Controller {
  constructor(@Inject(${pascal}Service) private readonly service: ${pascal}Service) {}

  @Get("/")
  @ValidateQuery(list${pascal}QuerySchema)
  @UseSecurity(
    AdaptiveRateLimiter,
    InputSanitizer,
    CorsGuard,
    CsrfProtector,
    AuditLogger,
  )
  list(query: List${pascal}Query) {
    return this.service.listRecords(query);
  }

  @Get("/:id")
  @UseSecurity(
    AdaptiveRateLimiter,
    InputSanitizer,
    CorsGuard,
    CsrfProtector,
    AuditLogger,
  )
  details(_query: unknown, context: ${pascal}RouteContext) {
    return this.service.getRecord(this.resolveId(context));
  }

  @Post("/")
  @ValidateBody(Create${pascal}Dto)
  @UseSecurity(
    AdaptiveRateLimiter,
    InputSanitizer,
    CorsGuard,
    CsrfProtector,
    AuditLogger,
  )
  create(body: Create${pascal}Dto) {
    return this.service.createRecord(body);
  }

  @Put("/:id")
  @ValidateBody(Update${pascal}Dto)
  @UseSecurity(
    AdaptiveRateLimiter,
    InputSanitizer,
    CorsGuard,
    CsrfProtector,
    AuditLogger,
  )
  update(body: Update${pascal}Dto, context: ${pascal}RouteContext) {
    return this.service.updateRecord(this.resolveId(context), body);
  }

  @Del("/:id")
  @UseSecurity(
    AdaptiveRateLimiter,
    InputSanitizer,
    CorsGuard,
    CsrfProtector,
    AuditLogger,
  )
  remove(_payload: unknown, context: ${pascal}RouteContext) {
    return this.service.removeRecord(this.resolveId(context));
  }

  private resolveId(context: ${pascal}RouteContext): string {
    const id = context.params?.id;
    if (!id) {
      throw new Error("Missing required route parameter: id");
    }
    return id;
  }
}
`;

const crudEntityTemplate = (
  pascal: string,
  kebab: string,
  fields: CrudFieldDefinition[],
) => {
  const fieldLines = fields
    .map(
      (field) =>
        `  @Column({ type: "${field.type}" })\n  ${field.property}!: ${mapCrudFieldTsType(field.type)};`,
    )
    .join("\n\n");
  return `import { Column, Entity, PrimaryColumn } from "ocd-js/orm";

@Entity({ table: "${kebab}_records" })
export class ${pascal}Entity {
  @PrimaryColumn({ type: "string" })
  id!: string;

${fieldLines ? `${fieldLines}\n\n` : ""}  @Column({ type: "date" })
  createdAt!: Date;

  @Column({ type: "date" })
  updatedAt!: Date;
}
`;
};

const crudRepositoryTemplate = (
  pascal: string,
  fields: CrudFieldDefinition[],
) => {
  const searchCondition = buildSearchCondition(fields);
  return `import { Injectable } from "ocd-js/core";
import { Connection, JsonDatabaseDriver } from "ocd-js/orm";
import { List${pascal}Query } from "../dto";
import { ${pascal}Entity } from "./${toKebabCase(pascal)}.entity";

const connection = new Connection({ driver: new JsonDatabaseDriver() });
const repositoryReady = connection.initialize();

async function resolve${pascal}Repository() {
  await repositoryReady;
  return connection.getRepository(${pascal}Entity);
}

@Injectable()
export class ${pascal}Repository {
  async findMany(query: List${pascal}Query) {
    const repo = await resolve${pascal}Repository();
    let records = await repo.find();
${searchCondition}
    const limit = query.limit ?? 50;
    return records.slice(0, limit);
  }

  async findById(id: string) {
    const repo = await resolve${pascal}Repository();
    return repo.findOne({ where: { id } as any });
  }

  async create(payload: Partial<${pascal}Entity>) {
    const repo = await resolve${pascal}Repository();
    const entity = repo.create({
      ...payload,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as ${pascal}Entity);
    return repo.save(entity);
  }

  async update(id: string, payload: Partial<${pascal}Entity>) {
    const existing = await this.findById(id);
    if (!existing) {
      return null;
    }
    Object.assign(existing, payload, { updatedAt: new Date() });
    const repo = await resolve${pascal}Repository();
    return repo.save(existing);
  }

  async delete(id: string) {
    const repo = await resolve${pascal}Repository();
    await repo.delete({ id } as Partial<${pascal}Entity>);
  }
}
`;
};

const crudCreateDtoTemplate = (
  pascal: string,
  fields: CrudFieldDefinition[],
) => {
  const primitiveImports = buildDtoPrimitiveImports(fields);
  const imports = ["Dto", "InferSchema", "object", ...primitiveImports];
  const schemaLines = fields.map((field) => buildDtoSchemaLine(field, false));
  const classLines = fields.map(
    (field) => `  ${field.property}!: ${mapCrudFieldTsType(field.type)};`,
  );
  return `import { ${imports.join(", ")} } from "ocd-js/core";

export const create${pascal}Schema = object({
${schemaLines.map((line) => `  ${line}`).join("\n")}
});

@Dto(create${pascal}Schema)
export class Create${pascal}Dto {
${classLines.join("\n")}\n}

export type Create${pascal}Input = InferSchema<typeof create${pascal}Schema>;
`;
};

const crudUpdateDtoTemplate = (
  pascal: string,
  fields: CrudFieldDefinition[],
) => {
  const primitiveImports = buildDtoPrimitiveImports(fields);
  const imports = [
    "Dto",
    "InferSchema",
    "object",
    "optional",
    ...primitiveImports,
  ];
  const schemaLines = fields.map((field) => buildDtoSchemaLine(field, true));
  const classLines = fields.map(
    (field) => `  ${field.property}?: ${mapCrudFieldTsType(field.type)};`,
  );
  return `import { ${imports.join(", ")} } from "ocd-js/core";

export const update${pascal}Schema = object({
${schemaLines.map((line) => `  ${line}`).join("\n")}
});

@Dto(update${pascal}Schema)
export class Update${pascal}Dto {
${classLines.join("\n")}\n}

export type Update${pascal}Input = InferSchema<typeof update${pascal}Schema>;
`;
};

const crudQueryDtoTemplate = (
  pascal: string,
  fields: CrudFieldDefinition[],
) => {
  const searchable = fields.some((field) => field.type === "string");
  const imports = ["InferSchema", "number", "object", "optional"];
  if (searchable) {
    imports.push("string");
  }
  const searchLine = searchable
    ? "  search: optional(string({ minLength: 1, maxLength: 120 })),\n"
    : "";
  return `import { ${imports.join(", ")} } from "ocd-js/core";

export const list${pascal}QuerySchema = object({
${searchLine}  limit: optional(number({ min: 1, max: 100 }), 20),
});

export type List${pascal}Query = InferSchema<typeof list${pascal}QuerySchema>;
`;
};

const crudDtoIndexTemplate = (
  kebab: string,
) => `export * from "./create-${kebab}.dto";
export * from "./update-${kebab}.dto";
export * from "./${kebab}.query";
`;

const crudSpecTemplate = (
  pascal: string,
  kebab: string,
  fields: CrudFieldDefinition[],
) => {
  const createPayload = buildSamplePayload(fields, "create");
  const updatePayload = buildSamplePayload(fields.slice(0, 1), "update");
  return `import test from "node:test";
import assert from "node:assert/strict";
import { createApplicationContext } from "ocd-js/core";
import { ${pascal}Module } from "./${kebab}.module";
import { ${pascal}Service } from "./${kebab}.service";
import { Create${pascal}Dto, Update${pascal}Dto } from "./dto";

test("${pascal} service executes CRUD pipeline", async () => {
  const context = createApplicationContext(${pascal}Module);
  const service = context.container.resolve(${pascal}Service);
  const created = await service.createRecord({
${createPayload}
  } as Create${pascal}Dto);
  assert.ok(created.id, "record id missing");

  const listed = await service.listRecords({ limit: 10 });
  assert.equal(listed.length, 1);

  const fetched = await service.getRecord(created.id);
  assert.equal(fetched?.id, created.id);

  const updated = await service.updateRecord(created.id, {
${updatePayload || "    // no mutable fields provided"}
  } as Update${pascal}Dto);
  assert.ok(updated, "update should return a record");

  await service.removeRecord(created.id);
  const remaining = await service.listRecords({ limit: 10 });
  assert.equal(remaining.length, 0);
});
`;
};

const parseCrudFields = (value: string): CrudFieldDefinition[] => {
  const source = value?.trim() ? value : DEFAULT_CRUD_FIELDS;
  const entries = source
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!entries.length) {
    throw new Error("At least one field must be provided for CRUD generator");
  }
  const seen = new Set<string>();
  return entries.map((entry) => {
    const [rawName, rawType] = entry
      .split(":")
      .map((segment) => segment.trim());
    if (!rawName || !rawType) {
      throw new Error(`Invalid field definition "${entry}"`);
    }
    const property = toCamelCase(rawName);
    if (!property) {
      throw new Error(`Invalid field name "${rawName}"`);
    }
    if (seen.has(property)) {
      throw new Error(`Duplicate field name "${property}"`);
    }
    seen.add(property);
    return {
      name: rawName,
      property,
      pascal: toPascalCase(rawName),
      type: normalizeCrudFieldType(rawType),
    };
  });
};

const normalizeCrudFieldType = (value: string): CrudFieldType => {
  const normalized = value.toLowerCase();
  if (
    normalized === "string" ||
    normalized === "number" ||
    normalized === "boolean"
  ) {
    return normalized;
  }
  throw new Error(
    `Unsupported CRUD field type "${value}". Use string|number|boolean`,
  );
};

const mapCrudFieldTsType = (type: CrudFieldType): string => {
  switch (type) {
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "string":
    default:
      return "string";
  }
};

const buildDtoPrimitiveImports = (fields: CrudFieldDefinition[]): string[] => {
  const types = new Set<string>();
  fields.forEach((field) => {
    if (field.type === "string") {
      types.add("string");
    } else if (field.type === "number") {
      types.add("number");
    } else if (field.type === "boolean") {
      types.add("boolean");
    }
  });
  return Array.from(types);
};

const buildDtoSchemaLine = (
  field: CrudFieldDefinition,
  optionalField: boolean,
): string => {
  const schema = (() => {
    switch (field.type) {
      case "number":
        return "number({ min: 0 })";
      case "boolean":
        return "boolean()";
      case "string":
      default:
        return "string({ minLength: 2, maxLength: 160 })";
    }
  })();
  if (optionalField) {
    return `${field.property}: optional(${schema}),`;
  }
  return `${field.property}: ${schema},`;
};

const buildSearchCondition = (fields: CrudFieldDefinition[]): string => {
  const searchable = fields.filter((field) => field.type === "string");
  if (!searchable.length) {
    return "";
  }
  const conditions = searchable
    .map(
      (field) =>
        `(record.${field.property} ?? "")
        .toString()
        .toLowerCase()
        .includes(term)`,
    )
    .join(" ||\n        ");
  return `    if (query.search) {
      const term = query.search.toLowerCase();
      records = records.filter((record) =>
        ${conditions}
      );
    }
`;
};

const buildSamplePayload = (
  fields: CrudFieldDefinition[],
  variant: "create" | "update",
): string => {
  if (!fields.length) {
    return "";
  }
  return fields
    .map(
      (field) => `    ${field.property}: ${buildSampleValue(field, variant)},`,
    )
    .join("\n");
};

const buildSampleValue = (
  field: CrudFieldDefinition,
  variant: "create" | "update",
): string => {
  if (field.type === "number") {
    return variant === "create" ? "500" : "750";
  }
  if (field.type === "boolean") {
    return variant === "create" ? "true" : "false";
  }
  const suffix = variant === "create" ? "Alpha" : "Prime";
  return `"${field.pascal} ${suffix}"`;
};

const scaffoldProject = async (root: string, slug: string, force: boolean) => {
  const plan: Array<[string, string]> = [
    ["package.json", projectPackageJson(slug)],
    ["tsconfig.json", projectTsconfig()],
    ["eslint.config.js", projectEslintFlatConfig()],
    [".eslintrc.cjs", projectEslintConfig()],
    [".prettierrc.cjs", projectPrettierConfig()],
    ["README.md", projectReadmeTemplate(slug)],
    ["src/main.ts", projectMainTemplate()],
    ["src/bootstrap.ts", projectBootstrapTemplate()],
    ["src/root.module.ts", projectRootModuleTemplate()],
    ["src/modules/app/app.module.ts", projectFeatureModuleTemplate()],
    ["src/modules/app/app.service.ts", projectAppServiceTemplate()],
    ["src/modules/app/app.controller.ts", projectAppControllerTemplate()],
    [
      "src/modules/app/app.controller.spec.ts",
      projectAppControllerSpecTemplate(),
    ],
    [".github/workflows/ci.yml", projectCiWorkflowTemplate()],
    [".gitignore", gitignoreTemplate()],
  ];

  for (const [relative, content] of plan) {
    await writeArtifact(path.join(root, relative), content, force);
  }
};

const projectPackageJson = (slug: string) => `{
  "name": "${slug}",
  "version": "0.1.0",
  "scripts": {
    "build": "tsc",
    "start": "node dist/main.js",
    "dev": "tsx watch src/main.ts",
    "lint": "eslint ./src --ext .ts --config eslint.config.js",
    "test": "tsx --test ./src/**/*.spec.ts",
    "format": "prettier --write ./src/**/*.ts"
  },
  "dependencies": {
    "ocd-js": "^1.1.10-beta"
  },
  "devDependencies": {
    "@types/node": "^20.11.24",
    "@typescript-eslint/eslint-plugin": "^8.2.0",
    "@typescript-eslint/parser": "^8.2.0",
    "eslint": "^9.9.0",
    "prettier": "^3.3.2",
    "tsx": "^4.7.0",
    "typescript": "^5.4.5"
  }
}
`;

const projectTsconfig = () => `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
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

const projectRootModuleTemplate = () => `import { Module } from "ocd-js/core";
import { AppModule } from "./modules/app/app.module";

@Module({
  imports: [AppModule],
})
export class RootModule {}
`;

const projectFeatureModuleTemplate =
  () => `import { Module } from "ocd-js/core";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";

@Module({
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
`;

const projectAppServiceTemplate =
  () => `import { Injectable } from "ocd-js/core";

@Injectable()
export class AppService {
  async getStatus() {
    return {
      message: "Hello from OCD-JS",
      status: "ready",
      timestamp: new Date().toISOString(),
    };
  }
}
`;

const projectAppControllerTemplate =
  () => `import { Controller, Get, Inject } from "ocd-js/core";
import { AppService } from "./app.service";

@Controller({ basePath: "/app", version: "1" })
export class AppController {
  constructor(@Inject(AppService) private readonly service: AppService) {}

  @Get("/status")
  async readStatus() {
    return this.service.getStatus();
  }
}
`;

const projectMainTemplate = () => `import { bootstrap } from "./bootstrap";

bootstrap().catch((error) => {
  console.error("Failed to bootstrap", error);
  process.exit(1);
});
`;

const projectBootstrapTemplate =
  () => `import { HttpAdapter } from "ocd-js/server";
import { RootModule } from "./root.module";

export async function bootstrap() {
  const PORT = process.env.PORT || 3000;

  const httpAdapter = new HttpAdapter({
    module: RootModule,
    versioning: {
      strategy: "path",
      prefix: "v"
    }
  });

  const server = httpAdapter.getApp().listen(PORT);

  return server;
}
`;

const projectAppControllerSpecTemplate = () => `import test from "node:test";
import assert from "node:assert/strict";
import { createApplicationContext } from "ocd-js/core";
import { AppModule } from "./app.module";
import { AppController } from "./app.controller";

test("AppController returns status", async () => {
  const app = createApplicationContext(AppModule);
  const controller = app.container.resolve(AppController);
  const result = await controller.readStatus();
  assert.equal(result.message, "Hello from OCD-JS");
  assert.equal(result.status, "ready");
});
`;

const projectReadmeTemplate = (slug: string) => `# ${slug}

A new OCD-JS application with decorator-based architecture.

## Getting Started

### 1. Install OCD-JS packages

\`\`\`bash
npm install ocd-js
\`\`\`

### 2. Run the application

\`\`\`bash
# Development mode with auto-reload
npm run dev

# Build and run
npm run build
npm start
\`\`\`

### 3. Available scripts

- \`npm run build\` - Compile TypeScript to JavaScript
- \`npm start\` - Run compiled application
- \`npm run dev\` - Run in development mode with ts-node
- \`npm run lint\` - Lint TypeScript files
- \`npm test\` - Run tests
- \`npm run format\` - Format code with Prettier

## Project Structure

\`\`\`
${slug}/
├── src/
│   ├── modules/
│   │   └── app/
│   │       ├── app.module.ts       # Feature module with @Module decorator
│   │       ├── app.service.ts      # Service with @Injectable decorator
│   │       ├── app.controller.ts   # Controller with @Controller, @Get decorators
│   │       └── app.controller.spec.ts
│   ├── bootstrap.ts                # Application bootstrap logic
│   ├── main.ts                     # Entry point
│   └── root.module.ts              # Root module
├── package.json
├── tsconfig.json
└── README.md
\`\`\`

## OCD-JS Features

This project is scaffolded with OCD-JS decorators:

- **@Module()** - Define modules with imports, controllers, providers
- **@Controller()** - Define HTTP controllers with routes
- **@Injectable()** - Mark classes as injectable services
- **@Get(), @Post(), @Put(), @Del()** - HTTP method decorators
- **@Inject()** - Explicit dependency injection

## Learn More

- [OCD-JS Documentation](https://github.com/hidesec/ocd-js)
- [OCD-JS Examples](https://github.com/hidesec/ocd-js/tree/main/examples)
- [NPM Package](https://www.npmjs.com/package/ocd-js)

## License

MIT License - see the [LICENSE](https://github.com/hidesec/ocd-js/blob/main/LICENSE) file for details.
`;

const gitignoreTemplate = () => `node_modules
dist
.DS_Store
*.log
`;

const projectEslintConfig = () => `module.exports = {
  root: true,
  env: {
    node: true,
    es2020: true,
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: "./tsconfig.json",
  },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  ignorePatterns: ["dist"],
};
`;

const projectEslintFlatConfig = () => `module.exports = [
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: require("@typescript-eslint/parser"),
      ecmaVersion: 2020,
      sourceType: "commonjs",
    },
    plugins: {
      "@typescript-eslint": require("@typescript-eslint/eslint-plugin"),
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
    },
  },
];
`;

const projectPrettierConfig = () => `module.exports = {
  singleQuote: false,
  trailingComma: "all",
  printWidth: 90,
};
`;

const projectCiWorkflowTemplate = () => `name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install
      - run: npm run lint
      - run: npm run test
`;

const installDependencies = async (root: string, manager: PackageManager) => {
  const command = resolveInstallCommand(manager);
  console.log(kleur.cyan(`Installing dependencies using ${manager}...`));
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, {
      cwd: root,
      stdio: "inherit",
      shell: true,
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${manager} install exited with code ${code}`));
        return;
      }
      resolve();
    });
    child.on("error", reject);
  });
};

const resolveInstallCommand = (manager: PackageManager): string => {
  const executable = platformExecutable(manager);
  switch (manager) {
    case "yarn":
      return executable;
    case "pnpm":
    case "bun":
    case "npm":
    default:
      return `${executable} install`;
  }
};

const platformExecutable = (command: string) =>
  process.platform === "win32" ? `${command}.cmd` : command;

const runNpmInstall = async (packages: string[], tag: string) => {
  const dependencies = packages.map((pkg) => `${pkg}@${tag}`);
  const executable = platformExecutable("npm");
  const command = `${executable} install ${dependencies.join(" ")}`;
  console.log(kleur.gray(`$ ${command}`));
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, {
      cwd: process.cwd(),
      stdio: "inherit",
      shell: true,
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`npm install exited with code ${code}`));
        return;
      }
      resolve();
    });
    child.on("error", reject);
  });
};

const resolveLocalPack = async (
  explicit?: string,
): Promise<string | undefined> => {
  if (explicit) {
    const p = path.resolve(process.cwd(), explicit);
    try {
      const stat = await fs.stat(p);
      if (stat.isFile()) return p;
    } catch {}
  }
  try {
    const files = await fs.readdir(process.cwd());
    const candidates = files.filter((f) => /^ocd-js-.*\.tgz$/.test(f));
    if (candidates.length === 0) return undefined;
    const withTime = await Promise.all(
      candidates.map(async (f) => {
        const full = path.join(process.cwd(), f);
        const s = await fs.stat(full);
        return { full, mtime: s.mtimeMs };
      }),
    );
    withTime.sort((a, b) => b.mtime - a.mtime);
    return withTime[0].full;
  } catch {
    return undefined;
  }
};

const pinLocalPackDependency = async (
  projectRoot: string,
  packPath: string,
) => {
  const pkgFile = path.join(projectRoot, "package.json");
  const content = await fs.readFile(pkgFile, "utf8");
  const pkg = JSON.parse(content);
  const rel = path.relative(projectRoot, packPath).replace(/\\/g, "/");
  pkg.dependencies = pkg.dependencies || {};
  pkg.dependencies["ocd-js"] = `file:${rel}`;
  await fs.writeFile(pkgFile, JSON.stringify(pkg, null, 2), "utf8");
};

function createDriver(
  orm: typeof import("@ocd-js/orm"),
  options: DriverCliOptions,
) {
  const kind = (options.driver ?? "json").toLowerCase();
  switch (kind) {
    case "memory":
      return new orm.MemoryDatabaseDriver();
    case "json":
      return new orm.JsonDatabaseDriver({
        filePath: path.resolve(process.cwd(), options.data ?? "orm-data.json"),
      });
    case "sqlite":
      return new orm.SqliteDatabaseDriver({
        filePath: path.resolve(
          process.cwd(),
          options.sqliteFile ?? options.data ?? "orm.sqlite",
        ),
      });
    case "postgres": {
      const connectionString = options.url ?? process.env.DATABASE_URL;
      const ssl = normalizeSslOption(options.ssl);
      const config: Record<string, unknown> = {};
      if (connectionString) config.connectionString = connectionString;
      if (options.host) config.host = options.host;
      const port = parsePortOption(options.port);
      if (port !== undefined) config.port = port;
      if (options.user) config.user = options.user;
      if (options.password) config.password = options.password;
      if (options.database) config.database = options.database;
      if (ssl !== undefined) config.ssl = ssl;
      return new orm.PostgresDatabaseDriver(config as any);
    }
    case "mysql": {
      const ssl = normalizeSslOption(options.ssl);
      const config: Record<string, unknown> = {};
      if (options.host) config.host = options.host;
      const port = parsePortOption(options.port);
      if (port !== undefined) config.port = port;
      if (options.user) config.user = options.user;
      if (options.password) config.password = options.password;
      if (options.database) config.database = options.database;
      if (ssl !== undefined) config.ssl = ssl;
      return new orm.MySqlDatabaseDriver(config as any);
    }
    default:
      throw new Error(
        `Unsupported driver "${options.driver ?? "unknown"}". Use json|memory|sqlite|postgres|mysql`,
      );
  }
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

const normalizePackageManager = (value?: string): PackageManager => {
  const normalized = (value ?? "npm").toLowerCase();
  if (normalized === "pnpm" || normalized === "yarn" || normalized === "bun") {
    return normalized;
  }
  return "npm";
};

const normalizeSslOption = (value?: string): boolean | string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }
  return value;
};

const parsePortOption = (value?: string): number | undefined => {
  if (value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid port value "${value}"`);
  }
  return parsed;
};

const resolveUpgradePackages = (list?: string): string[] => {
  if (list) {
    return list
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [
    "ocd-js/core",
    "ocd-js/orm",
    "ocd-js/cli",
    "ocd-js/observability",
    "ocd-js/auth",
    "ocd-js/governance",
  ];
};

program.parseAsync(process.argv).catch((error) => {
  console.error(
    kleur.red(error instanceof Error ? error.message : String(error)),
  );
  process.exit(1);
});
