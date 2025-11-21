import { InferEnv, defineEnvSchema, env, loadConfig } from "@ocd-js/core";

const appEnv = defineEnvSchema({
  APP_NAME: env.string({ default: "OCD Core Suite" }),
  STAGE: env.string({ default: "local", pattern: /^(local|production)$/i }),
  PORT: env.number({ default: 4100 }),
  ENABLE_ANALYTICS: env.boolean({ default: true }),
});

export type AppConfig = InferEnv<typeof appEnv.fields>;

export const loadAppConfig = (): AppConfig =>
  loadConfig(appEnv, {
    APP_NAME: process.env.APP_NAME ?? "OCD Core Suite",
    STAGE: process.env.STAGE ?? "local",
    PORT: process.env.PORT ?? "4100",
    ENABLE_ANALYTICS: process.env.ENABLE_ANALYTICS ?? "true",
  });
