import { createHmac } from "node:crypto";
import {
  Guard,
  GuardContext,
  RouteEnhancer,
  createApplicationContext,
} from "@ocd-js/core";
import { AuthFlowController } from "./auth.controller";
import { AppModule } from "./app.module";
import { AuthService, AuthenticatedUser, PolicyHandler } from "@ocd-js/auth";

type GuardEnhancer = Extract<RouteEnhancer, { kind: "guard" }>;

async function bootstrap() {
  const app = createApplicationContext(AppModule);
  const requestScope = app.beginRequest();
  const controller = requestScope.container.resolve(AuthFlowController);
  const auth = requestScope.container.resolve(AuthService);

  auth.registerPolicy(createPaidSubscriptionPolicy());

  const secret = "changeme";
  const freeToken = signJwt(
    {
      id: "user-1",
      roles: ["user"],
      metadata: { plan: "free" },
    },
    secret,
  );
  const adminToken = signJwt(
    {
      id: "admin-1",
      roles: ["admin"],
      metadata: { plan: "pro" },
    },
    secret,
  );

  console.log(
    "registered routes",
    app.routes.map((route) => route.path),
  );

  await runRoute(
    requestScope,
    controller,
    findRoute(app, "profile"),
    "profile:missing-token",
    "",
  );
  await runRoute(
    requestScope,
    controller,
    findRoute(app, "profile"),
    "profile:authorized",
    freeToken,
  );
  await runRoute(
    requestScope,
    controller,
    findRoute(app, "adminPanel"),
    "admin:basic-user",
    freeToken,
  );
  await runRoute(
    requestScope,
    controller,
    findRoute(app, "adminPanel"),
    "admin:admin-role",
    adminToken,
  );
  await runRoute(
    requestScope,
    controller,
    findRoute(app, "proFeatures"),
    "policy:free-plan",
    freeToken,
  );
  await runRoute(
    requestScope,
    controller,
    findRoute(app, "proFeatures"),
    "policy:paid-plan",
    adminToken,
  );
}

function createPaidSubscriptionPolicy(): PolicyHandler {
  return {
    name: "paid-subscription",
    evaluate: (user: AuthenticatedUser) => user.metadata?.plan === "pro",
  };
}

async function runRoute(
  requestScope: ReturnType<
    ReturnType<typeof createApplicationContext>["beginRequest"]
  >,
  controller: AuthFlowController,
  route: ReturnType<typeof findRoute>,
  label: string,
  token: string,
) {
  if (!route) {
    throw new Error("Route metadata missing");
  }
  const guards = guardEnhancers(route.enhancers);
  const context: GuardContext<{
    headers?: Record<string, string>;
    user?: AuthenticatedUser;
  }> = {
    request: {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    },
    container: requestScope.container,
  };
  for (const enhancer of guards) {
    const guard = requestScope.container.resolve(enhancer.guardToken) as Guard;
    const allowed = await guard.canActivate(context, enhancer.options);
    if (!allowed) {
      console.warn(`scenario:${label} blocked`, {
        guard: guard.constructor.name,
        options: enhancer.options,
      });
      return;
    }
  }
  const handler = route.handlerKey as keyof AuthFlowController;
  const payload = await (controller[handler] as () => unknown).call(controller);
  console.log(`scenario:${label} allowed`, payload);
}

const guardEnhancers = (
  enhancers: RouteEnhancer[] | undefined,
): GuardEnhancer[] =>
  (enhancers ?? []).filter(
    (entry): entry is GuardEnhancer => entry.kind === "guard",
  );

const findRoute = (
  app: ReturnType<typeof createApplicationContext>,
  handlerKey: string,
) => app.routes.find((route) => route.handlerKey === handlerKey);

const signJwt = (user: AuthenticatedUser, secret: string): string => {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
    "utf-8",
  ).toString("base64url");
  const payload = Buffer.from(JSON.stringify(user), "utf-8").toString(
    "base64url",
  );
  const signature = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
};

bootstrap().catch((error) => {
  console.error("Auth workflow failed", error);
  process.exit(1);
});
