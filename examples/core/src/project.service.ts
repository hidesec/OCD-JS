import { Inject, Injectable } from "@ocd-js/core";
import {
  POLICY_SERVICE,
  PolicyService,
  PolicyResult,
  OWASP_TOP10_BUNDLE,
} from "@ocd-js/governance";
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

const DEFAULT_LIST_QUERY: ListProjectsQuery = {
  owner: undefined,
  limit: undefined,
};

@Injectable()
export class ProjectService {
  private readonly projects = new Map<string, ProjectRecord>();
  private policySnapshot?: { report: PolicyResult; checkedAt: number };

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(LOGGER) private readonly logger: AppLogger,
    @Inject(POLICY_SERVICE) private readonly policyService: PolicyService,
  ) {}

  listProjects(query: ListProjectsQuery = DEFAULT_LIST_QUERY): ProjectRecord[] {
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

  async createProject(
    payload: CreateProjectDto,
    context: RequestContext,
  ): Promise<ProjectRecord> {
    await this.ensureCompliant();
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

  private async ensureCompliant(): Promise<void> {
    const ttl = 5 * 60 * 1000;
    if (
      this.policySnapshot &&
      Date.now() - this.policySnapshot.checkedAt < ttl
    ) {
      return;
    }
    const report = await this.policyService.evaluate(OWASP_TOP10_BUNDLE);
    this.policySnapshot = { report, checkedAt: Date.now() };
    this.logger.info("policy.snapshot", {
      bundle: report.bundle,
      passed: report.passed,
      failures: report.failures,
    });
    if (!report.passed) {
      throw new Error(
        `Policy bundle ${report.bundle} failed for ${report.failures.join(",")}`,
      );
    }
  }
}
