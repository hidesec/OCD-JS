import { randomUUID } from "node:crypto";
import { StructuredLogger } from "@ocd-js/observability";
import {
  CacheEntity,
  Column,
  createStandaloneConnection,
  Entity,
  PrimaryColumn,
  QueryPlanMetricsPayload,
  registerOrmEventListener,
  registerQueryInstrumentation,
} from "@ocd-js/orm";

@Entity({ table: "tenant_accounts" })
@CacheEntity({ ttl: 2500 })
class AccountRecordEntity {
  @PrimaryColumn({ type: "string" })
  id!: string;

  @Column({ type: "string" })
  email!: string;

  @Column({ type: "json", nullable: true })
  profile?: Record<string, unknown>;

  @Column({ type: "date" })
  createdAt!: Date;
}

export const runOrmWorkflow = async (logger: StructuredLogger) => {
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
      (entity as AccountRecordEntity).profile ??= { hydrated: true };
    },
  );

  const repo = connection.getRepository(AccountRecordEntity);
  const created = await repo.save(
    repo.create({
      id: randomUUID(),
      email: "orm@example.com",
      profile: { plan: "free" },
      createdAt: new Date(),
    }),
  );

  await repo.findOne({ where: { id: created.id } });
  await repo.findOne({ where: { id: created.id } });

  await connection.transaction(async (manager) => {
    const scopedRepo = manager.getRepository(AccountRecordEntity);
    const record = await scopedRepo.findOne({ where: { id: created.id } });
    if (record) {
      record.profile = { plan: "pro", transactional: true };
      await scopedRepo.save(record);
    }
  });

  const afterTransaction = await repo.findOne({ where: { id: created.id } });

  unregisterAfterLoad();
  unregisterMetrics();

  logger.info("ORM workflow finished", {
    cachedReads: metrics.filter((m) => m.source === "driver").length,
    driverPushdown: metrics.filter((m) => m.driverPushdown).length,
    operations: metrics.length,
    latestProfile: afterTransaction?.profile,
  });
};

export { AccountRecordEntity };
