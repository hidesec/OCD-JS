import WebSocket, { WebSocketServer } from "ws";
import { TransportServer, TransportContext } from "./interfaces";

export class WebSocketTransport implements TransportServer {
  private server?: WebSocketServer;

  constructor(
    private readonly onMessage: (
      socket: WebSocket,
      data: WebSocket.RawData,
    ) => void,
  ) {}

  start(context: TransportContext = { port: 8081 }): void {
    this.server = new WebSocketServer({
      port: context.port,
      host: context.host,
    });
    this.server.on("connection", (socket) => {
      socket.on("message", (data) => this.onMessage(socket as WebSocket, data));
    });
  }

  stop(): void {
    this.server?.close();
  }
}
