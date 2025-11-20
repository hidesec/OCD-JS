const test = require("node:test");
const assert = require("node:assert/strict");

const {
  executeWithResilience,
  resolveDriverResilienceOptions,
} = require("@ocd-js/orm");

test("executeWithResilience retries retryable errors", async () => {
  let attempts = 0;
  const result = await executeWithResilience(async () => {
    attempts += 1;
    if (attempts < 3) {
      const error = new Error("deadlock");
      error.code = "40001";
      throw error;
    }
    return "ok";
  }, {
    maxRetries: 5,
    retryDelayMs: 5,
    maxDelayMs: 10,
    retryableErrors: ["40001"],
  });
  assert.equal(result, "ok");
  assert.equal(attempts, 3);
});

test("executeWithResilience fails fast on non-retryable errors", async () => {
  let attempts = 0;
  await assert.rejects(
    executeWithResilience(async () => {
      attempts += 1;
      const error = new Error("permission denied");
      error.code = "42501";
      throw error;
    }, {
      maxRetries: 3,
      retryDelayMs: 5,
      retryableErrors: [/deadlock/i],
    }),
  );
  assert.equal(attempts, 1);
});

test("resolveDriverResilienceOptions applies defaults", () => {
  const resolved = resolveDriverResilienceOptions();
  assert.equal(resolved.maxRetries > 0, true);
  assert.equal(Array.isArray(resolved.retryableErrors), true);
});
