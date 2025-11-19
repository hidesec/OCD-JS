import { RouteEnhancer, ValidationEnhancer, ValidationTarget } from "../routing/enhancers";
import { Schema } from "./schema";
import { ValidationException, createValidator } from "./validator";

export interface ValidationContext {
  body?: unknown;
  query?: Record<string, unknown>;
  params?: Record<string, string>;
}

export const applyValidationEnhancers = (enhancers: RouteEnhancer[] = [], context: ValidationContext): ValidationContext => {
  const validationEnhancers = enhancers.filter((enhancer): enhancer is ValidationEnhancer => enhancer.kind === "validation");
  if (!validationEnhancers.length) {
    return context;
  }
  const nextContext: ValidationContext = { ...context };
  validationEnhancers.forEach((enhancer) => {
    const schema = enhancer.schema as Schema<any>;
    const validator = createValidator(schema);
    const targetValue = context[enhancer.target];
    const result = validator.validate(targetValue);
    if (result.success) {
      nextContext[enhancer.target] = result.data;
    } else {
      throw new ValidationException(result.errors);
    }
  });
  return nextContext;
};

export const getValidatedPayload = <TTarget extends ValidationTarget>(enhancers: RouteEnhancer[] = [], target: TTarget) => {
  const validationEnhancer = enhancers.find((enhancer) => enhancer.kind === "validation" && enhancer.target === target) as
    | ValidationEnhancer
    | undefined;
  if (!validationEnhancer) {
    return undefined;
  }
  const schema = validationEnhancer.schema as Schema<any>;
  const validator = createValidator(schema);
  return validator;
};
