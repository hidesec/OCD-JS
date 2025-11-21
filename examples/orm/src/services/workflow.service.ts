import {
  Connection,
  EntityManager,
  Transactional,
  UnitOfWork,
  UnitOfWorkBoundary,
} from "@ocd-js/orm";
import { OrmOrderEntity, OrmUserEntity } from "../entities";

export class TransactionWorkflowService {
  constructor(private readonly connection: Connection) {}

  @Transactional({ transaction: { identityScope: "isolated" } })
  async elevateUserTier(
    userId: string,
    manager?: EntityManager,
  ): Promise<OrmUserEntity | null> {
    if (!manager) {
      throw new Error("EntityManager instance is required");
    }
    const userRepo = manager.getRepository(OrmUserEntity);
    const orderRepo = manager.getRepository(OrmOrderEntity);
    const user = await userRepo.findOne({ where: { id: userId } });
    if (!user) {
      return null;
    }

    let auditFlagged = false;
    await this.connection
      .transaction(
        async (nestedManager) => {
          const scopedOrders = nestedManager.getRepository(OrmOrderEntity);
          const auditOrder = scopedOrders.create({
            id: `audit-${userId}`,
            sku: "audit",
            amount: 0,
            purchasedAt: new Date(),
            user,
          });
          await scopedOrders.save(auditOrder);
          throw new Error("audit-failure");
        },
        { identityScope: "isolated" },
      )
      .catch(() => {
        auditFlagged = true;
      });

    if (auditFlagged) {
      user.status = "needs-review";
    } else {
      const orders = await orderRepo.find({ relations: ["user"] });
      const ownedOrders = orders.filter((order) => order.user?.id === user.id);
      const totalAmount = ownedOrders.reduce(
        (sum, order) => sum + order.amount,
        0,
      );
      user.status = totalAmount > 100 ? "vip" : "active";
    }

    return userRepo.save(user);
  }

  @UnitOfWorkBoundary()
  async batchStatusSync(
    userIds: string[],
    unitOfWork?: UnitOfWork,
  ): Promise<void> {
    if (!unitOfWork) {
      throw new Error("UnitOfWork instance is required");
    }
    const userRepo = unitOfWork.getRepository(OrmUserEntity);
    for (const id of userIds) {
      const user = await userRepo.findOne({ where: { id } });
      if (!user) continue;
      if (user.status !== "vip") {
        user.status = "synced";
        await userRepo.save(user);
      }
    }
  }

  @UnitOfWorkBoundary()
  async batchSyncWithRollback(
    userIds: string[],
    unitOfWork?: UnitOfWork,
  ): Promise<void> {
    if (!unitOfWork) {
      throw new Error("UnitOfWork instance is required");
    }
    const userRepo = unitOfWork.getRepository(OrmUserEntity);
    for (const id of userIds) {
      const user = await userRepo.findOne({ where: { id } });
      if (!user) continue;
      user.status = "syncing";
      await userRepo.save(user);
    }
    throw new Error("sync-failed");
  }
}
