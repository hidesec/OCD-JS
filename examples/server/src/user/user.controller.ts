import { Controller, Get, Inject, RouteSchema } from "@ocd-js/core";
import { UserService } from "./user.service";

const listSchema: RouteSchema = {
  response: {
    type: "array",
    items: {
      type: "object",
      properties: {
        id: { type: "number" },
        name: { type: "string" },
      },
    },
  },
};

@Controller({ basePath: "/users", version: "v1" })
export class UserController {
  constructor(@Inject(UserService) private readonly service: UserService) {}

  @Get("/", { schema: listSchema })
  list() {
    return this.service.findAll();
  }
}
