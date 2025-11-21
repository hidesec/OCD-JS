import {
  Dto,
  InferSchema,
  number,
  object,
  optional,
  string,
} from "@ocd-js/core";

@Dto(
  object({
    name: string({ minLength: 3, maxLength: 60 }),
    owner: string({ minLength: 2, maxLength: 48 }),
    budget: optional(number({ min: 0 })),
  }),
)
export class CreateProjectDto {
  name!: string;
  owner!: string;
  budget?: number;
}

export const listProjectsSchema = object({
  owner: optional(string({ minLength: 2 })),
  limit: optional(number({ min: 1, max: 25 }), 10),
});

export type ListProjectsQuery = InferSchema<typeof listProjectsSchema>;
