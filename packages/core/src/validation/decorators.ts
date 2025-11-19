import { Constructor } from "../di/types";
import { registerRouteEnhancer, ValidationTarget } from "../routing/enhancers";
import { Schema } from "./schema";

type SchemaReference<T = any> = Schema<T> | Constructor;

const dtoRegistry = new WeakMap<Constructor, Schema<any>>();

export const Dto = <T>(schema: Schema<T>): ClassDecorator => {
  return (target) => {
    dtoRegistry.set(target as unknown as Constructor, schema);
  };
};

export const getDtoSchema = (target: Constructor): Schema<any> => {
  const schema = dtoRegistry.get(target);
  if (!schema) {
    throw new Error(`DTO ${target.name} is missing @Dto(schema)`);
  }
  return schema;
};

export const ValidateBody = (schema: SchemaReference): MethodDecorator =>
  createValidationDecorator("body", schema);

export const ValidateQuery = (schema: SchemaReference): MethodDecorator =>
  createValidationDecorator("query", schema);

export const ValidateParams = (schema: SchemaReference): MethodDecorator =>
  createValidationDecorator("params", schema);

const createValidationDecorator = (target: ValidationTarget, schema: SchemaReference): MethodDecorator => {
  return (controllerPrototype, propertyKey) => {
    const controller = controllerPrototype.constructor as unknown as Constructor;
    registerRouteEnhancer(controller, propertyKey as string | symbol, {
      kind: "validation",
      target,
      schema: resolveSchema(schema),
    });
  };
};

const resolveSchema = (reference: SchemaReference): Schema<any> => {
  if (typeof reference === "function") {
    return getDtoSchema(reference as Constructor);
  }
  return reference;
};
