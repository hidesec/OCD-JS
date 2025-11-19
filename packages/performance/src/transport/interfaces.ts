export interface TransportServer {
  start(context?: TransportContext): Promise<void> | void;
  stop(): Promise<void> | void;
}

export interface TransportContext {
  port: number;
  host?: string;
}

export type TransportType = "http2" | "ws" | "grpc";
