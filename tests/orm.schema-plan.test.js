const test = require("node:test");
const assert = require("node:assert/strict");

const {
  generateSchemaStatements,
} = require("@ocd-js/orm");

test("generate schema statements for sqlite plan", () => {
  const plan = {
    changes: [
      {
        type: "create-table",
        table: "users",
        schema: {
          name: "users",
          columns: [
            { name: "id", type: "string", nullable: false },
            { name: "email", type: "string" },
          ],
          primaryColumns: ["id"],
          uniqueConstraints: [{ columns: ["email"], name: "users_email_uniq" }],
          foreignKeys: [],
        },
      },
      {
        type: "update-table",
        table: "users",
        schema: {
          name: "users",
          columns: [
            { name: "id", type: "string" },
            { name: "email", type: "string" },
            { name: "status", type: "string" },
          ],
          primaryColumns: ["id"],
          uniqueConstraints: [],
          foreignKeys: [],
        },
        details: {
          addColumns: [{ name: "status", type: "string" }],
          alterColumns: [],
          dropColumns: ["legacy"],
          addUniqueConstraints: [],
          dropUniqueConstraints: [],
          addForeignKeys: [],
          dropForeignKeys: [],
        },
      },
    ],
  };

  const statements = generateSchemaStatements(plan, { dialect: "sqlite" });
  assert.equal(statements.length, 3);
  assert.ok(statements[0].startsWith("CREATE TABLE"));
  assert.ok(statements[1].includes("ADD COLUMN"));
  assert.ok(statements[2].includes("requires table rebuild"));
});
