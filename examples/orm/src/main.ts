import { randomUUID } from "node:crypto";
import {
  Like,
  MoreThan,
  QueryPlanMetricsPayload,
  createStandaloneConnection,
  registerOrmEventListener,
  registerQueryInstrumentation,
} from "@ocd-js/orm";
import { OrmOrderEntity, OrmUserEntity } from "./entities";
import { summarizeQueryMetrics } from "./reports";

async function bootstrap() {
  const connection = await createStandaloneConnection({
    driver: "memory",
    cache: { defaultTtl: 2500 },
  });

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

  const [basicUser, proUser] = await connection.transaction(async (manager) => {
    const users: OrmUserEntity[] = [];
    const scopedUsers = manager.getRepository(OrmUserEntity);
    const scopedOrders = manager.getRepository(OrmOrderEntity);
    for (const [index, plan] of ["basic", "pro"].entries()) {
      const user = scopedUsers.create({
        id: randomUUID(),
        email: `${plan}+${index}@orm.demo`,
        status: plan === "pro" ? "vip" : "active",
        createdAt: new Date(Date.now() - index * 86_400_000),
      });
      const persisted = await scopedUsers.save(user);
      users.push(persisted);
      await scopedOrders.save(
        scopedOrders.create({
          id: randomUUID(),
          sku: `${plan}-starter`,
          amount: plan === "pro" ? 149 : 29,
          purchasedAt: new Date(),
          user: persisted,
        }),
      );
    }
    return users;
  });

  await userRepo.findOne({ where: { id: basicUser.id } });
  await userRepo.findOne({ where: { id: basicUser.id } });

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
    .whereRelation("orders", (order) => order.amount > 100)
    .getMany();

  unregisterAfterLoad();
  unregisterMetrics();

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
  console.log("query metrics summary", summarizeQueryMetrics(metrics));
}

bootstrap().catch((error) => {
  console.error("ORM example failed", error);
  process.exit(1);
});
