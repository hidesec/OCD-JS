# OCD-JS

**OCD-JS** is an opinionated TypeScript backend framework that embraces decorator-first APIs, predictable dependency injection, and batteries‑included tooling for security, observability, performance, ecosystem extensibility, developer experience, and governance.

## Table of Contents
1. [Key Pillars](#key-pillars)
2. [Getting Started](#getting-started)
3. [Creating Your First Module](#creating-your-first-module)
4. [Runtime Features](#runtime-features)
   - [Validation & Security](#validation--security)
   - [Observability](#observability)
   - [Performance Toolkit](#performance-toolkit)
   - [Plugins & Integrations](#plugins--integrations)
   - [Feature Flags & Governance](#feature-flags--governance)
5. [Developer Workflow](#developer-workflow)
6. [Testing](#testing)
7. [CLI Reference](#cli-reference)
8. [Publishing & Versioning](#publishing--versioning)

## Key Pillars
- **Architecture & Productivity** – Module/service/controller conventions, explicit DI container, schema-driven routing, env schema helpers, CLI scaffolding.
- **Security End-to-End** – Runtime DTO validators, adaptive rate limiting, sanitization, CSRF/CORS/CSP guards, audit logging, pluggable auth (JWT/session/OAuth) with role/policy decorators.
- **Observability & Operations** – Structured logger (correlation IDs, profiling hooks), health/readiness/liveness probes, Prometheus/OpenMetrics exporter, centralized error boundary + retry helpers.
- **Performance & Scalability** – Streaming body parser, fast serializer, worker offload decorator, caching layer with tag invalidation, multi-transport (HTTP/2, WebSocket) stubs.
- **Ecosystem & Extensibility** – Stable plugin API with lifecycle hooks, official DB/queue/storage/cloud integrations, contract testing harness.
- **Developer Experience & Testing** – `ocd-dev` hot reload server, testing helpers for unit/integration/e2e, upgrade assistant, automatic API doc generator.
- **Governance & Reliability** – Policy bundles (OWASP Top 10), release checklist engine, feature flag module, plugin contribution guidelines.

## Getting Started
```bash
# install the published package
npm install ocd-js

# or clone the monorepo if you want to extend the framework itself
git clone https://github.com/your-org/ocd-js
cd ocd-js
npm install
```

### Minimal bootstrap
```ts
import { Module, Controller, Get, createApplicationContext } from "@ocd-js/core";

@Controller({ basePath: "/hello", version: "v1" })
class HelloController {
  @Get("/")
  greet() {
    return { message: "Hello OCD-JS" };
  }
}

@Module({ controllers: [HelloController] })
class AppModule {}

const app = createApplicationContext(AppModule);
console.log(app.routes); // compiled route metadata
```

## Creating Your First Module
1. **Generate scaffolding (optional)**
   ```bash
   npx ocd generate module hello
   npx ocd generate controller hello/greeting
   npx ocd generate service hello/greeting
   ```
2. **Register providers & controllers** using `@Module`.
3. **Resolve controllers** via the DI container or mount the compiled routes in your HTTP adapter of choice.

## Runtime Features

### Validation & Security
```ts
import { Dto, ValidateBody } from "@ocd-js/core";
import { UseSecurity, InputSanitizer, AdaptiveRateLimiter } from "@ocd-js/security";
import { Authenticated, Roles } from "@ocd-js/auth";

@Dto()
class CreateUserDto {
  name!: string;
  email!: string;
}

@Post("/")
@UseSecurity(InputSanitizer, AdaptiveRateLimiter)
@Authenticated()
@Roles("admin")
@ValidateBody(CreateUserDto)
createUser(body: CreateUserDto) {
  return this.service.create(body);
}
```

### Observability
```ts
import { LOGGER, PROBE_REGISTRY, METRICS_REGISTRY } from "@ocd-js/observability";

const logger = container.resolve(LOGGER);
logger.withCorrelation("req-123", () => logger.info("processing", { route: "/users" }));

const probes = container.resolve(PROBE_REGISTRY);
await probes.runAll();

const metrics = container.resolve(METRICS_REGISTRY);
console.log(renderOpenMetrics(metrics));
```

### Performance Toolkit
- **Pipeline:** `PIPELINE_MANAGER` + `StreamingBodyParser` + `FastSerializer`.
- **Caching:** `@Cached({ key, ttl, tags })` decorator backed by `CacheManager`.
- **Offload:** `@Offload()` to move CPU-bound work to worker threads.

### Plugins & Integrations
```ts
import { OcdPlugin } from "@ocd-js/plugins";

@OcdPlugin({ name: "audit", version: "1.0.0" })
export class AuditPlugin {
  async onReady(context) {
    const logger = context.container.resolve(LOGGER);
    logger.info("Audit plugin ready", { plugin: context.metadata.name });
  }
}

pluginManager.register(AuditPlugin);
await pluginManager.bootstrap(container);
```

**Integrations:** `@ocd-js/integrations` ships in-memory DB/queue/storage/cloud clients with DI tokens, making it easy to swap adapters later.

### Feature Flags & Governance
```ts
import { FeatureGate } from "@ocd-js/feature-flags";

@Get("/beta")
@FeatureGate("beta-users")
betaPreview() {
  return { message: "beta endpoint" };
}

import { POLICY_SERVICE, OWASP_TOP10_BUNDLE } from "@ocd-js/governance";
const policyService = container.resolve(POLICY_SERVICE);
const report = await policyService.evaluate(OWASP_TOP10_BUNDLE);
```

## Developer Workflow
```bash
# build all packages
npm run build

# start dev server with hot reload + lint/typecheck pipeline
npm run dev

# generate upgrade recommendations
npx ocd-upgrade

# export API docs + plugin guidelines
npm run docs
```

## Testing
```bash
npm run lint   # prettier + tsc
npm run test   # builds, then executes node --test over tests/*.test.js

# Within code, use helpers:
import { withUnitTest, withIntegrationTest, applyMocks } from "@ocd-js/testing";
```
Testing utilities let you spin up DI contexts, override providers, and run contract tests for plugins via `@ocd-js/contract-testing`.

## CLI Reference
- `ocd generate <type>` – scaffold modules/services/controllers.
- `ocd-dev` – rebuild + lint + restart with file watching.
- `ocd-upgrade` – analyze workspace for outdated OCD-JS packages.
- `ocd-docs` – produce JSON API docs (routes, schemas) and plugin contribution guidelines.

## Publishing & Versioning
1. Update versions (`npm version patch|minor|major`).
2. Ensure all workspace dependencies reference published semver ranges (avoid `file:` when publishing).
3. Run the validation suite (`npm run lint` & `npm run test`).
4. Publish prerelease/stable builds:
   ```bash
   npm publish --access public --tag beta   # for prerelease
   npm publish --access public              # for stable (non-prerelease version)
   ```
5. Verify installation via `npm i ocd-js@beta` or `@latest`.

---
Need help or have ideas? Open an issue or start a discussion—OCD-JS is designed to be extensible and community-friendly.
