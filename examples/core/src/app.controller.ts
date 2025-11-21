import {
  Controller,
  Get,
  Post,
  ValidateBody,
  ValidateQuery,
  UseGuards,
} from "@ocd-js/core";
import {
  CreateProjectDto,
  ListProjectsQuery,
  listProjectsSchema,
} from "./dtos";
import { AdminGuard } from "./guards";
import { ProjectService } from "./project.service";
import { RequestContext } from "./tokens";

@Controller({ basePath: "/projects", version: "1", tags: ["core", "projects"] })
export class ProjectController {
  constructor(private readonly service: ProjectService) {}

  @Get("/", { version: "1" })
  @ValidateQuery(listProjectsSchema)
  list(query: ListProjectsQuery) {
    return this.service.listProjects(query);
  }

  @Post("/")
  @ValidateBody(CreateProjectDto)
  @UseGuards(AdminGuard)
  create(body: CreateProjectDto, context: RequestContext) {
    return this.service.createProject(body, context);
  }

  @Get("/status", { version: "2" })
  status() {
    return {
      message: "core router supports versioned endpoints",
      at: new Date().toISOString(),
    };
  }
}
