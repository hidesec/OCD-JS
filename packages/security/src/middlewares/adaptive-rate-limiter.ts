import { Injectable } from "@ocd-js/core";
import type { SecurityContext, SecurityMiddleware, SecurityNext } from "../types";

export interface RateLimiterOptions {
  windowMs: number;
  baseLimit: number;
  penaltyMultiplier?: number;
}

interface BucketState {
  count: number;
  expiresAt: number;
}

@Injectable()
export class AdaptiveRateLimiter implements SecurityMiddleware {
  public readonly name = "AdaptiveRateLimiter";
  private readonly store = new Map<string, BucketState>();

  constructor(private readonly options: RateLimiterOptions = { windowMs: 60_000, baseLimit: 100, penaltyMultiplier: 2 }) {}

  async handle(context: SecurityContext, next: SecurityNext): Promise<void> {
    const key = this.resolveKey(context);
    const state = this.consumeBucket(key);
    if (!state.allowed) {
      throw new Error(`Rate limit exceeded. Try again in ${Math.ceil((state.expiresAt - Date.now()) / 1000)}s`);
    }
    await next();
  }

  private consumeBucket(key: string) {
    const now = Date.now();
    const existing = this.store.get(key);
    const windowMs = this.options.windowMs;

    if (!existing || existing.expiresAt <= now) {
      const expiresAt = now + windowMs;
      const next = { count: 1, expiresAt };
      this.store.set(key, next);
      return { allowed: true, expiresAt };
    }

    const penaltyMultiplier = this.options.penaltyMultiplier ?? 2;
    const dynamicLimit = this.options.baseLimit * penaltyMultiplier;
    if (existing.count >= dynamicLimit) {
      existing.expiresAt = now + windowMs * penaltyMultiplier;
      this.store.set(key, existing);
      return { allowed: false, expiresAt: existing.expiresAt };
    }
    existing.count += 1;
    this.store.set(key, existing);
    return { allowed: true, expiresAt: existing.expiresAt };
  }

  private resolveKey(context: SecurityContext): string {
    return context.ip ?? context.headers["x-forwarded-for"] ?? context.requestId;
  }
}
