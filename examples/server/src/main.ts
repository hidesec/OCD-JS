import { createApplicationContext } from "@ocd-js/core";
import { AppModule } from "./user/user.module";
import { UserController } from "./user/user.controller";

const app = createApplicationContext(AppModule);

console.log("routes", app.routes);

const request = app.beginRequest();
const controller = request.container.resolve(UserController);
console.log(controller.list());
