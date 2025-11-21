import { Migration, MigrationContext } from "@ocd-js/orm";

@Migration({ id: "2024112101_create_order_metrics" })
export class CreateOrderMetricsTable {
  async up({ schema }: MigrationContext) {
    schema.createTable("order_metrics", (table) => {
      table.column("sku", "string", { nullable: false });
      table.column("orderCount", "number", { nullable: false });
      table.column("totalAmount", "number", { nullable: false });
      table.column("capturedAt", "date", { nullable: false });
      table.primary(["sku", "capturedAt"], "order_metrics_pk");
    });
  }

  async down({ schema }: MigrationContext) {
    schema.dropTable("order_metrics");
  }
}
