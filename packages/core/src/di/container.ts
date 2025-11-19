import { Constructor, InjectionToken, Provider, Scope } from "./types";

export interface ContainerOptions {
  providers?: Provider[];
  parent?: Container;
  scope?: Scope;
}

const describeToken = (token: InjectionToken) => {
  if (typeof token === "string") return token;
  if (typeof token === "symbol") return token.description ?? token.toString();
  return token.name;
};

export class Container {
  private readonly registry = new Map<InjectionToken, Provider>();
  private readonly singletonCache: Map<InjectionToken, unknown>;
  private readonly requestCache?: Map<InjectionToken, unknown>;
  private readonly scope: Scope;
  private readonly parent?: Container;

  constructor(options: ContainerOptions = {}) {
    this.scope = options.scope ?? "singleton";
    this.parent = options.parent;
    this.singletonCache = this.parent ? this.parent.singletonCache : new Map();
    this.requestCache = this.scope === "request" ? new Map() : undefined;
    options.providers?.forEach((provider) => this.register(provider));
  }

  register(provider: Provider): void {
    const normalized: Provider = {
      scope: provider.scope ?? "singleton",
      ...provider,
    };
    if (!normalized.token) {
      throw new Error("Provider must specify a token");
    }
    this.registry.set(normalized.token, normalized);
  }

  registerMany(providers: Provider[]): void {
    providers.forEach((provider) => this.register(provider));
  }

  beginRequest(extraProviders: Provider[] = []): Container {
    const requestContainer = new Container({
      parent: this,
      scope: "request",
      providers: extraProviders,
    });
    return requestContainer;
  }

  resolve<T>(token: InjectionToken<T>): T {
    const provider = this.findProvider(token);
    if (!provider) {
      throw new Error(`No provider found for token ${describeToken(token)}`);
    }

    const scope = provider.scope ?? "singleton";
    if (scope === "singleton") {
      return this.getOrCreate(this.singletonCache, token, () => this.instantiate(provider));
    }

    if (scope === "request") {
      if (this.scope !== "request") {
        throw new Error(
          `Token ${describeToken(token)} is request scoped. Call container.beginRequest() to resolve it.`
        );
      }
      if (!this.requestCache) {
        throw new Error("Request cache not initialized");
      }
      return this.getOrCreate(this.requestCache, token, () => this.instantiate(provider));
    }

    return this.instantiate(provider);
  }

  private findProvider(token: InjectionToken): Provider | undefined {
    return this.registry.get(token) ?? this.parent?.findProvider(token);
  }

  private getOrCreate<T>(cache: Map<InjectionToken, unknown>, token: InjectionToken, factory: () => T): T {
    if (cache.has(token)) {
      return cache.get(token) as T;
    }
    const instance = factory();
    cache.set(token, instance);
    return instance;
  }

  private instantiate<T>(provider: Provider<T>): T {
    if (Object.prototype.hasOwnProperty.call(provider, "useValue")) {
      return provider.useValue as T;
    }
    if (provider.useFactory) {
      return provider.useFactory({ container: this });
    }
    if (provider.useClass) {
      const deps = (provider.deps ?? []).map((token) => this.resolve(token));
      return new provider.useClass(...deps);
    }
    throw new Error(`Provider for ${describeToken(provider.token)} is invalid`);
  }
}
