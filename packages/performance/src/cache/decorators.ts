import type { CacheManager } from "./cache-manager";

interface CachedOptions {
  key: string | ((...args: unknown[]) => string);
  ttlMs?: number;
  tags?: string[] | ((result: unknown) => string[]);
}

export const Cached = (options: CachedOptions): MethodDecorator => {
  return (_target, _propertyKey, descriptor?: TypedPropertyDescriptor<any>) => {
    if (!descriptor?.value) {
      return descriptor;
    }
    const original = descriptor.value;
    descriptor.value = async function (...args: unknown[]) {
      const cache: CacheManager | undefined =
        (this as any).cacheManager ?? (this as any).cache;
      if (!cache) {
        return original.apply(this, args);
      }
      const key =
        typeof options.key === "function" ? options.key(...args) : options.key;
      return cache.getOrSet(key, async () => {
        const result = await Promise.resolve(original.apply(this, args));
        const tags =
          typeof options.tags === "function"
            ? options.tags(result)
            : options.tags;
        await cache.set(key, result, { ttlMs: options.ttlMs, tags });
        return result;
      });
    };
    return descriptor;
  };
};
