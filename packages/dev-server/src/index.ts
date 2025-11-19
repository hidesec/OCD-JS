import chokidar from "chokidar";
import { spawn } from "node:child_process";
import path from "node:path";

export interface DevServerOptions {
  projectRoot?: string;
  entry: string;
  watch?: string | string[];
  buildCmd?: string;
  lintCmd?: string;
  env?: Record<string, string>;
}

interface Runner {
  stop(): Promise<void>;
}

export const startDevServer = (options: DevServerOptions): void => {
  const root = options.projectRoot ?? process.cwd();
  const watchPatterns = Array.isArray(options.watch)
    ? options.watch
    : options.watch
      ? [options.watch]
      : ["src"];

  let restarting = false;
  let changeQueued = false;
  let serverProcess: Runner | null = null;

  const runPipeline = async () => {
    if (restarting) {
      changeQueued = true;
      return;
    }
    restarting = true;
    try {
      await runCommand(options.buildCmd ?? "npm run build", root, options.env);
      await runCommand(options.lintCmd ?? "npm run lint", root, options.env);
      await restartServer();
    } finally {
      restarting = false;
      if (changeQueued) {
        changeQueued = false;
        runPipeline();
      }
    }
  };

  const restartServer = async () => {
    if (serverProcess) {
      await serverProcess.stop();
    }
    serverProcess = spawnNode(
      path.resolve(root, options.entry),
      root,
      options.env,
    );
  };

  chokidar
    .watch(watchPatterns, { cwd: root, ignoreInitial: true })
    .on("all", () => runPipeline());

  runPipeline();
};

const runCommand = (
  command: string,
  cwd: string,
  env?: Record<string, string>,
) =>
  new Promise<void>((resolve, reject) => {
    const [cmd, ...args] = command.split(" ");
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });

const spawnNode = (
  entry: string,
  cwd: string,
  env?: Record<string, string>,
): Runner => {
  const child = spawn("node", ["--inspect=9230", entry], {
    cwd,
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  return {
    stop: () =>
      new Promise((resolve) => {
        child.once("close", () => resolve());
        child.kill();
      }),
  };
};
