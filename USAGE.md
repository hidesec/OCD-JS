# OCD-JS Comprehensive Usage Guide

This guide walks through every major capability exposed by the OCD-JS framework—from the core module system to security, observability, performance, extensibility, developer workflows, and governance.

## 1. Installation Options

```bash
# Using npm (recommended)
npm install ocd-js

# Using yarn
yarn add ocd-js

# Cloning the monorepo for framework development
git clone https://github.com/your-org/ocd-js
cd ocd-js
npm install
```

## 2. Workspace Layout (Monorepo)

| Path | Purpose |
| --- | --- |
| packages/core | DI container, modules, routing, validation |
| packages/security | Security middlewares & decorator |
| packages/auth | Auth strategies and guards |
| packages/observability | Logging, probes, metrics, retry |
| packages/performance | Pipelines, caching, transports |
| packages/plugins | Plugin API & lifecycle manager |
| packages/integrations | DB/queue/storage/cloud adapters |
| packages/testing | Testing harness utilities |
| packages/dev-server | Hot reload dev server (ocd-dev) |
| packages/tooling | Upgrade assistant & docs CLI |
| packages/governance | Policy bundles, release checklist |
| packages/feature-flags | Feature toggles + guard/decorator |
| packages/contract-testing | Plugin contract harness |
| examples/server | Reference app wiring everything together |

## 3. Core Concepts

### 3.1 Modules, Controllers, and Services

```bash
import {
  Module,
  Controller,
  Get,
  Post,
  Injectable,
  Inject,
  createApplicationContext,
} from  @ocd-js/core;

@Injectable()
class HelloService {
  list() {
    return [hi, bonjour, hola];
  }
}

@Controller({ basePath: /hello, version: v1 })
class HelloController {
  constructor(@Inject(HelloService) private readonly hello: HelloService) {}

  @Get(/)
  index() {
    return this.hello.list();
  }
}

@Module({ controllers: [HelloController], providers: [HelloService] })
class HelloModule {}

const app = createApplicationContext(HelloModule);
console.log(app.routes); // introspect compiled routes
```

### 3.2 Dependency Injection (DI)

- Register providers via @Injectable() or explicit Provider definitions.
- Supports scopes (singleton, 	ransient, 
equest).
- Request scope: const request = app.beginRequest(); request.container.resolve(MyService);

### 3.3 Environment Configuration

```bash
import { defineEnvSchema, loadConfig } from @ocd-js/core;

const schema = defineEnvSchema((env) => ({
  PORT: env.number({ default: 3000 }),
  NODE_ENV: env.string({ choices: [development, production] }),
}));

export const AppConfig = loadConfig(schema);
```

### 3.4 Routing + Schema Metadata

- Decorate methods with @Get, @Post, etc.
- Pass schema definitions to enable automatic validation/introspection.
- Route metadata is consumed by doc generators (ocd-docs) and middlewares.

## 4. Validation & Security

### 4.1 DTOs and Validation Decorators

```bash
import { Dto, ValidateBody } from @ocd-js/core;

@Dto()
class CreateUserDto {
  name!: string;
  email!: string;
}

@Post(/)
@ValidateBody(CreateUserDto)
createUser(body: CreateUserDto) {
  // body is validated
}
```

### 4.2 Security Middleware (@ocd-js/security)

```bash
import {
  UseSecurity,
  AdaptiveRateLimiter,
  InputSanitizer,
  CsrfProtector,
  CorsGuard,
  CspGuard,
  AuditLogger,
} from @ocd-js/security;

@UseSecurity(
  InputSanitizer,
  AdaptiveRateLimiter,
  CsrfProtector,
  CorsGuard,
  CspGuard,
  AuditLogger,
)
handleRequest() {
  // all middleware run before the controller handler
}
```

### 4.3 Auth Guards (@ocd-js/auth)

```bash
import { Authenticated, Roles, Policies } from @ocd-js/auth;

@Get(/secure)
@Authenticated()
@Roles(admin, support)
@Policies(CanEditUser)
secureHandler() {
  return { ok: true };
}
```

Configure auth strategies via module providers:

```bash
@Module({
  imports: [AuthModule],
  providers: [{
    token: AUTH_OPTIONS,
    useValue: {
      jwtSecret: super-secret,
      jwtTtlSeconds: 3600,
      sessionTtlSeconds: 3600,
    },
  }],
})
export class AppModule {}
```

## 5. Observability

### 5.1 Structured Logger

```bash
import { LOGGER } from @ocd-js/observability;

const logger = container.resolve(LOGGER);
logger.info(user.created, { id: 1 });
logger.withCorrelation(req-abc, () => {
  logger.debug(processing request);
});
```

### 5.2 Health & Metrics

```bash
import {
  PROBE_REGISTRY,
  MetricsRegistry,
  METRICS_REGISTRY,
  HealthCheck,
  renderOpenMetrics,
} from @ocd-js/observability;

@HealthCheck(database)
async function dbHealth() {
  return { status: up };
}

const probes = container.resolve(PROBE_REGISTRY);
await probes.runAll();

const metrics = container.resolve(METRICS_REGISTRY) as MetricsRegistry;
console.log(renderOpenMetrics(metrics));
```

### 5.3 Error Boundary + Retry

```bash
import { ErrorBoundary, Retryable } from @ocd-js/observability;

const boundary = new ErrorBoundary({
  mapError: (error) => ({ status: 500, code: E_UNEXPECTED, error }),
});

@Retryable({ attempts: 3, backoffMs: 100 })
async fragileOperation() {
  // automatically retried if rejects
}
```

## 6. Performance Toolkit

### 6.1 Async Pipeline

```bash
import {
  PIPELINE_MANAGER,
  StreamingBodyParser,
  FastSerializer,
} from @ocd-js/performance;

const pipeline = container.resolve(PIPELINE_MANAGER);
pipeline.use(new StreamingBodyParser()).use(new FastSerializer());
```

### 6.2 Caching Layer

```bash
import { Cached } from @ocd-js/performance;

class UserService {
  @Cached({ key: users:list, ttl: 60, tags: [users] })
  findAll() {
    return this.db.listUsers();
  }

  invalidateUsers() {
    this.cache.invalidate([users]);
  }
}
```

### 6.3 Transport Stubs & Offload

- Use Http2Transport / WebSocketTransport classes as adapters or references.
- Apply @Offload() to worker-thread heavy tasks.

## 7. Ecosystem & Extensibility

### 7.1 Plugin API

```bash
import { OcdPlugin, PluginManager } from @ocd-js/plugins;

@OcdPlugin({ name: audit, version: 1.0.0 })
class AuditPlugin {
  async onReady(context) {
    const logger = context.container.resolve(LOGGER);
    logger.info(audit ready);
  }
}

const manager = new PluginManager({ coreVersion: 1.1.1 });
manager.register(AuditPlugin);
await manager.bootstrap(container);
```

### 7.2 Integrations

Use the DI tokens exported by @ocd-js/integrations:

```bash
import {
  DB_CLIENT,
  QUEUE_CLIENT,
  STORAGE_CLIENT,
  CLOUD_PUBSUB,
} from @ocd-js/integrations;

class UserService {
  constructor(
    @Inject(DB_CLIENT) private readonly db,
    @Inject(QUEUE_CLIENT) private readonly queue,
  ) {}
}
```

### 7.3 Contract Testing

```bash
import { ContractHarness } from @ocd-js/contract-testing;

const harness = new ContractHarness();
harness.registerPlugin(AuditPlugin);
harness.addScenario({
  name: logs on ready,
  verify: () => {
    // assert plugin behavior
  },
});
await harness.run();
```

## 8. Developer Experience & Testing

### 8.1 App Scaffolding (ocd new)

```bash
npx ocd new hello-world
cd hello-world
npm install
npm run dev
```

This generates `package.json`, `tsconfig.json`, starter `AppModule`/controller/service, `main.ts`, and a `.gitignore`, so you can immediately run or extend a minimal OCD-JS app.

### 8.2 Dev Server (ocd-dev)

```bash
npm run dev
# builds → lints → restarts example server with hot reload & Node inspector
```

### 8.3 Testing Harness (@ocd-js/testing)

```bash
import { withUnitTest, applyMocks } from @ocd-js/testing;

await withUnitTest(AppModule, (app) => {
  applyMocks(app, [{ token: MyService, useValue: { hello: () => mock } }]);
  const service = app.context.container.resolve(MyService);
});
```

### 8.4 Upgrade Assistant & Docs

```bash
npx ocd-upgrade   # analyzes dependencies against recommended versions
npm run docs      # runs ocd-docs to emit API documentation + plugin guidelines
```

## 9. Governance & Reliability

### 9.1 Policy Bundles

```bash
import { POLICY_SERVICE, OWASP_TOP10_BUNDLE } from @ocd-js/governance;

const policyService = container.resolve(POLICY_SERVICE);
const report = await policyService.evaluate(OWASP_TOP10_BUNDLE);
console.log(report.passed, report.failures);
```

### 9.2 Release Checklist

```bash
import { ReleaseChecklist } from @ocd-js/governance;

const checklist = new ReleaseChecklist([
  { id: tests, description: Unit tests pass, verify: () => true },
  { id: docs, description: Docs regenerated, verify: () => false },
]);
const results = await checklist run();
```

### 9.3 Feature Flags

```bash
import { FeatureGate } from @ocd-js/feature-flags;

@Get(/beta)
@FeatureGate(beta-users)
betaEndpoint() {
  return { message: beta };
}

// Configure flags via FEATURE_FLAG_CONFIG token or env OCD_FEATURE_FLAGS
{
  token: FEATURE_FLAG_CONFIG,
  useValue: { beta-users: true },
}
```

## 10. Example Server Walkthrough

- Located in examples/server.
- Imports all modules (security, auth, observability, performance, integrations, governance, feature flags, plugins).
- Demonstrates caching, metrics, policy evaluation, release checklist, plugin registration, and feature gating.

To run locally:

```bash
npm run build
node dist/examples/server/src/main.js
```

## 11. Testing & Validation Commands

```bash
npm run lint   # Prettier + TypeScript project references build
npm run test   # Builds and executes node --test tests/*.test.js
```

## 12. Publishing

1. Update versions (
pm version patch|minor|major).
2. Ensure workspace dependencies reference semver ranges (not file:) for published artifacts.
3. Run validators (
pm run lint, 
pm run test).
4. Publish:
   ```bash
   npm publish --access public            # for stable versions
   npm publish --access public --tag beta # for prereleases like 1.1.1-beta
   ```
5. Verify on npm (
pm view ocd-js) and install in a fresh project.

---
This document should serve as a single-stop reference for building, extending, and operating services built on OCD-JS. For questions or contributions, open a discussion or issue in the repository.
