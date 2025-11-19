import {
  Controller,
  Get,
  Inject,
  Post,
  RouteSchema,
  ValidateBody,
} from "@ocd-js/core";
import {
  UseSecurity,
  AdaptiveRateLimiter,
  AuditLogger,
  InputSanitizer,
} from "@ocd-js/security";
import { Authenticated, Roles } from "@ocd-js/auth";
import { CreateUserDto, CreateUserInput } from "./dto/create-user.dto";
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

  @Post("/")
  @UseSecurity(InputSanitizer, AdaptiveRateLimiter, AuditLogger)
  @Authenticated()
  @Roles("admin")
  @ValidateBody(CreateUserDto)
  create(body: CreateUserInput) {
    return this.service.create(body);
  }
}
