import { CacheStore } from "./interfaces";

interface MemoryEntry {
  value: unknown;
  expiresAt?: number;
  tags?: string[];
}

export class MemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, MemoryEntry>();

  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs?: number, tags?: string[]): void {
    this.entries.set(key, {
      value,
      expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
      tags,
    });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  invalidateByTags(tags: string[]): void {
    this.entries.forEach((entry, key) => {
      if (entry.tags?.some((tag) => tags.includes(tag))) {
        this.entries.delete(key);
      }
    });
  }
}
