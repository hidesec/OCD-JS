# OCD-JS

**OCD-JS** is an opinionated TypeScript backend framework that embraces decorator-first APIs, predictable dependency injection, and batteries-included tooling for security, observability, performance, and developer experience.

## Table of Contents
1. [Key Features](#key-features)
2. [Getting Started](#getting-started)
3. [Core Concepts](#core-concepts)
4. [Available Packages](#available-packages)
5. [Examples](#examples)
6. [CLI Reference](#cli-reference)
7. [Publishing](#publishing)

## Key Features

- **Decorator-First API** – Use `@Module`, `@Controller`, `@Injectable`, `@Get`, `@Post` decorators for clean, declarative code
- **Dependency Injection** – Built-in DI container with singleton, transient, and request scopes
- **Validation** – Schema-based validation with decorators (`@ValidateBody`, `@ValidateQuery`)
- **Security Middlewares** – Rate limiting, CORS, CSRF, CSP, input sanitization, audit logging
- **Authentication & Authorization** – JWT, Session, and OAuth strategies with role and policy guards
- **ORM** – Full-featured ORM with repository pattern, migrations, transactions, relations, and multiple drivers (JSON, SQLite, PostgreSQL, MySQL)
- **Observability** – Structured logging with correlation IDs, health probes, metrics registry, error boundaries
- **Performance** – Pipeline manager, caching with tag invalidation, worker offload decorator, HTTP/2 and WebSocket support
- **Testing** – Testing utilities, contract testing, mocking helpers
- **CLI Tools** – Scaffold modules, controllers, services, CRUD stacks, and full applications

## Getting Started

### Install CLI globally
```bash
npm install -g ocd-js
```

### Create a new project
```bash
ocd new my-app
cd my-app
npm install
npm run dev
```

### Or use npx
```bash
npx ocd-js new my-app
cd my-app
npm install
npm run dev
```

## Core Concepts

### Minimal Example

```ts
import { Module, Controller, Get, Injectable, Inject } from "@ocd-js/core";
import { ExpressHttpAdapter } from "@ocd-js/server";

@Injectable()
class HelloService {
  greet(name: string) {
    return { message: `Hello ${name}!` };
  }
}

@Controller({ basePath: "/hello", version: "1" })
class HelloController {
  constructor(@Inject(HelloService) private service: HelloService) {}

  @Get("/:name")
  greet(_query: unknown, context: { params: { name: string } }) {
    return this.service.greet(context.params.name);
  }
}

@Module({
  controllers: [HelloController],
  providers: [HelloService],
})
class AppModule {}

const adapter = new ExpressHttpAdapter({
  module: AppModule,
  versioning: { strategy: "path", prefix: "v" }
});

adapter.getApp().listen(3000);
```

### Validation Example

```ts
import { Controller, Post, ValidateBody, Dto, object, string, number } from "@ocd-js/core";

const createUserSchema = object({
  name: string({ minLength: 2, maxLength: 50 }),
  email: string({ minLength: 5, maxLength: 100 }),
  age: number({ min: 18, max: 120 }),
});

@Dto(createUserSchema)
class CreateUserDto {
  name!: string;
  email!: string;
  age!: number;
}

@Controller({ basePath: "/users", version: "1" })
class UserController {
  @Post("/")
  @ValidateBody(CreateUserDto)
  create(body: CreateUserDto) {
    return { success: true, user: body };
  }
}
```

### Security Example

```ts
import { Controller, Post, ValidateBody } from "@ocd-js/core";
import {
  UseSecurity,
  AdaptiveRateLimiter,
  InputSanitizer,
  CorsGuard,
  CsrfProtector,
  AuditLogger
} from "@ocd-js/security";
import { Authenticated, Roles } from "@ocd-js/auth";

@Controller({ basePath: "/admin", version: "1" })
class AdminController {
  @Post("/users")
  @UseSecurity(
    AdaptiveRateLimiter,
    InputSanitizer,
    CorsGuard,
    CsrfProtector,
    AuditLogger
  )
  @Authenticated()
  @Roles("admin")
  @ValidateBody(CreateUserDto)
  createUser(body: CreateUserDto) {
    return this.userService.create(body);
  }
}
```

### ORM Example

```ts
import { Entity, PrimaryColumn, Column, Repository } from "@ocd-js/orm";
import { Connection, JsonDatabaseDriver } from "@ocd-js/orm";
import { Injectable } from "@ocd-js/core";

@Entity({ table: "users" })
class User {
  @PrimaryColumn({ type: "string" })
  id!: string;

  @Column({ type: "string" })
  name!: string;

  @Column({ type: "string" })
  email!: string;

  @Column({ type: "date" })
  createdAt!: Date;
}

const connection = new Connection({
  driver: new JsonDatabaseDriver({ filePath: "data.json" })
});

await connection.initialize();

const userRepo = connection.getRepository(User);
const user = userRepo.create({ id: "1", name: "John", email: "john@example.com", createdAt: new Date() });
await userRepo.save(user);

const users = await userRepo.find();
```

### Observability Example

```ts
import { LOGGER } from "@ocd-js/observability";
import { PROBE_REGISTRY, METRICS_REGISTRY } from "@ocd-js/observability";

// Structured logging with correlation
const logger = container.resolve(LOGGER);
logger.withCorrelation("req-123", () => {
  logger.info("Processing request", { route: "/users", method: "GET" });
});

// Health probes
const probes = container.resolve(PROBE_REGISTRY);
const results = await probes.runAll();

// Metrics
const metrics = container.resolve(METRICS_REGISTRY);
console.log(metrics.getAll());
```

## Available Packages

### Core Packages
- **@ocd-js/core** – DI container, decorators, routing, validation, module system
- **@ocd-js/server** – Express HTTP adapter with versioning support
- **@ocd-js/cli** – CLI tools for scaffolding and code generation

### Security & Auth
- **@ocd-js/security** – Security middlewares (rate limiting, CORS, CSRF, CSP, sanitization, audit logging)
- **@ocd-js/auth** – Authentication strategies (JWT, Session, OAuth) with guards and decorators

### Data & Persistence
- **@ocd-js/orm** – Full-featured ORM with repository pattern, migrations, transactions, relations, lazy loading, identity map, second-level cache, query instrumentation

### Observability & Performance
- **@ocd-js/observability** – Structured logging, health probes, metrics registry, error boundaries, retry helpers
- **@ocd-js/performance** – Pipeline manager, caching, worker offload, HTTP/2 and WebSocket servers

### Developer Tools
- **@ocd-js/testing** – Testing utilities and helpers
- **@ocd-js/dev-server** – Development server with hot reload
- **@ocd-js/tooling** – Additional development tools
- **@ocd-js/contract-testing** – Contract testing utilities

### Extensions
- **@ocd-js/plugins** – Plugin system with lifecycle hooks
- **@ocd-js/integrations** – Third-party integrations
- **@ocd-js/feature-flags** – Feature flag management
- **@ocd-js/governance** – Policy and governance tools

## Examples

Check the `examples/` directory for complete working examples:

```bash
# Run the example server
npm run dev
```

## CLI Reference

### Create new project
```bash
ocd new <project-name>
```

### Generate artifacts
```bash
# Generate a module
ocd generate module <name>

# Generate a controller
ocd generate controller <name>

# Generate a service
ocd generate service <name>

# Generate a full CRUD stack
ocd crud <ResourceName> --fields "title:string,status:string,amount:number"
```

### Database migrations
```bash
# Run migrations
ocd migrate up --entry dist/migrations/index.js --driver sqlite --sqlite-file db.sqlite

# Rollback migrations
ocd migrate down --entry dist/migrations/index.js --driver sqlite --sqlite-file db.sqlite

# Generate schema plan
ocd schema:plan --entry dist/entities/index.js --driver postgres --dialect postgres
```

### Database seeding
```bash
# Run seeders
ocd seed --entry dist/seeds/index.js --driver sqlite --sqlite-file db.sqlite

# Run specific seeders
ocd seed --entry dist/seeds/index.js --only user-seeder,product-seeder
```

### Upgrade packages
```bash
# Upgrade to latest
ocd upgrade

# Upgrade to specific tag
ocd upgrade --tag beta
```

## Publishing

This package is published to npm as `ocd-js`.

### For Users
```bash
# Install globally
npm install -g ocd-js

# Or use npx
npx ocd-js new my-app
```

### For Maintainers
```bash
# Build all packages
npm run build

# Run tests
npm run test

# Publish to npm
npm publish --access public --tag beta   # for beta releases
npm publish --access public              # for stable releases
```

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request on [GitHub](https://github.com/hidesec/ocd-js).

---

Need help or have ideas? Open an issue or start a discussion—OCD-JS is designed to be extensible and community-friendly.
