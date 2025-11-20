export type RetryMatcher = string | RegExp | ((error: unknown) => boolean);

export interface DriverResilienceOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  maxDelayMs?: number;
  retryableErrors?: RetryMatcher[];
}

export interface ResolvedDriverResilienceOptions {
  maxRetries: number;
  retryDelayMs: number;
  maxDelayMs: number;
  retryableErrors: RetryMatcher[];
}

const DEFAULT_RETRYABLE: RetryMatcher[] = [
  "ECONNRESET",
  "ETIMEDOUT",
  "PROTOCOL_CONNECTION_LOST",
  "57P01",
  "57P02",
  "57P03",
  "53300",
  "53400",
  "40001",
  "CR_SERVER_GONE_ERROR",
  "CR_SERVER_LOST",
  "ER_LOCK_DEADLOCK",
  "ER_LOCK_WAIT_TIMEOUT",
];

const DEFAULTS: ResolvedDriverResilienceOptions = {
  maxRetries: 3,
  retryDelayMs: 200,
  maxDelayMs: 1_000,
  retryableErrors: DEFAULT_RETRYABLE,
};

export const resolveDriverResilienceOptions = (
  options?: DriverResilienceOptions,
): ResolvedDriverResilienceOptions => ({
  maxRetries: options?.maxRetries ?? DEFAULTS.maxRetries,
  retryDelayMs: options?.retryDelayMs ?? DEFAULTS.retryDelayMs,
  maxDelayMs: options?.maxDelayMs ?? DEFAULTS.maxDelayMs,
  retryableErrors:
    options?.retryableErrors && options.retryableErrors.length
      ? options.retryableErrors
      : DEFAULTS.retryableErrors,
});

export const executeWithResilience = async <T>(
  task: (attempt: number) => Promise<T>,
  options?: DriverResilienceOptions | ResolvedDriverResilienceOptions,
): Promise<T> => {
  const resolved = isResolved(options)
    ? options
    : resolveDriverResilienceOptions(options);
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await task(attempt + 1);
    } catch (error) {
      attempt += 1;
      if (
        attempt > resolved.maxRetries ||
        !shouldRetry(error, resolved, attempt)
      ) {
        throw error;
      }
      await delay(backoff(attempt, resolved));
    }
  }
};

const shouldRetry = (
  error: unknown,
  options: ResolvedDriverResilienceOptions,
  attempt: number,
) => {
  const info = extractErrorInfo(error);
  return options.retryableErrors.some((matcher) => matchError(matcher, info));
};

const matchError = (matcher: RetryMatcher, info: ErrorInfo): boolean => {
  if (typeof matcher === "string") {
    return (
      info.code === matcher ||
      info.errno === matcher ||
      info.sqlState === matcher ||
      info.message.includes(matcher)
    );
  }
  if (matcher instanceof RegExp) {
    return (
      matcher.test(info.message) ||
      (info.code ? matcher.test(info.code) : false)
    );
  }
  return matcher(info.source);
};

const backoff = (attempt: number, options: ResolvedDriverResilienceOptions) => {
  const base = options.retryDelayMs * 2 ** (attempt - 1);
  return Math.min(base, options.maxDelayMs);
};

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

interface ErrorInfo {
  code?: string;
  errno?: string;
  sqlState?: string;
  message: string;
  source: unknown;
}

const extractErrorInfo = (error: unknown): ErrorInfo => {
  if (error && typeof error === "object") {
    const entry = error as Record<string, unknown>;
    return {
      code: toOptionalString(entry.code ?? entry.errno),
      errno: toOptionalString(entry.errno),
      sqlState: toOptionalString(entry.sqlState ?? entry.sqlstate),
      message: toOptionalString(entry.message) ?? String(error),
      source: error,
    };
  }
  return {
    code: undefined,
    errno: undefined,
    sqlState: undefined,
    message: String(error),
    source: error,
  };
};

const toOptionalString = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  return String(value);
};

const isResolved = (
  value?: DriverResilienceOptions | ResolvedDriverResilienceOptions,
): value is ResolvedDriverResilienceOptions => {
  if (!value) return false;
  return (
    typeof value.maxRetries === "number" &&
    typeof value.retryDelayMs === "number" &&
    typeof value.maxDelayMs === "number" &&
    Array.isArray(value.retryableErrors)
  );
};
