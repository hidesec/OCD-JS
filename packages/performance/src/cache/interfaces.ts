export interface CacheEntry<T = unknown> {
  value: T;
  expiresAt?: number;
  tags?: string[];
}

export interface CacheStore {
  get<T>(key: string): Promise<T | undefined> | T | undefined;
  set<T>(
    key: string,
    value: T,
    ttlMs?: number,
    tags?: string[],
  ): Promise<void> | void;
  delete(key: string): Promise<void> | void;
  invalidateByTags(tags: string[]): Promise<void> | void;
}

export interface CacheOptions {
  ttlMs?: number;
  tags?: string[];
}
