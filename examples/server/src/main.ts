import { applyValidationEnhancers, createApplicationContext } from "@ocd-js/core";
import { resolveSecurityTokens } from "@ocd-js/security";
import { AppModule } from "./user/user.module";
import { UserController } from "./user/user.controller";
import { CreateUserInput } from "./user/dto/create-user.dto";

const app = createApplicationContext(AppModule);

console.log("routes", app.routes);

const request = app.beginRequest();
const controller = request.container.resolve(UserController);
console.log(controller.list());

const createRoute = app.routes.find((route) => route.handlerKey === "create");
if (createRoute?.enhancers) {
  const securityTokens = resolveSecurityTokens(createRoute.enhancers);
  console.log("security middlewares", securityTokens.map((token) => (typeof token === "function" ? token.name : String(token))));

  try {
    const validated = applyValidationEnhancers(createRoute.enhancers, {
      body: { name: "Jane", email: "jane@example.com" },
    });
    const payload = validated.body as CreateUserInput;
    console.log("create user", controller.create(payload));
  } catch (error) {
    console.error("validation failed", error);
  }
}
