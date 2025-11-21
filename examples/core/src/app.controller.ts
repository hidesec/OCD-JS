import {
  Controller,
  Get,
  Inject,
  Post,
  ValidateBody,
  ValidateQuery,
  UseGuards,
} from "@ocd-js/core";
import { UseSecurity } from "@ocd-js/security";
import {
  CreateProjectDto,
  ListProjectsQuery,
  listProjectsSchema,
} from "./dtos";
import { AdminGuard } from "./guards";
import { ProjectService } from "./project.service";
import { BASELINE_SECURITY_MIDDLEWARES } from "./security";
import { RequestContext } from "./tokens";

@Controller({ basePath: "/projects", version: "1", tags: ["core", "projects"] })
export class ProjectController {
  constructor(
    @Inject(ProjectService) private readonly service: ProjectService,
  ) {}

  @Get("/", { version: "1" })
  @ValidateQuery(listProjectsSchema)
  @UseSecurity(...BASELINE_SECURITY_MIDDLEWARES)
  list(query: ListProjectsQuery) {
    return this.service.listProjects(query);
  }

  @Post("/")
  @ValidateBody(CreateProjectDto)
  @UseGuards(AdminGuard)
  @UseSecurity(...BASELINE_SECURITY_MIDDLEWARES)
  async create(body: CreateProjectDto, context: RequestContext) {
    return this.service.createProject(body, context);
  }

  @Get("/status", { version: "2" })
  @UseSecurity(...BASELINE_SECURITY_MIDDLEWARES)
  status() {
    return {
      message: "core router supports versioned endpoints",
      at: new Date().toISOString(),
    };
  }
}
