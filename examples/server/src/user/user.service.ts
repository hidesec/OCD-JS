import { Inject, Injectable } from "@ocd-js/core";
import {
  LOGGER,
  METRICS_REGISTRY,
  MetricsRegistry,
  StructuredLogger,
  UseMetrics,
  Measure,
  Retryable,
  HealthCheck,
} from "@ocd-js/observability";
import type { AppConfig } from "../config/app-config";
import { APP_CONFIG } from "./user.module";
import { CreateUserInput } from "./dto/create-user.dto";

export interface UserRecord {
  id: number;
  name: string;
}

@UseMetrics()
@Injectable()
export class UserService {
  private readonly users: UserRecord[] = [
    { id: 1, name: `Env: ${this.config.NODE_ENV}` },
  ];

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(METRICS_REGISTRY) private readonly metrics: MetricsRegistry,
    @Inject(LOGGER) private readonly logger: StructuredLogger,
  ) {}

  @Measure("user_list")
  findAll(): UserRecord[] {
    this.logger.info("Listing users", { total: this.users.length });
    return this.users;
  }

  @Retryable({ attempts: 3, backoffMs: 25, maxBackoffMs: 200 })
  @Measure("user_create")
  create(input: CreateUserInput): UserRecord {
    this.logger.info("Creating user", { name: input.name });
    const record: UserRecord = {
      id: this.users.length + 1,
      name: input.name,
    };
    this.users.push(record);
    return record;
  }

  @HealthCheck("user-cache")
  static cacheProbe() {
    return {
      name: "user-cache",
      status: "up" as const,
      details: "in-memory cache healthy",
    };
  }
}
