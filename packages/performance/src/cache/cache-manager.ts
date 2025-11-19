import { CacheOptions, CacheStore } from "./interfaces";
import { MemoryCacheStore } from "./memory-store";

export class CacheManager {
  constructor(private readonly store: CacheStore = new MemoryCacheStore()) {}

  async getOrSet<T>(
    key: string,
    resolver: () => Promise<T> | T,
    options: CacheOptions = {},
  ): Promise<T> {
    const existing = await this.store.get<T>(key);
    if (existing !== undefined) {
      return existing;
    }
    const value = await Promise.resolve(resolver());
    await Promise.resolve(
      this.store.set(key, value, options.ttlMs, options.tags),
    );
    return value;
  }

  async set<T>(key: string, value: T, options: CacheOptions = {}) {
    await Promise.resolve(
      this.store.set(key, value, options.ttlMs, options.tags),
    );
  }

  async delete(key: string) {
    await Promise.resolve(this.store.delete(key));
  }

  async invalidate(tags: string[]) {
    await Promise.resolve(this.store.invalidateByTags(tags));
  }
}
