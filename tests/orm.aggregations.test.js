const test = require("node:test");
const assert = require("node:assert/strict");

const {
  Entity,
  Column,
  PrimaryColumn,
  Connection,
  MemoryDatabaseDriver,
  SqliteDatabaseDriver,
  MoreThan,
} = require("@ocd-js/orm");

class TrackingSqliteDriver extends SqliteDatabaseDriver {
  constructor() {
    super();
    this.recordedPlans = [];
  }

  async executeQuery(plan) {
    this.recordedPlans.push(plan);
    return super.executeQuery(plan);
  }
}

test("query builder aggregates emit raw rows", async () => {
  class AggOrder {}
  Entity({ table: "agg_orders" })(AggOrder);
  PrimaryColumn({ type: "string" })(AggOrder.prototype, "id");
  Column({ type: "string" })(AggOrder.prototype, "status");
  Column({ type: "number" })(AggOrder.prototype, "amount");

  const connection = new Connection({ driver: new MemoryDatabaseDriver() });
  await connection.initialize();
  const repo = connection.getRepository(AggOrder);

  await repo.save(
    repo.create({ id: "ord-1", status: "pending", amount: 50 }),
  );
  await repo.save(
    repo.create({ id: "ord-2", status: "pending", amount: 75 }),
  );
  await repo.save(repo.create({ id: "ord-3", status: "paid", amount: 40 }));

  const grouped = await repo
    .queryBuilder()
    .groupBy("status")
    .select("status")
    .selectAggregate("orders", "count")
    .selectAggregate("total", "sum", "amount")
    .having("orders", MoreThan(1))
    .getRawMany();

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].status, "pending");
  assert.equal(grouped[0].orders, 2);
  assert.equal(grouped[0].total, 125);
});

test("sqlite driver pushes down aggregate plans", async () => {
  class SqlOrder {}
  Entity({ table: "sql_orders" })(SqlOrder);
  PrimaryColumn({ type: "string" })(SqlOrder.prototype, "id");
  Column({ type: "string" })(SqlOrder.prototype, "sku");
  Column({ type: "number" })(SqlOrder.prototype, "amount");

  const driver = new TrackingSqliteDriver();
  const connection = new Connection({ driver });
  await connection.initialize();
  const repo = connection.getRepository(SqlOrder);

  await repo.save(repo.create({ id: "sql-1", sku: "basic", amount: 19 }));
  await repo.save(repo.create({ id: "sql-2", sku: "basic", amount: 21 }));
  await repo.save(repo.create({ id: "sql-3", sku: "pro", amount: 99 }));

  const bySku = await repo
    .queryBuilder()
    .groupBy("sku")
    .select("sku")
    .selectAggregate("orders", "count")
    .selectAggregate("total", "sum", "amount")
    .orderBy("total", "desc")
    .getRawMany();

  assert.equal(bySku.length, 2);
  assert.equal(bySku[0].sku, "pro");
  assert.equal(bySku[0].total, 99);
  assert.equal(bySku[1].orders, 2);
  assert.ok(driver.recordedPlans.length >= 1);
  assert.equal(driver.recordedPlans[0].aggregates.length, 2);
});
