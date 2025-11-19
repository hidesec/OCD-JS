const { test } = require("node:test");
const assert = require("node:assert");
const { Readable } = require("node:stream");

const {
  StreamingBodyParser,
  FastSerializer,
  CacheManager,
} = require("../packages/performance/dist");

test("streaming body parser handles JSON payload", async () => {
  const parser = new StreamingBodyParser();
  const stream = Readable.from([Buffer.from('{"hello":"world"}')]);
  const parsed = await parser.execute(stream);
  assert.strictEqual(parsed.type, "json");
  assert.deepStrictEqual(parsed.data, { hello: "world" });
});

test("fast serializer encodes objects to buffer", () => {
  const serializer = new FastSerializer();
  const buffer = serializer.execute({ ok: true });
  assert.ok(Buffer.isBuffer(buffer));
  assert.strictEqual(buffer.toString(), "{\"ok\":true}");
});

test("cache manager stores and invalidates", async () => {
  const cache = new CacheManager();
  let calls = 0;
  const value = await cache.getOrSet(
    "key",
    async () => {
      calls += 1;
      return "value";
    },
    { ttlMs: 1000, tags: ["group"] }
  );
  assert.strictEqual(value, "value");
  await cache.getOrSet("key", async () => "other");
  assert.strictEqual(calls, 1, "should reuse cached value");
  await cache.invalidate(["group"]);
  await cache.getOrSet("key", async () => {
    calls += 1;
    return "value2";
  });
  assert.strictEqual(calls, 2, "invalidate should force recompute");
});
