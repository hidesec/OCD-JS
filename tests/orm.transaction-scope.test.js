const test = require("node:test");
const assert = require("node:assert/strict");

const {
  Connection,
  MemoryDatabaseDriver,
  Entity,
  PrimaryColumn,
  Column,
  UnitOfWorkBoundary,
} = require("@ocd-js/orm");

test("nested transactions with isolated identity scope adopt changes only on success", async () => {
  class ScopedUser {}
  Entity({ table: "scoped_users" })(ScopedUser);
  PrimaryColumn({ type: "string" })(ScopedUser.prototype, "id");
  Column({ type: "string" })(ScopedUser.prototype, "status");

  const connection = new Connection({ driver: new MemoryDatabaseDriver() });
  await connection.initialize();
  const repo = connection.getRepository(ScopedUser);
  const seed = await repo.save(repo.create({ status: "seed" }));

  await connection.transaction(async (outerManager) => {
    const outerRepo = outerManager.getRepository(ScopedUser);
    const original = await outerRepo.findOne({ where: { id: seed.id } });
    assert.equal(original?.status, "seed");

    await assert.rejects(
      connection.transaction(
        async (innerManager) => {
          const innerRepo = innerManager.getRepository(ScopedUser);
          const target = await innerRepo.findOne({ where: { id: seed.id } });
          target.status = "nested-failure";
          await innerRepo.save(target);
          throw new Error("abort");
        },
        { identityScope: "isolated" },
      ),
    );

    const afterRollback = await outerRepo.findOne({ where: { id: seed.id } });
    assert.equal(afterRollback?.status, "seed");

    await connection.transaction(
      async (innerManager) => {
        const innerRepo = innerManager.getRepository(ScopedUser);
        const target = await innerRepo.findOne({ where: { id: seed.id } });
        target.status = "nested-success";
        await innerRepo.save(target);
      },
      { identityScope: "isolated" },
    );

    const afterSuccess = await outerRepo.findOne({ where: { id: seed.id } });
    assert.equal(afterSuccess?.status, "nested-success");
  });

  const final = await repo.findOne({ where: { id: seed.id } });
  assert.equal(final?.status, "nested-success");
});

test("UnitOfWorkBoundary decorator commits and rolls back automatically", async () => {
  class LedgerEntry {}
  Entity({ table: "ledger_entries" })(LedgerEntry);
  PrimaryColumn({ type: "string" })(LedgerEntry.prototype, "id");
  Column({ type: "string" })(LedgerEntry.prototype, "label");

  const connection = new Connection({ driver: new MemoryDatabaseDriver() });
  await connection.initialize();
  const repo = connection.getRepository(LedgerEntry);

  class LedgerService {
    constructor() {
      this.connection = connection;
    }

    async seed(labels, unitOfWork) {
      const scopedRepo = unitOfWork.getRepository(LedgerEntry);
      for (const label of labels) {
        await scopedRepo.save(scopedRepo.create({ label }));
      }
    }

    async seedAndFail(labels, unitOfWork) {
      const scopedRepo = unitOfWork.getRepository(LedgerEntry);
      for (const label of labels) {
        await scopedRepo.save(scopedRepo.create({ label }));
      }
      throw new Error("rollback");
    }
  }

  for (const method of ["seed", "seedAndFail"]) {
    const descriptor = Object.getOwnPropertyDescriptor(
      LedgerService.prototype,
      method,
    );
    const updated =
      UnitOfWorkBoundary()(LedgerService.prototype, method, descriptor) ??
      descriptor;
    Object.defineProperty(LedgerService.prototype, method, updated);
  }

  const service = new LedgerService();
  await service.seed(["alpha", "beta"]);
  assert.equal((await repo.find()).length, 2);

  await assert.rejects(service.seedAndFail(["gamma"]));
  const labels = await repo
    .queryBuilder()
    .orderBy("label", "asc")
    .getMany();
  assert.deepEqual(
    labels.map((row) => row.label),
    ["alpha", "beta"],
  );
});
