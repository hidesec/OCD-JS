import { Inject, Injectable } from "@ocd-js/core";
import {
  CLOUD_PUBSUB,
  CLOUD_SECRETS,
  CloudPubSubClient,
  CloudSecretsClient,
  DB_CLIENT,
  DatabaseClient,
  QUEUE_CLIENT,
  QueueClient,
  STORAGE_CLIENT,
  StorageClient,
} from "@ocd-js/integrations";

interface IntegrationSummary {
  users: Array<{ id: number; email: string }>;
  queueJobs: unknown[];
  snapshot?: string;
  apiKey: string;
  lastPublishedEvent?: unknown;
}

@Injectable()
export class IntegrationService {
  private readonly receivedEvents: unknown[] = [];

  constructor(
    @Inject(DB_CLIENT) private readonly db: DatabaseClient,
    @Inject(QUEUE_CLIENT) private readonly queue: QueueClient,
    @Inject(STORAGE_CLIENT) private readonly storage: StorageClient,
    @Inject(CLOUD_SECRETS) private readonly secrets: CloudSecretsClient,
    @Inject(CLOUD_PUBSUB) private readonly pubsub: CloudPubSubClient,
  ) {
    this.pubsub.subscribe("events.user.created", async (payload) => {
      this.receivedEvents.push(payload);
    });
  }

  async runScenario(): Promise<IntegrationSummary> {
    await this.seedUsers();
    const users = await this.db.query<{ id: number; email: string }>("users");
    const queueJobs = await this.dispatchEmailJobs();
    const snapshot = await this.createSnapshot(users);
    const apiKey = await this.readApiKey("third-party/api-key");
    const lastPublishedEvent = await this.publishUserEvent({
      kind: "welcome",
      userId: users.at(-1)?.id,
    });

    return {
      users,
      queueJobs,
      snapshot,
      apiKey,
      lastPublishedEvent,
    };
  }

  private async seedUsers() {
    await this.db.insert("users", { id: 1, email: "alice@example.com" });
    await this.db.insert("users", { id: 2, email: "bob@example.com" });
  }

  private async dispatchEmailJobs() {
    await this.queue.enqueue("emails", { userId: 1, template: "welcome" });
    await this.queue.enqueue("emails", { userId: 2, template: "changelog" });

    const processed: unknown[] = [];
    this.queue.process("emails", (payload) => {
      processed.push(payload);
    });
    return processed;
  }

  private async createSnapshot(users: Array<{ id: number; email: string }>) {
    const key = "snapshots/users.json";
    await this.storage.putObject(key, JSON.stringify(users));
    const buffer = await this.storage.getObject(key);
    return buffer?.toString("utf-8");
  }

  private async readApiKey(key: string) {
    return (await this.secrets.getSecret(key)) ?? "<missing>";
  }

  private async publishUserEvent(event: unknown) {
    await this.pubsub.publish("events.user.created", event);
    return this.receivedEvents.at(-1);
  }
}
