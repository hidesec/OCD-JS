import {
  CompiledRoute,
  Guard,
  GuardContext,
  RouteEnhancer,
  applyValidationEnhancers,
  createApplicationContext,
} from "@ocd-js/core";
import util from "node:util";
import { AppModule } from "./app.module";
import { ProjectController } from "./app.controller";
import { CreateProjectDto, ListProjectsQuery } from "./dtos";
import { REQUEST_CONTEXT, RequestContext } from "./tokens";

type GuardEnhancer = Extract<RouteEnhancer, { kind: "guard" }>;

const guardEnhancers = (enhancers: RouteEnhancer[] = []): GuardEnhancer[] =>
  enhancers.filter(
    (enhancer): enhancer is GuardEnhancer => enhancer.kind === "guard",
  );

interface Scenario {
  label: string;
  handler: string;
  body?: unknown;
  query?: Record<string, unknown>;
  context: RequestContext;
}

const format = (value: unknown) =>
  util.inspect(value, { depth: 3, colors: false });

async function runScenario(
  route: CompiledRoute,
  scenario: Scenario,
): Promise<void> {
  const requestScope = app.beginRequest([
    {
      token: REQUEST_CONTEXT,
      useValue: scenario.context,
      scope: "request",
    },
  ]);

  const guardContext: GuardContext = {
    request: scenario.context,
    container: requestScope.container,
  };

  for (const enhancer of guardEnhancers(route.enhancers)) {
    const guard = requestScope.container.resolve(enhancer.guardToken) as Guard;
    const allowed = await guard.canActivate(guardContext);
    if (!allowed) {
      console.warn(
        `scenario:${scenario.label} blocked by ${guard.constructor.name}`,
      );
      return;
    }
  }

  const validated = applyValidationEnhancers(route.enhancers, {
    body: scenario.body,
    query: scenario.query,
    params: {},
  });

  const controller = requestScope.container.resolve(
    route.controller,
  ) as ProjectController;

  let response: unknown;
  if (route.handlerKey === "list") {
    response = controller.list((validated.query ?? {}) as ListProjectsQuery);
  } else if (route.handlerKey === "create") {
    response = controller.create(
      validated.body as CreateProjectDto,
      requestScope.container.resolve(REQUEST_CONTEXT),
    );
  } else {
    response = controller.status();
  }

  console.log(`scenario:${scenario.label} ->`, format(response));
}

const app = createApplicationContext(AppModule);

async function bootstrap() {
  const snapshot = app.snapshot();
  console.log(
    "registered modules",
    snapshot.modules.map((manifest) => manifest.type.name),
  );
  console.log(
    "routes",
    app.routes.map((route) => ({
      method: route.method,
      path: route.path,
      version: route.version,
      tags: route.tags,
      validations:
        route.enhancers?.filter((enhancer) => enhancer.kind === "validation")
          .length ?? 0,
      guards:
        route.enhancers?.filter((enhancer) => enhancer.kind === "guard")
          .length ?? 0,
    })),
  );

  const routeByHandler = new Map<string | symbol, CompiledRoute>();
  app.routes
    .filter((route) => route.controller === ProjectController)
    .forEach((route) => routeByHandler.set(route.handlerKey, route));

  const scenarios: Scenario[] = [
    {
      label: "list-default",
      handler: "list",
      query: {},
      context: { id: "req-001" },
    },
    {
      label: "create-denied",
      handler: "create",
      body: { name: "Core Intro", owner: "docs" },
      context: { id: "req-002", user: { id: "dev-1", roles: ["editor"] } },
    },
    {
      label: "create-admin",
      handler: "create",
      body: { name: "Core Deep Dive", owner: "platform", budget: 25000 },
      context: {
        id: "req-003",
        user: { id: "lead", roles: ["admin", "editor"] },
      },
    },
    {
      label: "status-v2",
      handler: "status",
      context: { id: "req-004" },
    },
  ];

  for (const scenario of scenarios) {
    const route = routeByHandler.get(scenario.handler);
    if (!route) {
      throw new Error(`Route metadata missing for handler ${scenario.handler}`);
    }
    await runScenario(route, scenario);
  }
}

bootstrap().catch((error) => {
  console.error("Core runner failed", error);
  process.exit(1);
});
