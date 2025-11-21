import {
  applySecurityMiddlewares,
  resolveSecurityTokens,
  SecurityContext,
} from "@ocd-js/security";
import { createApplicationContext } from "@ocd-js/core";
import { AppModule } from "./app.module";
import { SecurityController, CommentInput } from "./app.controller";

interface ScenarioOverrides {
  mutate?: (context: SecurityContext) => void;
  label: string;
}

async function bootstrap() {
  const app = createApplicationContext(AppModule);
  const request = app.beginRequest();
  const controller = request.container.resolve(SecurityController);

  const route = app.routes.find(
    (entry) => entry.handlerKey === "submitComment",
  );
  if (!route?.enhancers) {
    throw new Error("Security route metadata missing");
  }

  const securityTokens = resolveSecurityTokens(route.enhancers);
  const middlewares = securityTokens.map((token) =>
    request.container.resolve(token),
  );

  const baseBody: CommentInput = {
    message: '<script>alert("xss")</script> Hello   ',
    tags: ["<img src=x onerror=alert(1)>", "release"],
  };

  const baseHeaders = {
    origin: "https://dashboard.local",
    "x-csrf-token": "secure-token",
  };

  const baseCookies = {
    csrf_token: "secure-token",
  };

  const runScenario = async ({ label, mutate }: ScenarioOverrides) => {
    const context: SecurityContext = {
      requestId: `req-${label}`,
      method: "POST",
      path: "/security/comments",
      headers: { ...baseHeaders },
      metadata: { cookies: { ...baseCookies } },
      body: JSON.parse(JSON.stringify(baseBody)),
      timestamp: Date.now(),
      ip: "10.0.0.5",
    };

    mutate?.(context);

    try {
      await applySecurityMiddlewares(middlewares, context, async () => {
        const result = controller.submitComment(context.body as CommentInput);
        console.log(`scenario:${label} allowed`, result);
      });
    } catch (error) {
      console.error(`scenario:${label} blocked`, (error as Error).message);
    }
  };

  await runScenario({ label: "allowed-first" });
  await runScenario({ label: "rate-limit" });
  await runScenario({
    label: "csrf-mismatch",
    mutate: (context) => {
      context.headers["x-csrf-token"] = "bad-token";
      context.metadata = {
        ...(context.metadata ?? {}),
        cookies: { csrf_token: "secure-token" },
      };
      context.ip = "10.0.0.9";
    },
  });
}

bootstrap().catch((error) => {
  console.error("Security example failed", error);
  process.exit(1);
});
