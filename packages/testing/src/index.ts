import { createApplicationContext } from "@ocd-js/core";
import type { Constructor, Provider } from "@ocd-js/core/dist/di/types";

export interface TestApp<TModule = any> {
  module: Constructor<TModule>;
  context: ReturnType<typeof createApplicationContext>;
}

export const createTestApp = <TModule>(
  module: Constructor<TModule>,
): TestApp<TModule> => ({
  module,
  context: createApplicationContext(module),
});

export const withUnitTest = async <TModule, TResult>(
  module: Constructor<TModule>,
  handler: (app: TestApp<TModule>) => Promise<TResult> | TResult,
): Promise<TResult> => {
  const app = createTestApp(module);
  return handler(app);
};

export const withIntegrationTest = async <TModule, TResult>(
  module: Constructor<TModule>,
  handler: (
    requestContainer: ReturnType<
      ReturnType<typeof createApplicationContext>["beginRequest"]
    >,
  ) => Promise<TResult> | TResult,
): Promise<TResult> => {
  const app = createApplicationContext(module);
  const request = app.beginRequest();
  return handler(request);
};

export type MockProvider = Provider;

export const applyMocks = (testApp: TestApp, mocks: MockProvider[]): void => {
  mocks.forEach((mock) => testApp.context.container.register(mock));
};
