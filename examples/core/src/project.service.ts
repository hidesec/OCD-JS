import { Inject, Injectable } from "@ocd-js/core";
import { randomUUID } from "node:crypto";
import { AppConfig } from "./config";
import { CreateProjectDto, ListProjectsQuery } from "./dtos";
import { APP_CONFIG, LOGGER, AppLogger, RequestContext } from "./tokens";

export interface ProjectRecord {
  id: string;
  name: string;
  owner: string;
  budget?: number;
  createdAt: string;
  stage: string;
  createdBy?: string;
}

@Injectable()
export class ProjectService {
  private readonly projects = new Map<string, ProjectRecord>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(LOGGER) private readonly logger: AppLogger,
  ) {}

  listProjects(query: ListProjectsQuery = {}): ProjectRecord[] {
    const entries = Array.from(this.projects.values());
    const filtered = query.owner
      ? entries.filter((project) => project.owner === query.owner)
      : entries;
    const limited = filtered.slice(0, query.limit ?? 10);
    this.logger.info("project.list", {
      requested: query,
      returned: limited.length,
      stage: this.config.STAGE,
    });
    return limited;
  }

  createProject(
    payload: CreateProjectDto,
    context: RequestContext,
  ): ProjectRecord {
    const record: ProjectRecord = {
      id: randomUUID(),
      name: payload.name,
      owner: payload.owner,
      budget: payload.budget,
      createdAt: new Date().toISOString(),
      stage: this.config.STAGE,
      createdBy: context.user?.id,
    };
    this.projects.set(record.id, record);
    this.logger.info("project.created", {
      id: record.id,
      config: this.config.APP_NAME,
      analyticsEnabled: this.config.ENABLE_ANALYTICS,
    });
    return record;
  }
}
