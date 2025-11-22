const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { HttpAdapter } = require("../packages/server/dist/index.js");
const { AppModule } = require("../examples/server/dist/user/user.module.js");

test("returns 404 for unknown route", async () => {
  const adapter = new HttpAdapter({ module: AppModule });
  const agent = request(adapter.getApp());

  const res = await agent.get("/not-found-path").expect(404);
  assert.equal(res.body.message, "Not Found");
});

test("returns 400 for invalid JSON body", async () => {
  const adapter = new HttpAdapter({ module: AppModule });
  const agent = request(adapter.getApp());

  const res = await agent
    .post("/users")
    .set("Content-Type", "application/json")
    .send("{\"bad\":")
    .expect(400);
  assert.match(res.body.message, /Invalid request body/);
});
