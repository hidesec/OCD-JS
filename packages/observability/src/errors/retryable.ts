export interface RetryOptions {
  attempts?: number;
  backoffMs?: number;
  maxBackoffMs?: number;
}

export const Retryable = (options: RetryOptions = {}): MethodDecorator => {
  const attempts = Math.max(1, options.attempts ?? 3);
  const backoffMs = options.backoffMs ?? 100;
  const maxBackoffMs = options.maxBackoffMs ?? 2000;

  return (_target, _propertyKey, descriptor?: TypedPropertyDescriptor<any>) => {
    if (!descriptor?.value) {
      return descriptor;
    }
    const original = descriptor.value;
    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      let attempt = 0;
      let delayMs = backoffMs;
      while (attempt < attempts) {
        try {
          return await Promise.resolve(original.apply(this, args));
        } catch (error) {
          attempt += 1;
          if (attempt >= attempts) {
            throw error;
          }
          await wait(delayMs);
          delayMs = Math.min(delayMs * 2, maxBackoffMs);
        }
      }
      throw new Error("Retryable function exhausted attempts");
    } as typeof original;
    return descriptor;
  };
};

const wait = (duration: number) =>
  new Promise((resolve) => setTimeout(resolve, duration));
