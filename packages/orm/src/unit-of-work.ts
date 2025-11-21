import { TransactionDriver } from "./driver";
import { Repository } from "./repository";

interface UnitOfWorkOptions {
  onCommit?: () => void | Promise<void>;
  onRollback?: () => void | Promise<void>;
}

export class UnitOfWork {
  private completed = false;

  constructor(
    private readonly driver: TransactionDriver,
    private readonly resolveRepository: <T extends object>(
      entity: new () => T,
    ) => Repository<T>,
    private readonly options: UnitOfWorkOptions = {},
  ) {}

  getRepository<T extends object>(entity: new () => T): Repository<T> {
    return this.resolveRepository(entity);
  }

  async run<R>(handler: (scope: UnitOfWork) => Promise<R> | R): Promise<R> {
    try {
      const result = await handler(this);
      await this.commit();
      return result;
    } catch (error) {
      await this.rollback();
      throw error;
    }
  }

  async commit(): Promise<void> {
    if (this.completed) return;
    await this.driver.commit();
    if (this.options.onCommit) {
      await this.options.onCommit();
    }
    this.completed = true;
  }

  async rollback(): Promise<void> {
    if (this.completed) return;
    await this.driver.rollback();
    if (this.options.onRollback) {
      await this.options.onRollback();
    }
    this.completed = true;
  }
}
