const test = require("node:test");
const assert = require("node:assert/strict");

const {
  Entity,
  CacheEntity,
  Column,
  PrimaryColumn,
  Connection,
  MemoryDatabaseDriver,
  getIdentityEntry,
} = require("@ocd-js/orm");

class CountingMemoryDriver extends MemoryDatabaseDriver {
  constructor() {
    super();
    this.readCount = 0;
  }

  async readTable(name) {
    this.readCount += 1;
    return super.readTable(name);
  }

  supportsQuery() {
    return false;
  }

  async executeQuery() {
    throw new Error("executeQuery should not be invoked when supportsQuery returns false");
  }
}

test("second-level cache serves repeated reads and invalidates after transaction", async () => {
  class CacheWarmAccount {}
  Entity({ table: "cache_warm_accounts" })(CacheWarmAccount);
  CacheEntity({ ttl: 5_000 })(CacheWarmAccount);
  PrimaryColumn({ type: "string" })(CacheWarmAccount.prototype, "id");
  Column({ type: "string" })(CacheWarmAccount.prototype, "email");
  Column({ type: "string" })(CacheWarmAccount.prototype, "status");

  const baseDriver = new CountingMemoryDriver();
  const seedConnection = new Connection({
    driver: baseDriver,
    cache: { enabled: false },
  });
  await seedConnection.initialize();
  const seedRepo = seedConnection.getRepository(CacheWarmAccount);
  const seeded = await seedRepo.save(
    seedRepo.create({ email: "cache@test", status: "new" }),
  );

  const connection = new Connection({
    driver: baseDriver,
    cache: { defaultTtl: 5_000 },
  });
  await connection.initialize();
  const repo = connection.getRepository(CacheWarmAccount);

  baseDriver.readCount = 0;
  const firstRead = await repo.findOne({ where: { id: seeded.id } });
  const secondRead = await repo.findOne({ where: { id: seeded.id } });

  assert.strictEqual(firstRead?.id, seeded.id);
  assert.strictEqual(secondRead?.id, seeded.id);
  assert.strictEqual(
    baseDriver.readCount,
    1,
    "second read should come from cache without driver hit",
  );

  await connection.transaction(async (manager) => {
    const txRepo = manager.getRepository(CacheWarmAccount);
    const inside = await txRepo.findOne({ where: { id: seeded.id } });
    inside.status = "updated";
    await txRepo.save(inside);
  });

  const afterTx = await repo.findOne({ where: { id: seeded.id } });
  assert.strictEqual(afterTx?.status, "updated");
  assert.strictEqual(
    baseDriver.readCount,
    2,
    "cache should be invalidated after transactional mutation",
  );
});

test("identity map reuses instances and tracks dirty fields", async () => {
  class IdentityProfile {}
  Entity({ table: "identity_profiles" })(IdentityProfile);
  PrimaryColumn({ type: "string" })(IdentityProfile.prototype, "id");
  Column({ type: "string" })(IdentityProfile.prototype, "handle");

  const connection = new Connection({ driver: new MemoryDatabaseDriver() });
  await connection.initialize();
  const repo = connection.getRepository(IdentityProfile);
  const created = await repo.save(repo.create({ handle: "original" }));

  const first = await repo.findOne({ where: { id: created.id } });
  const second = await repo.findOne({ where: { id: created.id } });
  assert.strictEqual(first, second, "identity map should reuse proxies");

  first.handle = "mutated";
  const entry = getIdentityEntry(first);
  assert(entry);
  assert(entry.dirtyFields.has("handle"));
  await repo.save(first);
  assert.strictEqual(entry.dirtyFields.size, 0);

  let txEntity;
  await connection.transaction(async (manager) => {
    const txRepo = manager.getRepository(IdentityProfile);
    txEntity = await txRepo.findOne({ where: { id: created.id } });
    assert.notStrictEqual(txEntity, first, "transaction uses scoped identity map");
    txEntity.handle = "from-transaction";
    await txRepo.save(txEntity);
  });

  const outside = await repo.findOne({ where: { id: created.id } });
  assert.strictEqual(outside, txEntity);
  assert.strictEqual(outside.handle, "from-transaction");
});
