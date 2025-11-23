const test = require("node:test");
const assert = require("node:assert/strict");

const {
  Entity,
  Column,
  PrimaryColumn,
  Connection,
  MemoryDatabaseDriver,
  SqliteDatabaseDriver,
  installOrmQueryLogger,
} = require("@ocd-js/orm");

test("query logger emits events when enabled (memory driver)", async () => {
  class LogPost {}
  Entity({ table: "log_posts" })(LogPost);
  PrimaryColumn({ type: "string" })(LogPost.prototype, "id");
  Column({ type: "string" })(LogPost.prototype, "title");

  const logs = [];
  const off = installOrmQueryLogger({
    enabled: true,
    sink: (_level, message, context) => {
      logs.push({ message, context });
    },
  });

  const connection = new Connection({ driver: new MemoryDatabaseDriver() });
  await connection.initialize();
  const repo = connection.getRepository(LogPost);
  await repo.save(repo.create({ title: "t1" }));
  await repo.find();

  off();
  assert.ok(logs.length > 0, "expected at least one query log entry");
  const last = logs[logs.length - 1];
  assert.equal(last.message, "orm.query");
  assert.ok(typeof last.context.durationMs === "number");
});

test("query logger includes sql/params for sqlite driver pushdown", async () => {
  class LogArticle {}
  Entity({ table: "log_articles" })(LogArticle);
  PrimaryColumn({ type: "string" })(LogArticle.prototype, "id");
  Column({ type: "string" })(LogArticle.prototype, "title");

  const logs = [];
  const off = installOrmQueryLogger({
    enabled: true,
    sink: (_level, message, context) => logs.push({ message, context }),
  });

  const driver = new SqliteDatabaseDriver();
  const connection = new Connection({ driver });
  await connection.initialize();
  const repo = connection.getRepository(LogArticle);
  await repo.save(repo.create({ title: "hello" }));
  await repo
    .queryBuilder()
    .where("title", { eq: "hello" })
    .getMany();

  off();
  const last = logs[logs.length - 1];
  assert.equal(last.message, "orm.query");
  // sqlite pushdown should include sql & params
  assert.ok(
    "sql" in last.context,
    "expected sql present in instrumentation context",
  );
});

test("query logger can redact params", async () => {
  class RedPost {}
  Entity({ table: "red_posts" })(RedPost);
  PrimaryColumn({ type: "string" })(RedPost.prototype, "id");
  Column({ type: "string" })(RedPost.prototype, "title");

  const logs = [];
  const off = installOrmQueryLogger({
    enabled: true,
    redactParams: true,
    sink: (_level, message, context) => logs.push({ message, context }),
  });

  const driver = new SqliteDatabaseDriver();
  const connection = new Connection({ driver });
  await connection.initialize();
  const repo = connection.getRepository(RedPost);
  await repo.save(repo.create({ title: "secret" }));
  await repo
    .queryBuilder()
    .where("title", { eq: "secret" })
    .getMany();

  off();
  const last = logs[logs.length - 1];
  if (Array.isArray(last.context.params) && last.context.params.length) {
    assert.equal(last.context.params[0], "[REDACTED]");
  }
});
