import { InferEnv, defineEnvSchema, env, loadConfig } from "@ocd-js/core";

const schema = defineEnvSchema({
  NODE_ENV: env.string({ default: "development" }),
  PORT: env.number({ default: 3000 }),
  LOG_LEVEL: env.optional(env.string(), "info"),
});

export type AppConfig = InferEnv<typeof schema.fields>;

export const loadAppConfig = (): AppConfig => loadConfig(schema);
