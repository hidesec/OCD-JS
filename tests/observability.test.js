const { test } = require("node:test");
const assert = require("node:assert");

const {
  StructuredLogger,
  MetricsRegistry,
  renderOpenMetrics,
  registerProbe,
  ProbeRegistry,
} = require("../packages/observability/dist");

test("structured logger captures correlation context", async () => {
  const entries = [];
  const logger = new StructuredLogger(
    { serviceName: "test-service", logLevel: "debug" },
    (_payload, entry) => entries.push(entry)
  );

  await logger.withCorrelation("corr-123", async () => {
    logger.info("hello", { foo: "bar" });
  });

  assert.strictEqual(entries.length, 1);
  const entry = entries[0];
  assert.strictEqual(entry.correlationId, "corr-123");
  assert.strictEqual(entry.message, "hello");
  assert.strictEqual(entry.context.foo, "bar");
});

test("metrics registry exports counters", () => {
  const registry = new MetricsRegistry();
  registry.counter("test_counter", "A sample counter").inc(2);
  const output = renderOpenMetrics(registry);
  assert.match(output, /test_counter 2/);
  assert.match(output, /# TYPE test_counter counter/);
});

test("probe registry aggregates probe status", async () => {
  const probeName = `probe-${Date.now()}`;
  registerProbe("health", {
    name: probeName,
    handler: () => ({ name: probeName, status: "up" }),
  });
  const registry = new ProbeRegistry();
  const result = await registry.run("health");
  assert.strictEqual(result.status, "ok");
  assert.ok(result.checks.some((check) => check.name === probeName));
});
