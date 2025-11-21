import {
  CacheEntity,
  Column,
  Entity,
  LazyReference,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
} from "@ocd-js/orm";

@Entity({ table: "orm_users" })
@CacheEntity({ ttl: 2000 })
export class OrmUserEntity {
  @PrimaryColumn({ type: "string" })
  id!: string;

  @Column({ type: "string" })
  email!: string;

  @Column({ type: "string" })
  status!: string;

  @Column({ type: "date" })
  createdAt!: Date;

  @OneToMany(() => OrmOrderEntity, "user", { lazy: true })
  orders!: LazyReference<OrmOrderEntity[]>;
}

@Entity({ table: "orm_orders" })
export class OrmOrderEntity {
  @PrimaryColumn({ type: "string" })
  id!: string;

  @Column({ type: "string" })
  sku!: string;

  @Column({ type: "number" })
  amount!: number;

  @Column({ type: "date" })
  purchasedAt!: Date;

  @ManyToOne(() => OrmUserEntity, { lazy: true, onDelete: "cascade" })
  user!: OrmUserEntity;
}
