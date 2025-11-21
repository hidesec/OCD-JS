import { randomUUID } from "node:crypto";
import { Seeder, SeedContext } from "@ocd-js/orm";
import { OrmOrderEntity, OrmUserEntity } from "../entities";

@Seeder({ id: "2024112101_core-users", tags: ["core"] })
export class CoreUserSeed {
  async run(ctx: SeedContext) {
    await ctx.truncate(OrmOrderEntity);
    await ctx.truncate(OrmUserEntity);

    const [basicUser, proUser] = await ctx.insert(OrmUserEntity, [
      {
        id: randomUUID(),
        email: "basic@orm.demo",
        status: "active",
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      },
      {
        id: randomUUID(),
        email: "pro@orm.demo",
        status: "vip",
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    ]);

    const baseOrders = [
      {
        id: randomUUID(),
        sku: "basic-starter",
        amount: 29,
        purchasedAt: new Date(),
        user: basicUser,
      },
      {
        id: randomUUID(),
        sku: "basic-upgrade",
        amount: 59,
        purchasedAt: new Date(),
        user: basicUser,
      },
      {
        id: randomUUID(),
        sku: "pro-starter",
        amount: 99,
        purchasedAt: new Date(),
        user: proUser,
      },
      {
        id: randomUUID(),
        sku: "pro-lifecycle",
        amount: 149,
        purchasedAt: new Date(),
        user: proUser,
      },
    ];

    await ctx.insert(OrmOrderEntity, baseOrders);
  }
}
