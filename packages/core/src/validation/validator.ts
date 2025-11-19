import { ParseResult, Schema } from "./schema";

export interface ValidationError {
  message: string;
  path: string;
}

export interface Validator<T> {
  validate(
    value: unknown,
  ): { success: true; data: T } | { success: false; errors: ValidationError[] };
  assert(value: unknown): T;
}

export const createValidator = <T>(schema: Schema<T>): Validator<T> => {
  const exec = (value: unknown): ParseResult<T> => schema.parse(value, []);
  return {
    validate: (value) => {
      const result = exec(value);
      if (result.success) {
        return { success: true, data: result.data as T };
      }
      return { success: false, errors: sanitizeIssues(result.issues) };
    },
    assert: (value) => {
      const result = exec(value);
      if (!result.success) {
        throw new ValidationException(sanitizeIssues(result.issues));
      }
      return result.data as T;
    },
  };
};

const sanitizeIssues = (issues?: ValidationError[]): ValidationError[] =>
  (issues ?? []).map((issue) => ({
    path: issue.path,
    message: issue.message,
  }));

export class ValidationException extends Error {
  constructor(public readonly errors: ValidationError[]) {
    super("Validation failed");
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
