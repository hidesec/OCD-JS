import type { Container } from "./container";

export type Constructor<T = any> = new (...args: any[]) => T;

export type InjectionToken<T = any> = Constructor<T> | symbol | string;

export type Scope = "singleton" | "transient" | "request";

export interface Provider<T = any> {
  token: InjectionToken<T>;
  useClass?: Constructor<T>;
  useFactory?: (context: ResolveContext) => T;
  useValue?: T;
  deps?: InjectionToken[];
  scope?: Scope;
}

export interface ResolveContext {
  container: Container;
  requestId?: string;
}

export type ProviderLike = Provider | Constructor;

export type ModuleProvider = ProviderLike | Array<ProviderLike>;
