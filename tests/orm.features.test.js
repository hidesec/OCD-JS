const test = require("node:test");
const assert = require("node:assert/strict");

const {
  Entity,
  CacheEntity,
  Column,
  PrimaryColumn,
  ManyToMany,
  ManyToOne,
  OneToMany,
  OneToOne,
  Connection,
  MemoryDatabaseDriver,
  withSecondLevelCache,
  SchemaDiffer,
  SchemaBuilder,
  SqliteDatabaseDriver,
  Transactional,
  LazyReference,
  BeforeInsert,
  BeforeUpdate,
  BeforeRemove,
  AfterInsert,
  AfterUpdate,
  AfterRemove,
  ValidateEntity,
  EntityValidationError,
  registerOrmEventListener,
  registerQueryInstrumentation,
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
}

test("schema builder provisions composite primary keys", async () => {
  const driver = new MemoryDatabaseDriver();
  const builder = new SchemaBuilder(driver);
  builder.createTable("localized_strings", (table) => {
    table.column("locale", "string");
    table.column("key", "string");
    table.column("value", "string", { nullable: false });
    table.primary(["locale", "key"], "localized_strings_pk");
    table.unique(["locale"], "locale_unique");
  });
  await builder.execute();
  const schema = await driver.getSchema("localized_strings");
  assert.ok(schema);
  assert.deepEqual(schema.primaryColumns, ["locale", "key"]);
  assert.equal(schema.uniqueConstraints.length, 1);
});

test("unit of work commits and rolls back atomically", async () => {
  class UowPost {}
  Entity({ table: "uow_posts" })(UowPost);
  PrimaryColumn({ type: "string" })(UowPost.prototype, "id");
  Column({ type: "string" })(UowPost.prototype, "title");

  const connection = new Connection({ driver: new MemoryDatabaseDriver() });
  await connection.initialize();

  const uow = await connection.beginUnitOfWork();
  const repo = uow.getRepository(UowPost);
  await repo.save(repo.create({ title: "draft" }));
  await uow.rollback();

  const repoMain = connection.getRepository(UowPost);
  assert.equal((await repoMain.find()).length, 0);

  const uow2 = await connection.beginUnitOfWork();
  const repo2 = uow2.getRepository(UowPost);
  await repo2.save(repo2.create({ title: "published" }));
  await uow2.commit();

  const saved = await repoMain.find();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].title, "published");
});

test("transactions support nested savepoints", async () => {
  class TxItem {}
  Entity({ table: "tx_items" })(TxItem);
  PrimaryColumn({ type: "string" })(TxItem.prototype, "id");
  Column({ type: "string" })(TxItem.prototype, "label");

  const connection = new Connection({ driver: new MemoryDatabaseDriver() });
  await connection.initialize();

  await connection.transaction(async () => {
    const repo = connection.getRepository(TxItem);
    await repo.save(repo.create({ label: "outer:begin" }));
    await assert.rejects(
      connection.transaction(async () => {
        const nestedRepo = connection.getRepository(TxItem);
        await nestedRepo.save(nestedRepo.create({ label: "inner" }));
        throw new Error("boom");
      }),
    );
    const repoAfter = connection.getRepository(TxItem);
    await repoAfter.save(repoAfter.create({ label: "outer:end" }));
  });

  const finalRepo = connection.getRepository(TxItem);
  const rows = await finalRepo
    .queryBuilder()
    .orderBy("label", "asc")
    .getMany();
  assert.deepEqual(
    rows.map((row) => row.label),
    ["outer:begin", "outer:end"],
  );
});

test("many-to-many relations persist via join table", async () => {
  class MmPost {}
  Entity({ table: "mm_posts" })(MmPost);
  PrimaryColumn({ type: "string" })(MmPost.prototype, "id");
  Column({ type: "string" })(MmPost.prototype, "title");

  class MmTag {}
  Entity({ table: "mm_tags" })(MmTag);
  PrimaryColumn({ type: "string" })(MmTag.prototype, "id");
  Column({ type: "string" })(MmTag.prototype, "name");

  ManyToMany(() => MmTag, {
    joinTable: { name: "mm_post_tags", joinColumn: "postId", inverseJoinColumn: "tagId" },
  })(MmPost.prototype, "tags");

  const connection = new Connection({ driver: new MemoryDatabaseDriver() });
  await connection.initialize();

  const postRepo = connection.getRepository(MmPost);
  const tagRepo = connection.getRepository(MmTag);

  const tag = await tagRepo.save(tagRepo.create({ name: "orm" }));
  const post = postRepo.create({ title: "Hello ORM" });
  post.tags = [tag];
  await postRepo.save(post);

  const fetched = await postRepo.find({ relations: ["tags"] });
  assert.equal(fetched[0].tags.length, 1);
  assert.equal(fetched[0].tags[0].name, "orm");
});

test("schema differ detects column additions", async () => {
  class DiffEntity {}
  Entity({ table: "schema_diff_entities" })(DiffEntity);
  PrimaryColumn({ type: "string" })(DiffEntity.prototype, "id");
  Column({ type: "string" })(DiffEntity.prototype, "name");
  Column({ type: "string" })(DiffEntity.prototype, "status");

  const driver = new MemoryDatabaseDriver();
  await driver.init();
  await driver.ensureTable({
    name: "schema_diff_entities",
    columns: [
      { name: "id", type: "string" },
      { name: "name", type: "string" },
    ],
    primaryColumns: ["id"],
  });

  const differ = new SchemaDiffer(driver, [DiffEntity]);
  const plan = await differ.diff();
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.changes[0].type, "update-table");
  assert.equal(plan.changes[0].details.addColumns[0].name, "status");
  await differ.apply(plan);
  const schema = await driver.getSchema("schema_diff_entities");
  assert.ok(schema?.columns.find((column) => column.name === "status"));
});

test("one-to-one relations load eagerly", async () => {
  class Profile {}
  Entity({ table: "profiles" })(Profile);
  PrimaryColumn({ type: "string" })(Profile.prototype, "id");
  Column({ type: "string" })(Profile.prototype, "displayName");

  class Account {}
  Entity({ table: "accounts" })(Account);
  PrimaryColumn({ type: "string" })(Account.prototype, "id");
  Column({ type: "string" })(Account.prototype, "email");

  OneToOne(() => Profile, { eager: true, inverseSide: "account" })(
    Account.prototype,
    "profile",
  );
  OneToOne(() => Account, { owner: false, inverseSide: "profile" })(
    Profile.prototype,
    "account",
  );

  const connection = new Connection({ driver: new MemoryDatabaseDriver() });
  await connection.initialize();
  const profileRepo = connection.getRepository(Profile);
  const accountRepo = connection.getRepository(Account);

  const profile = await profileRepo.save(
    profileRepo.create({ displayName: "Neo" }),
  );
  const account = accountRepo.create({ email: "neo@matrix.io" });
  account.profile = profile;
  await accountRepo.save(account);

  const fetched = await accountRepo.findOne();
  assert.ok(fetched?.profile);
  assert.equal(fetched.profile.displayName, "Neo");

  const enrichedProfile = await profileRepo.findOne({ relations: ["account"] });
  assert.equal(enrichedProfile?.account?.email, "neo@matrix.io");
});

test("query builder paginates and counts", async () => {
  class PaginatedPost {}
  Entity({ table: "paginated_posts" })(PaginatedPost);
  PrimaryColumn({ type: "string" })(PaginatedPost.prototype, "id");
  Column({ type: "string" })(PaginatedPost.prototype, "title");
  Column({ type: "boolean" })(PaginatedPost.prototype, "published");

  const connection = new Connection({ driver: new MemoryDatabaseDriver() });
  await connection.initialize();
  const repo = connection.getRepository(PaginatedPost);
  await repo.save(repo.create({ title: "Alpha", published: true }));
  await repo.save(repo.create({ title: "Beta", published: true }));
  await repo.save(repo.create({ title: "Gamma", published: false }));

  const page = await repo
    .queryBuilder()
    .orderBy("title")
    .paginate(2, 1);
  assert.equal(page.meta.total, 3);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].title, "Beta");
  const count = await repo.queryBuilder().where("published", true).count();
  assert.equal(count, 2);
});

test("query builder leverages driver-level filtering", async () => {
  class PlanItem {}
  Entity({ table: "plan_items" })(PlanItem);
  PrimaryColumn({ type: "string" })(PlanItem.prototype, "id");
  Column({ type: "number" })(PlanItem.prototype, "score");

  class InstrumentedDriver extends MemoryDatabaseDriver {
    constructor() {
      super();
      this.readCount = 0;
    }

    async readTable(...args) {
      this.readCount += 1;
      return super.readTable(...args);
    }
  }

  const driver = new InstrumentedDriver();
  await driver.init();
  const connection = new Connection({ driver });
  await connection.initialize();
  const repo = connection.getRepository(PlanItem);

  for (let i = 0; i < 50; i += 1) {
    await repo.save(repo.create({ score: i }));
  }

  driver.readCount = 0;
  const results = await repo
    .queryBuilder()
    .where("score", { op: "gt", value: 40 })
    .orderBy("score", "desc")
    .limit(2)
    .getMany();
  assert.equal(results.length, 2);
  assert.equal(results[0].score, 49);
  assert.equal(driver.readCount, 0, "driver.readTable should be skipped when executeQuery is available");
});

test("sqlite driver stores and retrieves rows", async () => {
  const driver = new SqliteDatabaseDriver();
  await driver.init();
  await driver.ensureTable({
    name: "embedded_users",
    columns: [
      { name: "id", type: "string" },
      { name: "email", type: "string" },
    ],
    primaryColumns: ["id"],
  });
  await driver.writeTable("embedded_users", [
    { id: "user-1", email: "standalone@orm.dev" },
  ]);
  const rows = await driver.readTable("embedded_users");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].email, "standalone@orm.dev");
});

test("query builder supports relation joins and filters", async () => {
  class QBProfile {}
  Entity({ table: "qb_profiles" })(QBProfile);
  PrimaryColumn({ type: "string" })(QBProfile.prototype, "id");
  Column({ type: "boolean" })(QBProfile.prototype, "active");
  Column({ type: "string" })(QBProfile.prototype, "displayName");

  class QBUser {}
  Entity({ table: "qb_users" })(QBUser);
  PrimaryColumn({ type: "string" })(QBUser.prototype, "id");
  Column({ type: "string" })(QBUser.prototype, "email");
  OneToOne(() => QBProfile, { eager: false, inverseSide: "user" })(
    QBUser.prototype,
    "profile",
  );
  OneToOne(() => QBUser, { owner: false, inverseSide: "profile" })(
    QBProfile.prototype,
    "user",
  );

  const connection = new Connection({ driver: new MemoryDatabaseDriver() });
  await connection.initialize();
  const userRepo = connection.getRepository(QBUser);
  const profileRepo = connection.getRepository(QBProfile);

  const inactive = await profileRepo.save(
    profileRepo.create({ active: false, displayName: "Dormant" }),
  );
  const active = await profileRepo.save(
    profileRepo.create({ active: true, displayName: "Energetic" }),
  );

  const firstUser = userRepo.create({ email: "inactive@example.com" });
  firstUser.profile = inactive;
  await userRepo.save(firstUser);
  const secondUser = userRepo.create({ email: "active@example.com" });
  secondUser.profile = active;
  await userRepo.save(secondUser);

  const results = await userRepo
    .queryBuilder()
    .innerJoin("profile")
    .whereRelation("profile", (profile) => profile.active === true)
    .orderBy("email")
    .getMany();

  assert.equal(results.length, 1);
  assert.equal(results[0].email, "active@example.com");
  assert.equal(results[0].profile.displayName, "Energetic");
});

test("query builder whereRelation modes support some/every/none semantics", async () => {
  class RelationModeUser {}
  Entity({ table: "relation_mode_users" })(RelationModeUser);
  PrimaryColumn({ type: "string" })(RelationModeUser.prototype, "id");
  Column({ type: "string" })(RelationModeUser.prototype, "email");
  OneToMany(() => RelationModeOrder, "user", { lazy: false })(
    RelationModeUser.prototype,
    "orders",
  );

  class RelationModeOrder {}
  Entity({ table: "relation_mode_orders" })(RelationModeOrder);
  PrimaryColumn({ type: "string" })(RelationModeOrder.prototype, "id");
  Column({ type: "number" })(RelationModeOrder.prototype, "amount");
  ManyToOne(() => RelationModeUser, { lazy: false, onDelete: "cascade" })(
    RelationModeOrder.prototype,
    "user",
  );

  const connection = new Connection({ driver: new MemoryDatabaseDriver() });
  await connection.initialize();
  const userRepo = connection.getRepository(RelationModeUser);
  const orderRepo = connection.getRepository(RelationModeOrder);

  const alice = await userRepo.save(
    userRepo.create({ email: "alice@relations.io" }),
  );
  const bob = await userRepo.save(userRepo.create({ email: "bob@relations.io" }));
  const clara = await userRepo.save(
    userRepo.create({ email: "clara@relations.io" }),
  );

  await orderRepo.save(orderRepo.create({ amount: 125, user: alice }));
  await orderRepo.save(orderRepo.create({ amount: 90, user: alice }));
  await orderRepo.save(orderRepo.create({ amount: 15, user: bob }));

  const someHighValue = await userRepo
    .queryBuilder()
    .whereRelation("orders", (order) => order.amount > 100)
    .orderBy("email", "asc")
    .getMany();
  assert.deepEqual(
    someHighValue.map((user) => user.email),
    ["alice@relations.io"],
  );

  const everyPremium = await userRepo
    .queryBuilder()
    .whereRelation("orders", (order) => order.amount > 80, {
      mode: "every",
    })
    .orderBy("email", "asc")
    .getMany();
  assert.deepEqual(
    everyPremium.map((user) => user.email),
    ["alice@relations.io"],
  );

  const noneLargeOrders = await userRepo
    .queryBuilder()
    .whereRelation("orders", (order) => order.amount >= 50, {
      mode: "none",
    })
    .orderBy("email", "asc")
    .getMany();
  assert.deepEqual(
    noneLargeOrders.map((user) => user.email),
    ["bob@relations.io", "clara@relations.io"],
  );

  const recorded = [];
  const unregister = registerQueryInstrumentation((payload) => {
    recorded.push(payload);
  });
  await userRepo
    .queryBuilder()
    .leftJoin("orders")
    .whereRelation("orders", (order) => order.amount > 60, {
      mode: "every",
    })
    .getMany();
  unregister();
  const observed = recorded.pop();
  assert.ok(observed);
  assert.equal(observed.relationFilters, 1);
  assert.deepEqual(observed.relationFilterModes, ["every"]);
  assert.equal(observed.joinTypes.left, 1);
  assert.equal(observed.scanType, "driverPushdown");
});

test("query builder distinguishes inner and left joins", async () => {
  class JoinModeCustomer {}
  Entity({ table: "join_mode_customers" })(JoinModeCustomer);
  PrimaryColumn({ type: "string" })(JoinModeCustomer.prototype, "id");
  Column({ type: "string" })(JoinModeCustomer.prototype, "email");
  OneToMany(() => JoinModeInvoice, "customer", { lazy: false })(
    JoinModeCustomer.prototype,
    "invoices",
  );

  class JoinModeInvoice {}
  Entity({ table: "join_mode_invoices" })(JoinModeInvoice);
  PrimaryColumn({ type: "string" })(JoinModeInvoice.prototype, "id");
  Column({ type: "boolean" })(JoinModeInvoice.prototype, "paid");
  ManyToOne(() => JoinModeCustomer, { lazy: false, onDelete: "cascade" })(
    JoinModeInvoice.prototype,
    "customer",
  );

  const connection = new Connection({ driver: new MemoryDatabaseDriver() });
  await connection.initialize();
  const customerRepo = connection.getRepository(JoinModeCustomer);
  const invoiceRepo = connection.getRepository(JoinModeInvoice);

  const rich = await customerRepo.save(
    customerRepo.create({ email: "rich@joiners.io" }),
  );
  const trial = await customerRepo.save(
    customerRepo.create({ email: "trial@joiners.io" }),
  );
  await customerRepo.save(customerRepo.create({ email: "idle@joiners.io" }));

  await invoiceRepo.save(invoiceRepo.create({ paid: true, customer: rich }));
  await invoiceRepo.save(invoiceRepo.create({ paid: false, customer: trial }));

  const innerResults = await customerRepo
    .queryBuilder()
    .innerJoin("invoices", (invoice) => invoice.paid === true)
    .orderBy("email", "asc")
    .getMany();
  assert.deepEqual(innerResults.map((entry) => entry.email), ["rich@joiners.io"]);

  const leftResults = await customerRepo
    .queryBuilder()
    .leftJoin("invoices", (invoice) => invoice.paid === true)
    .orderBy("email", "asc")
    .getMany();
  assert.deepEqual(
    leftResults.map((entry) => entry.email),
    ["idle@joiners.io", "rich@joiners.io", "trial@joiners.io"],
  );
});

test("schema differ detects column removals", async () => {
  const driver = new MemoryDatabaseDriver();
  await driver.init();
  await driver.ensureTable({
    name: "legacy_table",
    columns: [
      { name: "id", type: "string" },
      { name: "present", type: "string" },
      { name: "legacy", type: "string" },
    ],
    primaryColumns: ["id"],
  });

  class LegacyEntity {}
  Entity({ table: "legacy_table" })(LegacyEntity);
  PrimaryColumn({ type: "string" })(LegacyEntity.prototype, "id");
  Column({ type: "string" })(LegacyEntity.prototype, "present");

  const differ = new SchemaDiffer(driver, [LegacyEntity]);
  const plan = await differ.diff();
  assert.equal(plan.changes.length, 1);
  const details = plan.changes[0].details;
  assert.ok(details.dropColumns.includes("legacy"));
});

test("Transactional decorator wraps service methods", async () => {
  class TxAccount {}
  Entity({ table: "tx_accounts" })(TxAccount);
  PrimaryColumn({ type: "string" })(TxAccount.prototype, "id");
  Column({ type: "string" })(TxAccount.prototype, "owner");

  const connection = new Connection({ driver: new MemoryDatabaseDriver() });
  await connection.initialize();

  class AccountService {
    constructor() {
      this.connection = connection;
    }

    async createAccounts(owners, manager) {
      const repo = manager.getRepository(TxAccount);
      for (const owner of owners) {
        await repo.save(repo.create({ owner }));
        if (owner === "error") {
          throw new Error("fail");
        }
      }
    }
  }

  const descriptor = Object.getOwnPropertyDescriptor(
    AccountService.prototype,
    "createAccounts",
  );
  const updatedDescriptor =
    Transactional()(
      AccountService.prototype,
      "createAccounts",
      descriptor,
    ) ?? descriptor;
  Object.defineProperty(
    AccountService.prototype,
    "createAccounts",
    updatedDescriptor,
  );

  const service = new AccountService();
  await assert.rejects(service.createAccounts(["alpha", "error"]));
  const repo = connection.getRepository(TxAccount);
  assert.equal((await repo.find()).length, 0);

  await service.createAccounts(["beta", "gamma"]);
  const saved = await repo
    .queryBuilder()
    .orderBy("owner", "asc")
    .getMany();
  assert.deepEqual(
    saved.map((row) => row.owner),
    ["beta", "gamma"],
  );
});

test("lazy relations resolve via LazyReference", async () => {
  class LazyAuthor {}
  Entity({ table: "lazy_authors" })(LazyAuthor);
  PrimaryColumn({ type: "string" })(LazyAuthor.prototype, "id");
  Column({ type: "string" })(LazyAuthor.prototype, "name");
  OneToMany(() => LazyPost, "author", { lazy: true })(
    LazyAuthor.prototype,
    "posts",
  );

  class LazyPost {}
  Entity({ table: "lazy_posts" })(LazyPost);
  PrimaryColumn({ type: "string" })(LazyPost.prototype, "id");
  Column({ type: "string" })(LazyPost.prototype, "title");
  ManyToOne(() => LazyAuthor, { lazy: true })(LazyPost.prototype, "author");

  const connection = new Connection({ driver: new MemoryDatabaseDriver() });
  await connection.initialize();
  const authorRepo = connection.getRepository(LazyAuthor);
  const postRepo = connection.getRepository(LazyPost);

  const author = await authorRepo.save(
    authorRepo.create({ name: "Lazy Alice" }),
  );
  const post = postRepo.create({ title: "Lazy loading" });
  post.author = author;
  await postRepo.save(post);

  const posts = await postRepo.find();
  const fetchedPost = posts[0];
  assert.ok(fetchedPost.author instanceof LazyReference);
  const resolvedAuthor = await fetchedPost.author;
  assert.equal(resolvedAuthor.name, "Lazy Alice");
  assert.equal(fetchedPost.author.name, "Lazy Alice");

  const authors = await authorRepo.find();
  const fetchedAuthor = authors[0];
  assert.ok(fetchedAuthor.posts instanceof LazyReference);
  const resolvedPosts = await fetchedAuthor.posts;
  assert.equal(resolvedPosts.length, 1);
  assert.equal(resolvedPosts[0].title, "Lazy loading");
});

test("lazy many-to-many relations persist without eager load", async () => {
  class LazyCategory {}
  Entity({ table: "lazy_categories" })(LazyCategory);
  PrimaryColumn({ type: "string" })(LazyCategory.prototype, "id");
  Column({ type: "string" })(LazyCategory.prototype, "name");

  class LazyArticle {}
  Entity({ table: "lazy_articles" })(LazyArticle);
  PrimaryColumn({ type: "string" })(LazyArticle.prototype, "id");
  Column({ type: "string" })(LazyArticle.prototype, "title");

  ManyToMany(() => LazyCategory, {
    joinTable: { name: "lazy_article_categories" },
    lazy: true,
  })(LazyArticle.prototype, "categories");

  ManyToMany(() => LazyArticle, {
    owner: false,
    inverseSide: "categories",
    lazy: true,
  })(LazyCategory.prototype, "articles");

  const connection = new Connection({ driver: new MemoryDatabaseDriver() });
  await connection.initialize();
  const categoryRepo = connection.getRepository(LazyCategory);
  const articleRepo = connection.getRepository(LazyArticle);

  const category = await categoryRepo.save(
    categoryRepo.create({ name: "tech" }),
  );
  const article = articleRepo.create({ title: "First" });
  article.categories = [category];
  await articleRepo.save(article);

  const fetchedArticle = (await articleRepo.find())[0];
  assert.ok(fetchedArticle.categories instanceof LazyReference);
  fetchedArticle.title = "Updated";
  await articleRepo.save(fetchedArticle);

  const withCategories = await articleRepo.find({ relations: ["categories"] });
  assert.equal(withCategories[0].categories.length, 1);
  assert.equal(withCategories[0].categories[0].name, "tech");

  const lazyAgain = (await articleRepo.find())[0];
  const resolvedCategories = await lazyAgain.categories;
  assert.equal(resolvedCategories.length, 1);
  assert.equal(resolvedCategories[0].name, "tech");
});

test("entity lifecycle hooks and validation execute", async () => {
  const removed = [];

  class HookedEntity {
    constructor() {
      this.version = 0;
    }

    setDefaultStatus() {
      if (!this.status) {
        this.status = "draft";
      }
    }

    bumpVersion() {
      this.version += 1;
    }

    ensureTitleIsValid() {
      if (!this.title || !this.title.startsWith("valid")) {
        throw new Error("Invalid title");
      }
    }

    trackRemoval() {
      removed.push(this.title);
    }
  }

  Entity({ table: "hooked_entities" })(HookedEntity);
  PrimaryColumn({ type: "string" })(HookedEntity.prototype, "id");
  Column({ type: "string" })(HookedEntity.prototype, "title");
  Column({ type: "string" })(HookedEntity.prototype, "status");
  Column({ type: "number" })(HookedEntity.prototype, "version");

  const define = (method) =>
    Object.getOwnPropertyDescriptor(HookedEntity.prototype, method);

  BeforeInsert()(HookedEntity.prototype, "setDefaultStatus", define("setDefaultStatus"));
  BeforeInsert()(HookedEntity.prototype, "bumpVersion", define("bumpVersion"));
  BeforeUpdate()(HookedEntity.prototype, "bumpVersion", define("bumpVersion"));
  ValidateEntity()(HookedEntity.prototype, "ensureTitleIsValid", define("ensureTitleIsValid"));
  BeforeRemove()(HookedEntity.prototype, "trackRemoval", define("trackRemoval"));

  const connection = new Connection({ driver: new MemoryDatabaseDriver() });
  await connection.initialize();
  const repo = connection.getRepository(HookedEntity);

  const invalid = repo.create({ title: "bad" });
  await assert.rejects(repo.save(invalid));

  const entity = repo.create({ title: "valid title" });
  const inserted = await repo.save(entity);
  assert.equal(inserted.status, "draft");
  assert.equal(inserted.version, 1);

  inserted.title = "valid updated";
  const updated = await repo.save(inserted);
  assert.equal(updated.version, 2);

  await repo.delete({ id: updated.id });
  assert.deepEqual(removed, ["valid updated"]);
});

test("hooks receive context and validation aggregates errors", async () => {
  const changedFields = [];

  class AdvancedEntity {
    constructor() {
      this.status = "pending";
    }

    recordChanges(context) {
      changedFields.push(context.changeSet?.changedFields ?? []);
    }

    ensureBusinessRules(context) {
      if (!this.title) {
        context.addError("title", "Title is required");
      }
      if (!this.slug) {
        context.addError("slug", "Slug is required");
      }
      if (context.metadata?.tableName !== "advanced_entities") {
        context.addError(undefined, "Metadata missing");
      }
    }
  }

  Entity({ table: "advanced_entities" })(AdvancedEntity);
  PrimaryColumn({ type: "string" })(AdvancedEntity.prototype, "id");
  Column({ type: "string" })(AdvancedEntity.prototype, "title");
  Column({ type: "string" })(AdvancedEntity.prototype, "slug");
  Column({ type: "string" })(AdvancedEntity.prototype, "status");

  const define = (method) =>
    Object.getOwnPropertyDescriptor(AdvancedEntity.prototype, method);

  BeforeUpdate()(AdvancedEntity.prototype, "recordChanges", define("recordChanges"));
  ValidateEntity()(AdvancedEntity.prototype, "ensureBusinessRules", define("ensureBusinessRules"));

  const connection = new Connection({ driver: new MemoryDatabaseDriver() });
  await connection.initialize();
  const repo = connection.getRepository(AdvancedEntity);

  const invalid = repo.create({ title: "", slug: "" });
  await assert.rejects(
    repo.save(invalid),
    (error) => {
      assert.ok(error instanceof EntityValidationError);
      assert.equal(error.errors.length, 2);
      const paths = error.errors.map((entry) => entry.path).sort();
      assert.deepEqual(paths, ["slug", "title"]);
      return true;
    },
  );

  const valid = repo.create({ title: "Valid", slug: "valid" });
  const saved = await repo.save(valid);
  saved.title = "Valid updated";
  await repo.save(saved);

  assert.equal(changedFields.length, 1);
  assert.deepEqual(changedFields[0], ["title"]);
});

test("after hooks emit updated change sets and timestamps", async () => {
  class LifecycleEntity {
    constructor() {
      this.audit = [];
    }

    recordInsert(context) {
      this.audit.push({ action: context.action, changed: context.changeSet?.changedFields ?? [] });
      assert.ok(typeof context.timestamp === "number");
    }

    recordUpdate(context) {
      this.audit.push({ action: context.action, changed: context.changeSet?.changedFields ?? [] });
    }

    trackRemoval(context) {
      LifecycleEntity.removed.push(context.changeSet?.before?.title);
    }
  }

  LifecycleEntity.removed = [];

  Entity({ table: "lifecycle_entities" })(LifecycleEntity);
  PrimaryColumn({ type: "string" })(LifecycleEntity.prototype, "id");
  Column({ type: "string" })(LifecycleEntity.prototype, "title");

  const define = (method) =>
    Object.getOwnPropertyDescriptor(LifecycleEntity.prototype, method);

  AfterInsert()(LifecycleEntity.prototype, "recordInsert", define("recordInsert"));
  AfterUpdate()(LifecycleEntity.prototype, "recordUpdate", define("recordUpdate"));
  BeforeRemove()(LifecycleEntity.prototype, "trackRemoval", define("trackRemoval"));
  AfterRemove()(LifecycleEntity.prototype, "trackRemoval", define("trackRemoval"));

  const connection = new Connection({ driver: new MemoryDatabaseDriver() });
  await connection.initialize();
  const repo = connection.getRepository(LifecycleEntity);

  const entity = repo.create({ title: "initial" });
  const inserted = await repo.save(entity);
  assert.equal(inserted.audit[0].action, "afterInsert");
  assert.ok(inserted.audit[0].changed.includes("title"));

  inserted.title = "updated";
  const updated = await repo.save(inserted);
  assert.equal(updated.audit.length, 2);
  assert.equal(updated.audit[1].action, "afterUpdate");
  assert.ok(updated.audit[1].changed.includes("title"));

  await repo.delete({ id: updated.id });
  assert.deepEqual(LifecycleEntity.removed, ["updated", "updated"]);
});

test("global lifecycle events publish payloads", async () => {
  const events = [];

  class EventEntity {}
  Entity({ table: "event_entities" })(EventEntity);
  PrimaryColumn({ type: "string" })(EventEntity.prototype, "id");
  Column({ type: "string" })(EventEntity.prototype, "state");

  const unregister = [
    registerOrmEventListener("beforeEntityPersist", (payload) =>
      events.push(`before:${payload.action}:${payload.changeSet.changedFields.length}`),
    ),
    registerOrmEventListener("afterEntityPersist", (payload) =>
      events.push(`after:${payload.action}:${payload.metadata.tableName}`),
    ),
    registerOrmEventListener("beforeEntityRemove", (payload) =>
      events.push(`before-remove:${payload.changeSet.changedFields.length}`),
    ),
    registerOrmEventListener("afterEntityRemove", (payload) =>
      events.push(`after-remove:${payload.metadata.tableName}`),
    ),
  ];

  const connection = new Connection({ driver: new MemoryDatabaseDriver() });
  await connection.initialize();
  const repo = connection.getRepository(EventEntity);

  const entity = await repo.save(repo.create({ state: "draft" }));
  entity.state = "final";
  await repo.save(entity);
  await repo.delete({ id: entity.id });

  unregister.forEach((dispose) => dispose());

  assert.ok(events.some((entry) => entry.startsWith("before:insert")));
  assert.ok(events.some((entry) => entry.startsWith("after:update")));
  assert.ok(events.includes("after-remove:event_entities"));
});

test("identity map reuses entity instances and proxies track updates", async () => {
  class IdentityArticle {}

  Entity({ table: "identity_articles" })(IdentityArticle);
  PrimaryColumn({ type: "string" })(IdentityArticle.prototype, "id");
  Column({ type: "string" })(IdentityArticle.prototype, "title");
  Column({ type: "string" })(IdentityArticle.prototype, "status");

  const connection = new Connection({ driver: new MemoryDatabaseDriver() });
  await connection.initialize();
  const repo = connection.getRepository(IdentityArticle);

  const created = repo.create({ title: "Alpha", status: "draft" });
  await repo.save(created);

  const firstLookup = await repo.findOne({ where: { id: created.id } });
  const secondLookup = await repo.findOne({ where: { id: created.id } });
  assert.strictEqual(firstLookup, secondLookup);
  assert.strictEqual(firstLookup, created);

  firstLookup.title = "Beta";
  const updated = await repo.save(firstLookup);
  const thirdLookup = await repo.findOne({ where: { id: created.id } });
  assert.strictEqual(updated, thirdLookup);
  assert.equal(thirdLookup.title, "Beta");

  await repo.delete({ id: created.id });
  const afterDelete = await repo.findOne({ where: { id: created.id } });
  assert.equal(afterDelete, null);
});

test("unit of work uses scoped identity map and adopts on commit", async () => {
  class ScopedEntity {}
  Entity({ table: "scoped_entities" })(ScopedEntity);
  PrimaryColumn({ type: "string" })(ScopedEntity.prototype, "id");
  Column({ type: "string" })(ScopedEntity.prototype, "name");

  const connection = new Connection({ driver: new MemoryDatabaseDriver() });
  await connection.initialize();
  const repo = connection.getRepository(ScopedEntity);

  const saved = await repo.save(repo.create({ name: "initial" }));
  const globalInstance = await repo.findOne({ where: { id: saved.id } });

  const uow = await connection.beginUnitOfWork();
  const scopedRepo = uow.getRepository(ScopedEntity);
  const scopedInstance = await scopedRepo.findOne({ where: { id: saved.id } });
  assert.notStrictEqual(scopedInstance, globalInstance);
  scopedInstance.name = "updated";
  await scopedRepo.save(scopedInstance);
  await uow.commit();

  const after = await repo.findOne({ where: { id: saved.id } });
  assert.strictEqual(after, scopedInstance);
  assert.equal(after.name, "updated");
  assert.notStrictEqual(after, globalInstance);
});

test("transaction identity map scope is isolated and merged", async () => {
  class TxScopedEntity {}
  Entity({ table: "tx_scoped_entities" })(TxScopedEntity);
  PrimaryColumn({ type: "string" })(TxScopedEntity.prototype, "id");
  Column({ type: "string" })(TxScopedEntity.prototype, "name");

  const connection = new Connection({ driver: new MemoryDatabaseDriver() });
  await connection.initialize();
  const repo = connection.getRepository(TxScopedEntity);
  const saved = await repo.save(repo.create({ name: "before" }));
  const outside = await repo.findOne({ where: { id: saved.id } });

  let scopedInstance;
  await connection.transaction(async (manager) => {
    const scopedRepo = manager.getRepository(TxScopedEntity);
    scopedInstance = await scopedRepo.findOne({ where: { id: saved.id } });
    assert.notStrictEqual(scopedInstance, outside);
    scopedInstance.name = "after-tx";
    await scopedRepo.save(scopedInstance);
  });

  const after = await repo.findOne({ where: { id: saved.id } });
  assert.strictEqual(after, scopedInstance);
  assert.equal(after.name, "after-tx");
});

test("afterLoad listeners execute globally", async () => {
  class EventEntity {}
  Entity({ table: "event_entities" })(EventEntity);
  PrimaryColumn({ type: "string" })(EventEntity.prototype, "id");
  Column({ type: "string" })(EventEntity.prototype, "label");

  const seen = [];
  const unregister = registerOrmEventListener("afterLoad", ({ metadata, entity }) => {
    seen.push(metadata.tableName);
    entity.decorated = true;
  });

  const connection = new Connection({ driver: new MemoryDatabaseDriver() });
  await connection.initialize();
  const repo = connection.getRepository(EventEntity);

  const saved = await repo.save(repo.create({ label: "alpha" }));
  assert.equal(saved.decorated, true);

  const fetched = await repo.findOne({ where: { id: saved.id } });
  assert.equal(fetched.decorated, true);
  unregister();
  assert.ok(seen.filter((name) => name === "event_entities").length >= 2);
});

test("afterCommit listeners fire for transactions and unit of work", async () => {
  class EventCommit {}
  Entity({ table: "event_commits" })(EventCommit);
  PrimaryColumn({ type: "string" })(EventCommit.prototype, "id");
  Column({ type: "string" })(EventCommit.prototype, "value");

  const scopes = [];
  const unregister = registerOrmEventListener("afterCommit", ({ scope }) => {
    scopes.push(scope);
  });

  const connection = new Connection({ driver: new MemoryDatabaseDriver() });
  await connection.initialize();

  await connection.transaction(async (manager) => {
    const repo = manager.getRepository(EventCommit);
    await repo.save(repo.create({ value: "tx" }));
  });

  const uow = await connection.beginUnitOfWork();
  const scopedRepo = uow.getRepository(EventCommit);
  await scopedRepo.save(scopedRepo.create({ value: "uow" }));
  await uow.commit();

  unregister();
  assert.deepEqual(scopes, ["transaction", "unitOfWork"]);
});

test("second-level cache serves repeated reads without hitting driver", async () => {
  class CachedMessage {}
  Entity({ table: "cached_messages" })(CachedMessage);
  CacheEntity({ ttl: 5000 })(CachedMessage);
  PrimaryColumn({ type: "string" })(CachedMessage.prototype, "id");
  Column({ type: "string" })(CachedMessage.prototype, "body");

  const countingDriver = new CountingMemoryDriver();
  const connection = new Connection({
    driver: withSecondLevelCache(countingDriver, { defaultTtl: 5000 }),
  });
  await connection.initialize();
  const repo = connection.getRepository(CachedMessage);
  const saved = await repo.save(repo.create({ body: "hello" }));

  countingDriver.readCount = 0;
  await repo.findOne({ where: { id: saved.id } });
  const readsAfterFirst = countingDriver.readCount;
  await repo.findOne({ where: { id: saved.id } });
  assert.equal(countingDriver.readCount, readsAfterFirst);
});

test("second-level cache invalidates after writes", async () => {
  class CachedProfile {}
  Entity({ table: "cached_profiles" })(CachedProfile);
  CacheEntity({ ttl: 2000 })(CachedProfile);
  PrimaryColumn({ type: "string" })(CachedProfile.prototype, "id");
  Column({ type: "string" })(CachedProfile.prototype, "name");

  const countingDriver = new CountingMemoryDriver();
  const connection = new Connection({
    driver: withSecondLevelCache(countingDriver, { defaultTtl: 2000 }),
  });
  await connection.initialize();
  const repo = connection.getRepository(CachedProfile);
  const saved = await repo.save(repo.create({ name: "before" }));

  await repo.findOne({ where: { id: saved.id } });
  saved.name = "after";
  await repo.save(saved);

  countingDriver.readCount = 0;
  const fetched = await repo.findOne({ where: { id: saved.id } });
  assert.equal(fetched?.name, "after");
  assert.equal(countingDriver.readCount, 0);
});

test("query plan instrumentation captures metrics", async () => {
  class InstrumentedItem {}
  Entity({ table: "instrumented_items" })(InstrumentedItem);
  PrimaryColumn({ type: "string" })(InstrumentedItem.prototype, "id");
  Column({ type: "string" })(InstrumentedItem.prototype, "label");

  const payloads = [];
  const unregister = registerQueryInstrumentation((payload) => {
    payloads.push(payload);
  });

  const connection = new Connection({ driver: new MemoryDatabaseDriver() });
  await connection.initialize();
  const repo = connection.getRepository(InstrumentedItem);
  await repo.save(repo.create({ label: "observed" }));
  const results = await repo.find({ where: { label: "observed" } });
  await repo
    .queryBuilder()
    .andWhere(() => true)
    .getMany();

  unregister();
  assert.equal(results.length, 1);
  assert.ok(payloads.length >= 2);
  const pushdownPayload = payloads.find((entry) => entry.scanType === "driverPushdown");
  const tableScanPayload = payloads.find((entry) => entry.scanType === "tableScan");
  assert.ok(pushdownPayload);
  assert.ok(tableScanPayload);
  assert.equal(pushdownPayload.plan.table, "instrumented_items");
  assert.equal(pushdownPayload.operation, "many");
  assert.equal(pushdownPayload.resultCount, 1);
  assert.equal(pushdownPayload.driverPushdown, true);
  assert.equal(pushdownPayload.source, "driver");
  assert.equal(pushdownPayload.filters, 1);
  assert.equal(pushdownPayload.relationFilters, 0);
  assert.deepEqual(pushdownPayload.joinTypes, { inner: 0, left: 0 });
  assert.equal(pushdownPayload.requestedRelations, 0);
  assert.ok(pushdownPayload.durationMs >= 0);
  assert.equal(tableScanPayload.scanType, "tableScan");
  assert.equal(tableScanPayload.driverPushdown, false);
});

