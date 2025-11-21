import { parentPort, workerData } from "node:worker_threads";
import { calculateSignalVariants } from "../heavy-math";

type WorkerHandlers = {
  calculateVariants: (seed: number) => Promise<unknown> | unknown;
};

const handlers: WorkerHandlers = {
  async calculateVariants(seed) {
    return calculateSignalVariants(seed);
  },
};

const run = async () => {
  if (!parentPort) {
    throw new Error("Worker requires parent communication channel");
  }
  const { method, args } = workerData as {
    method: keyof WorkerHandlers;
    args: unknown[];
  };
  const handler = handlers[method];
  if (!handler) {
    throw new Error(`Unhandled worker method: ${String(method)}`);
  }
  try {
    const result = await handler(...(args as [number]));
    parentPort.postMessage(result);
  } catch (error) {
    parentPort.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

void run();
