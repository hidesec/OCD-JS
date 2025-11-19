export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ParseResult<T> {
  success: boolean;
  data?: T;
  issues?: ValidationIssue[];
}

export interface Schema<T> {
  parse(value: unknown, path?: string[]): ParseResult<T>;
}

export type InferSchema<TSchema> = TSchema extends Schema<infer TValue> ? TValue : never;

export type SchemaRecord = Record<string, Schema<any>>;

const success = <T>(data: T): ParseResult<T> => ({ success: true, data });

const failure = (issue: ValidationIssue): ParseResult<never> => ({ success: false, issues: [issue] });

const mergeIssues = (issues: ValidationIssue[][]): ValidationIssue[] =>
  issues.reduce<ValidationIssue[]>((all, batch) => (batch ? all.concat(batch) : all), []);

const normalizePath = (path: string[]): string => (path.length ? path.join(".") : "");

export interface StringOptions {
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  transform?: (value: string) => string;
}

export const string = (options: StringOptions = {}): Schema<string> => ({
  parse: (value, path = []) => {
    if (typeof value !== "string") {
      return failure({ path: normalizePath(path), message: "Expected string" });
    }
    const transformed = options.transform ? options.transform(value) : value;
    if (options.minLength !== undefined && transformed.length < options.minLength) {
      return failure({ path: normalizePath(path), message: `Minimum length is ${options.minLength}` });
    }
    if (options.maxLength !== undefined && transformed.length > options.maxLength) {
      return failure({ path: normalizePath(path), message: `Maximum length is ${options.maxLength}` });
    }
    if (options.pattern && !options.pattern.test(transformed)) {
      return failure({ path: normalizePath(path), message: "Value does not match required pattern" });
    }
    return success(transformed);
  },
});

export interface NumberOptions {
  min?: number;
  max?: number;
  integer?: boolean;
}

export const number = (options: NumberOptions = {}): Schema<number> => ({
  parse: (value, path = []) => {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return failure({ path: normalizePath(path), message: "Expected number" });
    }
    if (options.integer && !Number.isInteger(value)) {
      return failure({ path: normalizePath(path), message: "Expected integer" });
    }
    if (options.min !== undefined && value < options.min) {
      return failure({ path: normalizePath(path), message: `Minimum value is ${options.min}` });
    }
    if (options.max !== undefined && value > options.max) {
      return failure({ path: normalizePath(path), message: `Maximum value is ${options.max}` });
    }
    return success(value);
  },
});

export const boolean = (): Schema<boolean> => ({
  parse: (value, path = []) => {
    if (typeof value === "boolean") {
      return success(value);
    }
    if (typeof value === "string") {
      if (["true", "1", "yes"].includes(value.toLowerCase())) {
        return success(true);
      }
      if (["false", "0", "no"].includes(value.toLowerCase())) {
        return success(false);
      }
    }
    return failure({ path: normalizePath(path), message: "Expected boolean" });
  },
});

export const literal = <T extends string | number | boolean>(expected: T): Schema<T> => ({
  parse: (value, path = []) => {
    if (value !== expected) {
      return failure({ path: normalizePath(path), message: `Expected literal ${String(expected)}` });
    }
    return success(expected);
  },
});

export const enumeration = <T extends string>(values: readonly T[]): Schema<T> => ({
  parse: (value, path = []) => {
    if (!values.includes(value as T)) {
      return failure({ path: normalizePath(path), message: `Expected one of: ${values.join(", ")}` });
    }
    return success(value as T);
  },
});

export const array = <T>(inner: Schema<T>, options: { minLength?: number; maxLength?: number } = {}): Schema<T[]> => ({
  parse: (value, path = []) => {
    if (!Array.isArray(value)) {
      return failure({ path: normalizePath(path), message: "Expected array" });
    }
    if (options.minLength !== undefined && value.length < options.minLength) {
      return failure({ path: normalizePath(path), message: `Array must contain at least ${options.minLength} items` });
    }
    if (options.maxLength !== undefined && value.length > options.maxLength) {
      return failure({ path: normalizePath(path), message: `Array must contain at most ${options.maxLength} items` });
    }
    const parsedItems: T[] = [];
    const issues: ValidationIssue[] = [];
    value.forEach((item, index) => {
      const result = inner.parse(item, path.concat(String(index)));
      if (result.success && result.data !== undefined) {
        parsedItems.push(result.data);
      } else if (result.issues) {
        issues.push(...result.issues);
      }
    });
    if (issues.length) {
      return { success: false, issues };
    }
    return success(parsedItems);
  },
});

export const record = <T>(inner: Schema<T>): Schema<Record<string, T>> => ({
  parse: (value, path = []) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return failure({ path: normalizePath(path), message: "Expected record" });
    }
    const result: Record<string, T> = {};
    const issues: ValidationIssue[] = [];
    Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
      const parsed = inner.parse(entry, path.concat(key));
      if (parsed.success && parsed.data !== undefined) {
        result[key] = parsed.data;
      } else if (parsed.issues) {
        issues.push(...parsed.issues);
      }
    });
    if (issues.length) {
      return { success: false, issues };
    }
    return success(result);
  },
});

export const object = <TShape extends SchemaRecord>(shape: TShape): Schema<{ [K in keyof TShape]: InferSchema<TShape[K]> }> => ({
  parse: (value, path = []) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return failure({ path: normalizePath(path), message: "Expected object" });
    }
    const output: Record<string, unknown> = {};
    const issues: ValidationIssue[][] = [];
    (Object.keys(shape) as Array<keyof TShape>).forEach((key) => {
      const schema = shape[key];
      const parsed = schema.parse((value as Record<string, unknown>)[key as string], path.concat(String(key)));
      if (parsed.success) {
        output[key as string] = parsed.data;
      } else if (parsed.issues) {
        issues.push(parsed.issues);
      }
    });
    const flatIssues = mergeIssues(issues);
    if (flatIssues.length) {
      return { success: false, issues: flatIssues };
    }
    return success(output as { [K in keyof TShape]: InferSchema<TShape[K]> });
  },
});

export const optional = <T>(schema: Schema<T>, defaultValue?: T): Schema<T | undefined> => ({
  parse: (value, path = []) => {
    if (value === undefined || value === null || value === "") {
      return success(defaultValue);
    }
    return schema.parse(value, path);
  },
});

export const union = <TOptions extends Schema<any>[]>(...options: TOptions): Schema<InferSchema<TOptions[number]>> => ({
  parse: (value, path = []) => {
    const attempts = options.map((schema) => schema.parse(value, path));
    const match = attempts.find((result) => result.success);
    if (match && match.data !== undefined) {
      return success(match.data);
    }
    return {
      success: false,
      issues: attempts.flatMap((result) => result.issues ?? []).map((issue) => ({
        ...issue,
        path: issue.path || normalizePath(path),
      })),
    };
  },
});
