export type MetricKind = "counter" | "gauge" | "histogram";

interface BaseMetric {
  name: string;
  help?: string;
  labels?: Record<string, string>;
}

export class Counter implements BaseMetric {
  readonly kind = "counter" satisfies MetricKind;
  value = 0;
  constructor(
    public readonly name: string,
    public readonly help?: string,
    public readonly labels?: Record<string, string>,
  ) {}

  inc(amount = 1) {
    if (amount < 0) throw new Error("Counter cannot decrease");
    this.value += amount;
  }
}

export class Gauge implements BaseMetric {
  readonly kind = "gauge" satisfies MetricKind;
  value = 0;
  constructor(
    public readonly name: string,
    public readonly help?: string,
    public readonly labels?: Record<string, string>,
  ) {}

  set(value: number) {
    this.value = value;
  }

  inc(amount = 1) {
    this.value += amount;
  }

  dec(amount = 1) {
    this.value -= amount;
  }
}

export class Histogram implements BaseMetric {
  readonly kind = "histogram" satisfies MetricKind;
  private readonly observations: number[] = [];
  constructor(
    public readonly name: string,
    public readonly buckets: number[] = [0.1, 0.5, 1, 2, 5],
    public readonly help?: string,
    public readonly labels?: Record<string, string>,
  ) {}

  observe(value: number) {
    this.observations.push(value);
  }

  snapshot() {
    const sorted = [...this.observations].sort((a, b) => a - b);
    return {
      count: sorted.length,
      sum: sorted.reduce((acc, value) => acc + value, 0),
      buckets: this.buckets.map((upperBound) => ({
        upperBound,
        count: sorted.filter((value) => value <= upperBound).length,
      })),
    };
  }
}

export type Metric = Counter | Gauge | Histogram;

export class MetricsRegistry {
  private readonly metrics = new Map<string, Metric>();

  counter(
    name: string,
    help?: string,
    labels?: Record<string, string>,
  ): Counter {
    return this.ensure(name, () => new Counter(name, help, labels));
  }

  gauge(name: string, help?: string, labels?: Record<string, string>): Gauge {
    return this.ensure(name, () => new Gauge(name, help, labels));
  }

  histogram(
    name: string,
    buckets?: number[],
    help?: string,
    labels?: Record<string, string>,
  ): Histogram {
    return this.ensure(name, () => new Histogram(name, buckets, help, labels));
  }

  entries(): Metric[] {
    return Array.from(this.metrics.values());
  }

  private ensure<T extends Metric>(name: string, factory: () => T): T {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, factory());
    }
    return this.metrics.get(name) as T;
  }
}
