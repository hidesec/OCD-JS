import { Worker } from "node:worker_threads";
import { join } from "node:path";

interface OffloadOptions {
  worker?: string;
  timeoutMs?: number;
}

export const Offload = (options: OffloadOptions = {}): MethodDecorator => {
  return (_target, _propertyKey, descriptor?: TypedPropertyDescriptor<any>) => {
    if (!descriptor?.value) {
      return descriptor;
    }
    const original = descriptor.value;
    descriptor.value = async function (...args: unknown[]) {
      const payload = {
        module: options.worker ?? defaultWorkerPath(),
        method: original.name,
        args,
      };
      return new Promise((resolve, reject) => {
        const worker = new Worker(payload.module, {
          workerData: {
            method: payload.method,
            args: payload.args,
            context: serializeObject(this),
          },
        });
        const timer = options.timeoutMs
          ? setTimeout(() => worker.terminate(), options.timeoutMs)
          : undefined;
        worker.once("message", (message) => {
          timer && clearTimeout(timer);
          resolve(message);
        });
        worker.once("error", (error) => {
          timer && clearTimeout(timer);
          reject(error);
        });
      });
    };
    return descriptor;
  };
};

const defaultWorkerPath = () => join(__dirname, "worker-runner.js");

const serializeObject = (value: unknown) => {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return undefined;
  }
};
