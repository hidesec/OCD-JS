import path from "node:path";
import { startDevServer } from "@ocd-js/dev-server";

async function bootstrap() {
  const root = path.resolve(__dirname, "..");
  startDevServer({
    projectRoot: root,
    entry: "mock-app/dist/server.js",
    watch: ["mock-app/src/**/*.js"],
    buildCmd: "node scripts/mock-build.js",
    lintCmd: "node scripts/mock-lint.js",
    env: {
      OCD_DEV_DEMO: "true",
    },
  });

  setTimeout(() => {
    console.log("[dev-server] demo completed");
    process.exit(0);
  }, 1500);
}

bootstrap();
