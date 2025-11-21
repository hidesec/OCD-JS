const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createHmac } = require("node:crypto");
const { ExpressHttpAdapter } = require("../packages/server/dist/index.js");
const { AppModule } = require("../examples/server/dist/user/user.module.js");

test("Express adapter handles GET and protected POST routes", async () => {
  const adapter = new ExpressHttpAdapter({ module: AppModule });
  const agent = request(adapter.getApp());

  const listResponse = await agent.get("/users").expect(200);
  assert.ok(Array.isArray(listResponse.body), "should return user array");

  const token = signJwt({
    sub: "adapter-admin",
    roles: ["admin"],
    email: "adapter@ocd.dev",
  });

  const createResponse = await agent
    .post("/users")
    .set("Authorization", `Bearer ${token}`)
    .send({ name: "Adapter User", email: "adapter@ocd.dev" })
    .expect(200);

  assert.equal(createResponse.body.name, "Adapter User");

  const metricsResponse = await agent.get("/ops/metrics").expect(200);
  assert.ok(typeof metricsResponse.text === "string");
});

const JWT_SECRET = "local-dev-secret";

function signJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
    "base64url",
  );
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const hmac = createHmac("sha256", JWT_SECRET);
  hmac.update(`${header}.${body}`);
  const signature = hmac.digest("base64url");
  return `${header}.${body}.${signature}`;
}
