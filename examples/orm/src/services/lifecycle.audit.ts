import {
  AfterEntityPersistListener,
  AfterEntityRemoveListener,
  BeforeEntityPersistListener,
  BeforeEntityRemoveListener,
  EntityLifecycleEvent,
} from "@ocd-js/orm";

const EVENT_LIMIT = 20;

const pushEvent = (entry: string, buffer: string[]) => {
  buffer.push(entry);
  if (buffer.length > EVENT_LIMIT) {
    buffer.shift();
  }
};

export class LifecycleAuditListeners {
  private static readonly events: string[] = [];

  private static format(payload: EntityLifecycleEvent): string {
    return [
      payload.metadata.tableName,
      payload.action,
      payload.changeSet.changedFields.join(",") || "no-change",
    ].join(":");
  }

  @BeforeEntityPersistListener()
  static beforePersist(payload: EntityLifecycleEvent) {
    pushEvent(`before:${this.format(payload)}`, this.events);
  }

  @AfterEntityPersistListener()
  static afterPersist(payload: EntityLifecycleEvent) {
    pushEvent(`after:${this.format(payload)}`, this.events);
  }

  @BeforeEntityRemoveListener()
  static beforeRemove(payload: EntityLifecycleEvent) {
    pushEvent(`before-remove:${this.format(payload)}`, this.events);
  }

  @AfterEntityRemoveListener()
  static afterRemove(payload: EntityLifecycleEvent) {
    pushEvent(`after-remove:${this.format(payload)}`, this.events);
  }

  static snapshot(): string[] {
    return [...this.events];
  }
}
