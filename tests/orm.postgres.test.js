const test = require("node:test");
const assert = require("node:assert/strict");
const {
  Entity,
  Column,
  PrimaryColumn,
  ManyToOne,
  OneToMany,
  Unique,
  Connection,
  PostgresDatabaseDriver,
  SqliteDatabaseDriver,
  Like,
} = require("@ocd-js/orm");

const flag = (process.env.OCD_JS_PG_TEST ?? "").trim();
const shouldRun = /^(true|1)$/i.test(flag);
test("postgres driver end-to-end", async () => {
  class PgAuthor {}
  class PgPost {}
  class PgLocalizedString {}

  Entity({ table: "pg_authors" })(PgAuthor);
  PrimaryColumn({ type: "string" })(PgAuthor.prototype, "id");
  Column({ type: "string" })(PgAuthor.prototype, "name");
  Column({ type: "string", unique: true })(PgAuthor.prototype, "email");
  OneToMany(() => PgPost, "author")(PgAuthor.prototype, "posts");

  Entity({ table: "pg_posts" })(PgPost);
  PrimaryColumn({ type: "string" })(PgPost.prototype, "id");
  Column({ type: "string" })(PgPost.prototype, "title");
  ManyToOne(() => PgAuthor, {
    joinColumn: "authorId",
    onDelete: "cascade",
    onUpdate: "cascade",
  })(PgPost.prototype, "author");

  Entity({ table: "pg_localized_strings" })(PgLocalizedString);
  PrimaryColumn({ type: "string" })(PgLocalizedString.prototype, "locale");
  PrimaryColumn({ type: "string" })(PgLocalizedString.prototype, "key");
  Column({ type: "string" })(PgLocalizedString.prototype, "namespace");
  Column({ type: "string" })(PgLocalizedString.prototype, "value");
  Unique(["locale", "namespace"])(PgLocalizedString);

  const driver = shouldRun
    ? new PostgresDatabaseDriver({
        host: process.env.PGHOST ?? "localhost",
        port: Number(process.env.PGPORT ?? 5432),
        user: process.env.PGUSER ?? "postgres",
        password: process.env.PGPASSWORD ?? "postgres",
        database: process.env.PGDATABASE ?? "ocd_js_test",
      })
    : new SqliteDatabaseDriver();

  const connection = new Connection({ driver });
  await connection.initialize();

  await driver.writeTable("pg_posts", []);
  await driver.writeTable("pg_authors", []);
  await driver.writeTable("pg_localized_strings", []);

  const authorRepo = connection.getRepository(PgAuthor);
  const postRepo = connection.getRepository(PgPost);
  const localizedRepo = connection.getRepository(PgLocalizedString);

  const savedAuthor = await authorRepo.save(
    authorRepo.create({ name: "Postgres Author", email: "author@ocd-js.dev" }),
  );

  const savedPost = await postRepo.save(
    Object.assign(postRepo.create({ title: "Hello PG" }), {
      author: savedAuthor,
    }),
  );

  assert.ok(savedPost.authorId, "relation setter writes join column");

  const authors = await authorRepo.find({ relations: ["posts"] });
  assert.equal(authors.length, 1);
  assert.equal(authors[0].posts.length, 1);

  const posts = await postRepo.find({
    where: { title: Like("PG") },
    relations: ["author"],
  });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].author.name, "Postgres Author");

  await assert.rejects(
    authorRepo.save(
      authorRepo.create({
        name: "Dup Author",
        email: "author@ocd-js.dev",
      }),
    ),
    /unique|duplicate/i,
  );

  const cascadeAuthor = await authorRepo.save(
    authorRepo.create({
      name: "Cascade Author",
      email: "cascade@ocd-js.dev",
    }),
  );
  const cascadePost = await postRepo.save(
    Object.assign(postRepo.create({ title: "Cascade Post" }), {
      author: cascadeAuthor,
    }),
  );
  await authorRepo.delete({ id: cascadeAuthor.id });
  const postsAfterDelete = await driver.readTable("pg_posts");
  assert.ok(
    !postsAfterDelete.some((row) => row.authorId === cascadePost.authorId),
    "cascade delete removes dependent posts",
  );

  await localizedRepo.save(
    localizedRepo.create({
      locale: "en",
      key: "greeting",
      namespace: "common",
      value: "Hello",
    }),
  );
  await localizedRepo.save(
    localizedRepo.create({
      locale: "en",
      key: "greeting",
      namespace: "common",
      value: "Hello again",
    }),
  );
  const localized = await localizedRepo.find();
  assert.equal(localized.length, 1);
  assert.equal(localized[0].value, "Hello again");

  await assert.rejects(
    localizedRepo.save(
      localizedRepo.create({
        locale: "en",
        key: "farewell",
        namespace: "common",
        value: "Bye",
      }),
    ),
    /unique|duplicate/i,
  );

  await driver.dropTable("pg_posts");
  await driver.dropTable("pg_authors");
  await driver.dropTable("pg_localized_strings");
});
