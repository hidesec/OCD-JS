import { randomUUID } from "node:crypto";
import {
  Like,
  MoreThan,
  QueryPlanMetricsPayload,
  Connection,
  MemoryDatabaseDriver,
  registerOrmEventListener,
  registerQueryInstrumentation,
  withSecondLevelCache,
  getIdentityEntry,
  MigrationRunner,
  SeedRunner,
} from "@ocd-js/orm";
import { OrmOrderEntity, OrmUserEntity } from "./entities";
import { summarizeQueryMetrics } from "./reports";
import { LifecycleAuditListeners } from "./services/lifecycle.audit";
import { TransactionWorkflowService } from "./services/workflow.service";
import "./migrations/order-metrics.migration";
import "./seeds/core.seed";

class TrackedMemoryDriver extends MemoryDatabaseDriver {
  public readCount = 0;

  constructor() {
    super();
  }

  async readTable<T>(name: string): Promise<T[]> {
    this.readCount += 1;
    return super.readTable<T>(name);
  }
}

async function bootstrap() {
  const baseDriver = new TrackedMemoryDriver();
  const migrationRunner = new MigrationRunner(baseDriver);
  await migrationRunner.run("up");
  const connection = new Connection({
    driver: withSecondLevelCache(baseDriver, { defaultTtl: 2500 }),
  });
  await connection.initialize();
  const seedRunner = new SeedRunner(connection);
  await seedRunner.run();

  const metrics: QueryPlanMetricsPayload[] = [];
  const unregisterMetrics = registerQueryInstrumentation((payload) => {
    metrics.push(payload);
  });
  const unregisterAfterLoad = registerOrmEventListener(
    "afterLoad",
    ({ entity }) => {
      if (entity instanceof OrmUserEntity && !entity.status) {
        entity.status = "active";
      }
    },
  );

  const userRepo = connection.getRepository(OrmUserEntity);
  const orderRepo = connection.getRepository(OrmOrderEntity);
  const workflow = new TransactionWorkflowService(connection);

  const basicUser = await userRepo.findOne({
    where: { email: "basic@orm.demo" },
  });
  const proUser = await userRepo.findOne({ where: { email: "pro@orm.demo" } });
  if (!basicUser || !proUser) {
    throw new Error("Seed data missing required baseline users");
  }

  const dormantUser = await userRepo.save(
    userRepo.create({
      id: randomUUID(),
      email: "dormant@orm.local",
      status: "inactive",
      createdAt: new Date(),
    }),
  );
  console.log("dormant user seeded", dormantUser.email);

  baseDriver.readCount = 0;
  const cachedFirst = await userRepo.findOne({ where: { id: basicUser.id } });
  const cachedSecond = await userRepo.findOne({ where: { id: basicUser.id } });
  console.log("cache reuse", {
    driverReads: baseDriver.readCount,
    reusedInstance: cachedFirst === cachedSecond,
  });

  if (cachedFirst) {
    cachedFirst.status = "edge-check";
    const entry = getIdentityEntry(cachedFirst);
    console.log("identity dirty before save", entry?.dirtyFields.has("status"));
    await userRepo.save(cachedFirst);
    console.log("identity dirty after save", entry?.dirtyFields.size ?? 0);
  }

  const lazyLoaded = await userRepo.findOne({ where: { id: basicUser.id } });
  const lazyOrders = lazyLoaded?.orders ? await lazyLoaded.orders : [];
  console.log("lazy orders fetched", lazyOrders.length);

  await connection.transaction(async (manager) => {
    const scopedRepo = manager.getRepository(OrmUserEntity);
    const user = await scopedRepo.findOne({ where: { id: proUser.id } });
    if (user) {
      user.status = "vip-plus";
      await scopedRepo.save(user);
    }
  });

  const vipUsers = await userRepo
    .queryBuilder()
    .where("status", Like("vip%"))
    .withRelations(["orders"])
    .getMany();

  const premiumOrders = await orderRepo
    .queryBuilder()
    .where("amount", MoreThan(100))
    .withRelations(["user"])
    .getMany();

  const usersWithLargeOrders = await userRepo
    .queryBuilder()
    .whereRelation("orders", (order: OrmOrderEntity) => order.amount > 100)
    .getMany();

  const consistentCustomers = await userRepo
    .queryBuilder()
    .leftJoin("orders")
    .whereRelation("orders", (order: OrmOrderEntity) => order.amount >= 25, {
      mode: "every",
    })
    .orderBy("email", "asc")
    .getMany();

  const usersWithoutPurchases = await userRepo
    .queryBuilder()
    .leftJoin("orders")
    .whereRelation("orders", (order: OrmOrderEntity) => order.amount > 0, {
      mode: "none",
    })
    .orderBy("email", "asc")
    .getMany();

  const revenueBySku = (await orderRepo
    .queryBuilder()
    .groupBy("sku")
    .select("sku")
    .selectAggregate("orderCount", "count")
    .selectAggregate("totalAmount", "sum", "amount")
    .having("orderCount", MoreThan(1))
    .orderBy("totalAmount", "desc")
    .getRawMany()) as Array<{
    sku: string;
    orderCount: number;
    totalAmount: number;
  }>;

  await baseDriver.writeTable(
    "order_metrics",
    revenueBySku.map((entry) => ({
      sku: entry.sku,
      orderCount: entry.orderCount,
      totalAmount: entry.totalAmount,
      capturedAt: new Date().toISOString(),
    })),
  );

  const metricsSnapshot = await baseDriver.readTable<any>("order_metrics");

  unregisterAfterLoad();
  unregisterMetrics();

  const elevated = await workflow.elevateUserTier(basicUser.id);
  console.log("workflow elevated status", elevated?.status);

  await workflow.batchStatusSync([basicUser.id, proUser.id]);
  try {
    await workflow.batchSyncWithRollback([proUser.id]);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.log("unit of work rollback handled", reason);
  }

  const syncedStatuses = await userRepo
    .queryBuilder()
    .orderBy("email", "asc")
    .getMany();

  console.log(
    "synced statuses",
    syncedStatuses.map((user) => ({ email: user.email, status: user.status })),
  );
  console.log("lifecycle events", LifecycleAuditListeners.snapshot());

  console.log(
    "vip users",
    vipUsers.map((user) => user.email),
  );
  console.log(
    "high value orders",
    premiumOrders.map((order) => ({
      sku: order.sku,
      owner: order.user?.email,
    })),
  );
  console.log(
    "users with large orders",
    usersWithLargeOrders.map((user) => user.email),
  );
  console.log(
    "consistent customers",
    consistentCustomers.map((user) => ({
      email: user.email,
      status: user.status,
    })),
  );
  console.log(
    "users without purchases",
    usersWithoutPurchases.map((user) => user.email),
  );
  console.log(
    "revenue by sku",
    revenueBySku.map((row) => ({
      sku: row.sku,
      total: row.totalAmount,
      orders: row.orderCount,
    })),
  );
  console.log("order metrics snapshot", metricsSnapshot);
  console.log("query metrics summary", summarizeQueryMetrics(metrics));
}

bootstrap().catch((error) => {
  console.error("ORM script failed", error);
  process.exit(1);
});
