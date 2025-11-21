import { Readable } from "node:stream";
import { join } from "node:path";
import * as http2 from "node:http2";
import WebSocket from "ws";
import {
  AsyncPipeline,
  CacheManager,
  Cached,
  FastSerializer,
  Http2Transport,
  Offload,
  StreamingBodyParser,
  WebSocketTransport,
} from "@ocd-js/performance";
import { VariantSummary, calculateSignalVariants } from "./heavy-math";

const workerScript = join(__dirname, "workers", "heavy-worker.js");

interface UserReport {
  userId: string;
  segment: string;
  computedAt: string;
  tags: string[];
  hits: number;
}

class ReportService {
  public readonly cacheManager = new CacheManager();
  private hitCounter = 0;

  @Cached({
    key: (...args: unknown[]) => `report:${String(args[0] ?? "unknown")}`,
    ttlMs: 1500,
    tags: (report: unknown) => (report as UserReport)?.tags ?? [],
  })
  async getUserReport(userId: string): Promise<UserReport> {
    this.hitCounter += 1;
    await wait(35);
    const segment = userId.includes("vip") ? "vip" : "standard";
    return {
      userId,
      segment,
      computedAt: new Date().toISOString(),
      tags: [`segment:${segment}`],
      hits: this.hitCounter,
    } satisfies UserReport;
  }
}

class HeavyComputationService {
  @Offload({ worker: workerScript, timeoutMs: 4000 })
  async calculateVariants(seed: number): Promise<VariantSummary[]> {
    return calculateSignalVariants(seed);
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runPipelineShowcase() {
  const pipeline = new AsyncPipeline()
    .use(new StreamingBodyParser(64 * 1024))
    .use({
      name: "NormalizePayload",
      async execute(body) {
        if (body.type !== "json") {
          throw new Error("JSON payload required");
        }
        return {
          action: body.data,
        };
      },
    })
    .use(new FastSerializer(2));

  const stream = Readable.from([
    JSON.stringify({
      type: "ingest",
      payload: { kind: "metrics", samples: [1, 2, 3] },
    }),
  ]);

  const serialized = (await pipeline.run(stream, {
    requestId: "req-1",
    headers: { "x-demo": "pipeline" },
  })) as Buffer;

  console.log("pipeline serialized output", serialized.toString());
}

async function runCacheShowcase() {
  const service = new ReportService();
  const first = await service.getUserReport("42");
  const second = await service.getUserReport("42");
  const vipFirst = await service.getUserReport("42vip");
  await service.cacheManager.invalidate(["segment:vip"]);
  const vipAfterInvalidate = await service.getUserReport("42vip");

  console.log("cache reuse hits", {
    firstHits: first.hits,
    secondHits: second.hits,
    vipBefore: vipFirst.hits,
    vipAfterInvalidate: vipAfterInvalidate.hits,
  });
}

async function runOffloadShowcase() {
  const service = new HeavyComputationService();
  const variants = await service.calculateVariants(9);
  console.log(
    "worker computed variants",
    variants.map((variant) => ({ id: variant.id, checksum: variant.checksum })),
  );
}

async function runTransportShowcase() {
  const http2Port = 29890;
  const http2Transport = new Http2Transport((stream, headers) => {
    stream.respond({
      ":status": 200,
      "content-type": "application/json",
    });
    stream.end(
      JSON.stringify({ path: headers[":path"], ack: headers["x-demo"] }),
    );
  });
  http2Transport.start({ port: http2Port, host: "127.0.0.1" });
  const http2Payload = await new Promise<string>((resolve, reject) => {
    const client = http2.connect(`http://127.0.0.1:${http2Port}`);
    client.on("error", reject);
    const request = client.request({
      ":path": "/perf-demo",
      "x-demo": "transport",
    });
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      client.close();
      resolve(body);
    });
    request.end();
  });
  http2Transport.stop();

  const wsPort = 29891;
  const receivedMessages: string[] = [];
  const wsTransport = new WebSocketTransport((socket, data) => {
    const text = data.toString().toUpperCase();
    receivedMessages.push(text);
    socket.send(text);
  });
  wsTransport.start({ port: wsPort, host: "127.0.0.1" });
  await wait(25);
  const echo = await new Promise<string>((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${wsPort}`);
    socket.on("error", reject);
    socket.on("open", () => socket.send("ping"));
    socket.on("message", (message) => {
      socket.close();
      resolve(message.toString());
    });
  });
  wsTransport.stop();

  console.log("transport roundtrip", { http2Payload, receivedMessages, echo });
}

async function bootstrap() {
  console.log("=== @ocd-js/performance showcase ===");
  await runPipelineShowcase();
  await runCacheShowcase();
  await runOffloadShowcase();
  await runTransportShowcase();
}

bootstrap().catch((error) => {
  console.error("Performance showcase failed", error);
  process.exit(1);
});
