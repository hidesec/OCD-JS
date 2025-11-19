export interface EnvField<T> {
  parse(value: string | undefined, key: string): T;
}

export type InferEnv<T extends Record<string, EnvField<any>>> = {
  [K in keyof T]: T[K] extends EnvField<infer R> ? R : never;
};

export interface EnvSchema<T extends Record<string, EnvField<any>>> {
  fields: T;
  parse(source?: Record<string, string | undefined>): InferEnv<T>;
}

export const defineEnvSchema = <T extends Record<string, EnvField<any>>>(
  fields: T,
): EnvSchema<T> => ({
  fields,
  parse: (source = process.env) => {
    const result: Partial<InferEnv<T>> = {};
    (Object.keys(fields) as Array<keyof T>).forEach((key) => {
      const field = fields[key];
      result[key] = field.parse(source[key as string], key as string);
    });
    return result as InferEnv<T>;
  },
});

export const loadConfig = <T extends Record<string, EnvField<any>>>(
  schema: EnvSchema<T>,
  source?: Record<string, string | undefined>,
) => schema.parse(source);

export const env = {
  string: (
    options: { default?: string; pattern?: RegExp } = {},
  ): EnvField<string> => ({
    parse: (value, key) => {
      const resolved = ensureValue(value, key, options.default);
      if (options.pattern && !options.pattern.test(resolved)) {
        throw new Error(
          `Environment variable ${key} does not match required pattern`,
        );
      }
      return resolved;
    },
  }),
  number: (options: { default?: number } = {}): EnvField<number> => ({
    parse: (value, key) => {
      const resolved = ensureValue(value, key, options.default?.toString());
      const parsed = Number(resolved);
      if (Number.isNaN(parsed)) {
        throw new Error(`Environment variable ${key} must be a number`);
      }
      return parsed;
    },
  }),
  boolean: (options: { default?: boolean } = {}): EnvField<boolean> => ({
    parse: (value, key) => {
      const resolved = ensureValue(
        value,
        key,
        options.default !== undefined ? String(options.default) : undefined,
      );
      if (["true", "1", "yes", "on"].includes(resolved.toLowerCase())) {
        return true;
      }
      if (["false", "0", "no", "off"].includes(resolved.toLowerCase())) {
        return false;
      }
      throw new Error(`Environment variable ${key} must be boolean`);
    },
  }),
  optional: <T>(field: EnvField<T>, fallback?: T): EnvField<T | undefined> => ({
    parse: (value, key) => {
      if (value === undefined || value === "") {
        return fallback;
      }
      return field.parse(value, key);
    },
  }),
};

const ensureValue = (
  value: string | undefined,
  key: string,
  fallback?: string,
): string => {
  if (value === undefined || value === "") {
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error(`Environment variable ${key} is required`);
  }
  return value;
};
