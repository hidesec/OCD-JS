import { Dto, InferSchema, object, optional, string, number } from "@ocd-js/core";

export const createUserSchema = object({
  name: string({ minLength: 3, transform: (value) => value.trim() }),
  email: string({ pattern: /^[\w.-]+@[\w.-]+\.[A-Za-z]{2,}$/ }),
  age: optional(number({ min: 0 })),
});

export type CreateUserInput = InferSchema<typeof createUserSchema>;

@Dto(createUserSchema)
export class CreateUserDto {}
