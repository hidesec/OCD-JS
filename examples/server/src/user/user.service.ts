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
import { CACHE_MANAGER, CacheManager, Cached } from "@ocd-js/performance";
import type { AppConfig } from "../config/app-config";
import { APP_CONFIG } from "./user.module";
import { CreateUserInput } from "./dto/create-user.dto";
import {
  DB_CLIENT,
  DatabaseClient,
  QUEUE_CLIENT,
  QueueClient,
  STORAGE_CLIENT,
  StorageClient,
  CLOUD_PUBSUB,
  CloudPubSubClient,
} from "@ocd-js/integrations";

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
    @Inject(CACHE_MANAGER) private readonly cache: CacheManager,
    @Inject(DB_CLIENT) private readonly db: DatabaseClient,
    @Inject(QUEUE_CLIENT) private readonly queue: QueueClient,
    @Inject(STORAGE_CLIENT) private readonly storage: StorageClient,
    @Inject(CLOUD_PUBSUB) private readonly pubsub: CloudPubSubClient,
  ) {}

  @Measure("user_list")
  @Cached({ key: "users:list", ttlMs: 1000, tags: ["users"] })
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
    this.db.insert("users", record);
    this.queue.enqueue("user-events", { type: "CREATED", payload: record });
    this.storage.putObject(
      `user:${record.id}`,
      Buffer.from(JSON.stringify(record)),
    );
    this.pubsub.publish("user.created", record);
    this.cache.invalidate(["users"]);
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
