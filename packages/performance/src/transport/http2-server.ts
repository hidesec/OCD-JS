import * as http2 from "node:http2";
import { TransportServer, TransportContext } from "./interfaces";

export class Http2Transport implements TransportServer {
  private server?: http2.Http2Server;

  constructor(
    private readonly handler: (
      stream: http2.ServerHttp2Stream,
      headers: http2.IncomingHttpHeaders,
    ) => void,
  ) {}

  start(context: TransportContext = { port: 8080 }): void {
    this.server = http2.createServer();
    this.server.on("stream", (stream, headers) => {
      this.handler(stream, headers);
    });
    this.server.listen(context.port, context.host);
  }

  stop(): void {
    this.server?.close();
  }
}
