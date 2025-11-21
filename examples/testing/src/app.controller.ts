import { Controller, Get, Inject } from "@ocd-js/core";
import { AppService } from "./app.service";

@Controller({ basePath: "/testing", version: "v1" })
export class AppController {
  constructor(@Inject(AppService) private readonly service: AppService) {}

  @Get("/message")
  message() {
    return { message: this.service.getMessage() };
  }

  @Get("/users")
  users() {
    return this.service.listUsers();
  }
}
