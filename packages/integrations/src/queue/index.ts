import { Module } from "@ocd-js/core";

export const QUEUE_CLIENT = Symbol.for("OCD_QUEUE_CLIENT");

export interface QueueClient {
  enqueue(queue: string, payload: unknown): Promise<void>;
  process(
    queue: string,
    handler: (payload: unknown) => Promise<void> | void,
  ): void;
}

export class InMemoryQueueClient implements QueueClient {
  private readonly queues = new Map<string, Array<unknown>>();

  async enqueue(queue: string, payload: unknown): Promise<void> {
    const list = this.queues.get(queue) ?? [];
    list.push(payload);
    this.queues.set(queue, list);
  }

  process(
    queue: string,
    handler: (payload: unknown) => Promise<void> | void,
  ): void {
    const list = this.queues.get(queue) ?? [];
    while (list.length) {
      const job = list.shift();
      handler(job);
    }
  }
}

@Module({
  providers: [
    {
      token: QUEUE_CLIENT,
      useClass: InMemoryQueueClient,
    },
  ],
  exports: [QUEUE_CLIENT],
})
export class QueueModule {}
