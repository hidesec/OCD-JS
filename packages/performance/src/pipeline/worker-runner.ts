import { parentPort, workerData } from "node:worker_threads";

(async () => {
  if (!parentPort) {
    throw new Error("Worker requires parentPort");
  }
  const { method, args } = workerData as { method: string; args: unknown[] };
  try {
    const target = globalThis as unknown as Record<
      string,
      (...args: unknown[]) => unknown
    >;
    if (typeof target[method] !== "function") {
      throw new Error(`Worker method ${method} not found in global scope`);
    }
    const result = await Promise.resolve(target[method](...args));
    parentPort.postMessage(result);
  } catch (error) {
    parentPort.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
})();
