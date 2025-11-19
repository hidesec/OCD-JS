import { Module } from "@ocd-js/core";

export const CLOUD_SECRETS = Symbol.for("OCD_CLOUD_SECRETS");
export const CLOUD_PUBSUB = Symbol.for("OCD_CLOUD_PUBSUB");

export interface CloudSecretsClient {
  getSecret(key: string): Promise<string | undefined>;
}

export interface CloudPubSubClient {
  publish(topic: string, payload: unknown): Promise<void>;
  subscribe(
    topic: string,
    handler: (payload: unknown) => Promise<void> | void,
  ): void;
}

class MemorySecretsClient implements CloudSecretsClient {
  private readonly secrets = new Map<string, string>();

  async getSecret(key: string): Promise<string | undefined> {
    return this.secrets.get(key);
  }

  setSecret(key: string, value: string) {
    this.secrets.set(key, value);
  }
}

class MemoryPubSubClient implements CloudPubSubClient {
  private readonly subscribers = new Map<
    string,
    Array<(payload: unknown) => void>
  >();

  async publish(topic: string, payload: unknown): Promise<void> {
    const handlers = this.subscribers.get(topic) ?? [];
    handlers.forEach((handler) => handler(payload));
  }

  subscribe(
    topic: string,
    handler: (payload: unknown) => Promise<void> | void,
  ): void {
    const list = this.subscribers.get(topic) ?? [];
    list.push((payload) => handler(payload));
    this.subscribers.set(topic, list);
  }
}

@Module({
  providers: [
    {
      token: CLOUD_SECRETS,
      useClass: MemorySecretsClient,
    },
    {
      token: CLOUD_PUBSUB,
      useClass: MemoryPubSubClient,
    },
  ],
  exports: [CLOUD_SECRETS, CLOUD_PUBSUB],
})
export class CloudModule {}
