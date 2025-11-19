import { Container } from "../di/container";
import { assignInjectableMetadata, provideFromClass } from "../di/decorators";
import { Constructor, InjectionToken, ModuleProvider, Provider, ProviderLike } from "../di/types";
import { compileControllerRoutes } from "../routing/router";

export interface ModuleOptions {
  imports?: Constructor[];
  providers?: ModuleProvider[];
  controllers?: Constructor[];
  exports?: InjectionToken[];
}

export interface ModuleManifest {
  type: Constructor;
  imports: Constructor[];
  providers: ProviderLike[];
  controllers: Constructor[];
  exports: InjectionToken[];
}

const moduleDefinitions = new WeakMap<Constructor, ModuleManifest>();

export const Module = (options: ModuleOptions): ClassDecorator => {
  return (target) => {
    const ctor = target as unknown as Constructor;
    const manifest: ModuleManifest = {
      type: ctor,
      imports: options.imports ?? [],
      providers: flattenModuleProviders(options.providers ?? []),
      controllers: options.controllers ?? [],
      exports: options.exports ?? [],
    };
    moduleDefinitions.set(ctor, manifest);
    assignInjectableMetadata(ctor, { token: ctor });
  };
};

export const getModuleManifest = (moduleType: Constructor): ModuleManifest => {
  const manifest = moduleDefinitions.get(moduleType);
  if (!manifest) {
    throw new Error(`Module ${moduleType.name} is missing @Module decorator`);
  }
  return manifest;
};

export interface ApplicationContextSnapshot {
  modules: ModuleManifest[];
  routes: ReturnType<typeof compileControllerRoutes>;
}

export interface ApplicationContext {
  container: Container;
  routes: ReturnType<typeof compileControllerRoutes>;
  snapshot(): ApplicationContextSnapshot;
  beginRequest(extraProviders?: ProviderLike[]): { container: Container; routes: ReturnType<typeof compileControllerRoutes> };
}

export const createApplicationContext = (rootModule: Constructor): ApplicationContext => {
  const manifests = collectManifests(rootModule);
  const providers = collectProviders(manifests);
  const controllers = collectControllers(manifests);

  const container = new Container({ providers });
  const routes = compileControllerRoutes(controllers);

  return {
    container,
    routes,
    snapshot: () => ({ modules: manifests, routes }),
    beginRequest: (extraProviders = []) => ({
      container: container.beginRequest(extraProviders.map(normalizeProvider)),
      routes,
    }),
  };
};

const collectManifests = (moduleType: Constructor, memo = new Map<Constructor, ModuleManifest>()): ModuleManifest[] => {
  if (!memo.has(moduleType)) {
    const manifest = getModuleManifest(moduleType);
    memo.set(moduleType, manifest);
    manifest.imports.forEach((child) => collectManifests(child, memo));
  }
  return Array.from(memo.values());
};

const collectProviders = (manifests: ModuleManifest[]): Provider[] => {
  const providers: Provider[] = [];
  manifests.forEach((manifest) => {
    manifest.providers.forEach((providerLike) => {
      providers.push(normalizeProvider(providerLike));
    });
    manifest.controllers.forEach((controller) => {
      providers.push(provideFromClass(controller));
    });
  });
  return dedupeProviders(providers);
};

const collectControllers = (manifests: ModuleManifest[]): Constructor[] => {
  const controllers = new Set<Constructor>();
  manifests.forEach((manifest) => {
    manifest.controllers.forEach((controller) => controllers.add(controller));
  });
  return Array.from(controllers.values());
};

const normalizeProvider = (providerLike: ProviderLike): Provider => {
  if (typeof providerLike === "function") {
    return provideFromClass(providerLike as Constructor);
  }
  return providerLike;
};

const flattenModuleProviders = (providers: ModuleProvider[]): ProviderLike[] => {
  const flattened: ProviderLike[] = [];
  providers.forEach((entry) => {
    if (Array.isArray(entry)) {
      flattened.push(...(entry as ProviderLike[]));
    } else {
      flattened.push(entry);
    }
  });
  return flattened;
};

const dedupeProviders = (providers: Provider[]): Provider[] => {
  const map = new Map<InjectionToken, Provider>();
  providers.forEach((provider) => map.set(provider.token, provider));
  return Array.from(map.values());
};
