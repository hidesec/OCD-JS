const { test } = require("node:test");
const assert = require("node:assert");

const core = require("../packages/core/dist");
const security = require("../packages/security/dist");

test("runtime validator enforces schema", () => {
  const schema = core.object({
    email: core.string({ pattern: /^[\w.-]+@[\w.-]+\.[A-Za-z]{2,}$/ }),
    name: core.string({ minLength: 3 }),
  });
  const validator = core.createValidator(schema);

  const ok = validator.assert({ email: "demo@ocd.dev", name: "Jane" });
  assert.strictEqual(ok.email, "demo@ocd.dev");

  assert.throws(() => validator.assert({ email: "bad", name: "J" }));
});

test("adaptive rate limiter blocks exceeding calls", async () => {
  const limiter = new security.AdaptiveRateLimiter({ windowMs: 1000, baseLimit: 2, penaltyMultiplier: 1 });
  const context = {
    requestId: "req-1",
    method: "GET",
    path: "/test",
    headers: {},
    timestamp: Date.now(),
  };

  await limiter.handle(context, () => {});
  await limiter.handle(context, () => {});
  await assert.rejects(() => limiter.handle(context, () => {}), /Rate limit exceeded/);
});
