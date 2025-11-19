import { Readable } from "node:stream";

export interface PipelineContext {
  requestId: string;
  headers: Record<string, string>;
}

export interface ParsedBody {
  type: "json" | "buffer" | "text";
  data: unknown;
}

export interface PipelineStage<I = any, O = any> {
  name: string;
  execute(input: I, context: PipelineContext): Promise<O> | O;
}

export class AsyncPipeline {
  private readonly stages: PipelineStage[] = [];

  use(stage: PipelineStage): this {
    this.stages.push(stage);
    return this;
  }

  async run(input: unknown, context: PipelineContext): Promise<unknown> {
    let current: unknown = input;
    for (const stage of this.stages) {
      current = await stage.execute(current, context);
    }
    return current;
  }
}

export class StreamingBodyParser
  implements PipelineStage<Readable, ParsedBody>
{
  readonly name = "StreamingBodyParser";
  constructor(private readonly maxSizeBytes = 10 * 1024 * 1024) {}

  async execute(stream: Readable): Promise<ParsedBody> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > this.maxSizeBytes) {
        throw new Error("Payload too large");
      }
      chunks.push(buffer);
    }
    const payload = Buffer.concat(chunks);
    const text = payload.toString("utf8");
    if (looksLikeJson(text)) {
      return { type: "json", data: JSON.parse(text) };
    }
    if (isText(text)) {
      return { type: "text", data: text };
    }
    return { type: "buffer", data: payload };
  }
}

export class FastSerializer implements PipelineStage<unknown, Buffer> {
  readonly name = "FastSerializer";
  constructor(private readonly indent?: number) {}

  execute(value: unknown): Buffer {
    if (Buffer.isBuffer(value)) {
      return value;
    }
    if (typeof value === "string") {
      return Buffer.from(value);
    }
    return Buffer.from(JSON.stringify(value, null, this.indent));
  }
}

const looksLikeJson = (text: string) => /^\s*[\[{]/.test(text);
const isText = (text: string) => /^[\x09\x0A\x0D\x20-\x7E]*$/.test(text);
