#!/usr/bin/env node
import path from "node:path";
import { startDevServer } from "./index";

const args = process.argv.slice(2);
const options = parseArgs(args);

startDevServer({
  entry: options.entry,
  watch: options.watch,
  projectRoot: options.root,
  buildCmd: options.build,
  lintCmd: options.lint,
});

function parseArgs(argv: string[]) {
  const parsed: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.replace(/^--/, "");
      const value = argv[i + 1];
      parsed[key] = value;
      i += 1;
    }
  }
  if (!parsed.entry) {
    parsed.entry = path.join("dist", "examples", "server", "src", "main.js");
  }
  return {
    entry: parsed.entry,
    watch: parsed.watch ?? "examples/server/src",
    root: parsed.root,
    build: parsed.build,
    lint: parsed.lint,
  };
}
