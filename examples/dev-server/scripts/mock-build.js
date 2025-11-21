const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const templatePath = path.resolve(root, "mock-app/src/server-template.js");
const distDir = path.resolve(root, "mock-app/dist");
const outFile = path.resolve(distDir, "server.js");

fs.mkdirSync(distDir, { recursive: true });

const template = fs.readFileSync(templatePath, "utf-8");
const contents = template.replace(
  "__BUILD_TIME__",
  new Date().toISOString(),
);

fs.writeFileSync(outFile, contents);

console.log("[dev-server] mock build emitted", outFile);
