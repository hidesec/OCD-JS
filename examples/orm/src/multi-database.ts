import {
  Connection,
  Entity,
  Column,
  PrimaryColumn,
  JsonDatabaseDriver,
  MySqlDatabaseDriver,
  PostgresDatabaseDriver,
  MssqlDatabaseDriver,
  OracleDatabaseDriver,
} from "@ocd-js/orm";

@Entity({ table: "products" })
class ProductEntity {
  @PrimaryColumn({ type: "string" })
  id!: string;

  @Column({ type: "string" })
  name!: string;

  @Column({ type: "number" })
  price!: number;

  @Column({ type: "string" })
  category!: string;

  @Column({ type: "date" })
  createdAt!: Date;
}

async function runMultiDatabaseApp() {
  console.log("Multi-Database ORM Application");
  console.log("================================\n");

  const databases = [
    {
      name: "JSON File",
      driver: new JsonDatabaseDriver({ filePath: "./data/products.json" }),
    },
    {
      name: "MySQL",
      driver: new MySqlDatabaseDriver({
        host: process.env.MYSQL_HOST || "localhost",
        port: parseInt(process.env.MYSQL_PORT || "3306"),
        user: process.env.MYSQL_USER || "root",
        password: process.env.MYSQL_PASSWORD || "root",
        database: process.env.MYSQL_DATABASE || "ocd_js",
      }),
      enabled: process.env.MYSQL_ENABLED === "true",
    },
    {
      name: "PostgreSQL",
      driver: new PostgresDatabaseDriver({
        host: process.env.POSTGRES_HOST || "localhost",
        port: parseInt(process.env.POSTGRES_PORT || "5432"),
        user: process.env.POSTGRES_USER || "postgres",
        password: process.env.POSTGRES_PASSWORD || "postgres",
        database: process.env.POSTGRES_DATABASE || "ocd_js",
      }),
      enabled: process.env.POSTGRES_ENABLED === "true",
    },
    {
      name: "MSSQL",
      driver: new MssqlDatabaseDriver({
        server: process.env.MSSQL_SERVER || "localhost",
        port: parseInt(process.env.MSSQL_PORT || "1433"),
        user: process.env.MSSQL_USER || "sa",
        password: process.env.MSSQL_PASSWORD || "",
        database: process.env.MSSQL_DATABASE || "ocd_js",
        encrypt: true,
        trustServerCertificate: true,
      }),
      enabled: process.env.MSSQL_ENABLED === "true",
    },
    {
      name: "Oracle",
      driver: new OracleDatabaseDriver({
        user: process.env.ORACLE_USER || "system",
        password: process.env.ORACLE_PASSWORD || "oracle",
        connectString:
          process.env.ORACLE_CONNECT_STRING || "localhost:1521/FREE",
      }),
      enabled: process.env.ORACLE_ENABLED === "true",
    },
  ];

  for (const db of databases) {
    if (db.enabled === false) {
      console.log(`⏭️  Skipping ${db.name} (disabled)`);
      continue;
    }

    console.log(`\n🔄 Testing ${db.name}...`);

    try {
      const connection = new Connection({ driver: db.driver });
      await connection.initialize();

      const repo = connection.getRepository(ProductEntity);

      const product = repo.create({
        id: `prod-${Date.now()}`,
        name: "Test Product",
        price: 99.99,
        category: "Electronics",
        createdAt: new Date(),
      });

      await repo.save(product);
      console.log(`✅ Created product: ${product.id}`);

      const found = await repo.findOne({ where: { id: product.id } });
      console.log(`✅ Retrieved product: ${found?.name}`);

      const all = await repo.find();
      console.log(`✅ Total products in ${db.name}: ${all.length}`);

      await repo.remove(product);
      console.log(`✅ Deleted product: ${product.id}`);

      await connection.close();
      console.log(`✅ ${db.name} test completed successfully!`);
    } catch (error) {
      console.error(
        `❌ ${db.name} test failed:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  console.log("\n================================");
  console.log("Multi-Database tests completed!");
}

runMultiDatabaseApp().catch((error) => {
  console.error("Application failed:", error);
  process.exit(1);
});
