import {
  AfterInsert,
  AfterUpdate,
  BeforeInsert,
  BeforeUpdate,
  CacheEntity,
  Column,
  Entity,
  LazyReference,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  ValidateEntity,
  ValidationContext,
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

  auditTrail: string[] = [];

  @BeforeInsert()
  seedDefaultStatus() {
    this.email = this.email?.toLowerCase();
    if (!this.status) {
      this.status = "queued";
    }
  }

  @BeforeUpdate()
  captureStatusHistory() {
    const note = `${this.status}:${Date.now()}`;
    this.auditTrail = [...(this.auditTrail ?? []), note];
  }

  @AfterInsert()
  trackInsertion() {
    this.auditTrail = [...(this.auditTrail ?? []), "after-insert"];
  }

  @AfterUpdate()
  trackUpdate() {
    this.auditTrail = [...(this.auditTrail ?? []), "after-update"];
  }

  @ValidateEntity()
  validateEmail(context: ValidationContext<OrmUserEntity>) {
    if (!this.email || !this.email.includes("@")) {
      context.addError("email", "email must include @");
    }
  }
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
