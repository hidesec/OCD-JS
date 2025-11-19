import type { MetricsRegistry } from "./registry";

const registryProperty = Symbol.for("ocd.metrics.property");

export const UseMetrics = (property = "metrics"): ClassDecorator => {
  return (target) => {
    Object.defineProperty(target, registryProperty, {
      value: property,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  };
};

export const Measure = (metricName: string): MethodDecorator => {
  return (_target, _propertyKey, descriptor?: TypedPropertyDescriptor<any>) => {
    if (!descriptor?.value) {
      return descriptor;
    }
    const original = descriptor.value;
    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      const registry = resolveRegistry(this);
      const start = Date.now();
      try {
        const result = await Promise.resolve(original.apply(this, args));
        registry
          ?.histogram(
            `${metricName}_duration_ms`,
            [50, 100, 250, 500, 1000],
            "Method duration",
          )
          .observe(Date.now() - start);
        registry
          ?.counter(`${metricName}_success_total`, "Successful executions")
          .inc();
        return result;
      } catch (error) {
        registry
          ?.counter(`${metricName}_error_total`, "Failed executions")
          .inc();
        throw error;
      }
    } as typeof original;
    return descriptor;
  };
};

const resolveRegistry = (instance: any): MetricsRegistry | undefined => {
  if (!instance) {
    return undefined;
  }
  const ctor = instance.constructor as { [key: symbol]: string } | undefined;
  const property = ctor?.[registryProperty] ?? "metrics";
  return instance[property] as MetricsRegistry | undefined;
};
