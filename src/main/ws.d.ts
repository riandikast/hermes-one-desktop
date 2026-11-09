declare module "ws" {
  import type { IncomingMessage } from "http";
  import type { Duplex } from "stream";

  export type RawData = Buffer | ArrayBuffer | Buffer[];

  export default class WebSocket {
    static readonly CONNECTING: number;
    static readonly OPEN: number;
    static readonly CLOSING: number;
    static readonly CLOSED: number;

    readonly readyState: number;

    constructor(address: string);

    close(code?: number, data?: string): void;
    on(event: "close", listener: (code: number, reason: Buffer) => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    on(
      event: "message",
      listener: (data: RawData, isBinary: boolean) => void,
    ): this;
    on(event: "open", listener: () => void): this;
    once(
      event: "close",
      listener: (code: number, reason: Buffer) => void,
    ): this;
    once(event: "error", listener: (error: Error) => void): this;
    once(event: "open", listener: () => void): this;
    removeAllListeners(): this;
    send(
      data: string | RawData,
      options?: { binary?: boolean },
      callback?: (error?: Error) => void,
    ): void;
    terminate(): void;
  }

  export class WebSocketServer {
    constructor(options: { noServer: true });
    // A bound listener (tests, local relays): the port is chosen by the OS.
    constructor(options: { host?: string; port?: number }, callback?: () => void);

    on(event: "listening", listener: () => void): this;
    on(
      event: "connection",
      listener: (socket: WebSocket, request: IncomingMessage) => void,
    ): this;
    address(): { port: number } | string | null;
    close(callback?: () => void): void;

    handleUpgrade(
      request: IncomingMessage,
      socket: Duplex,
      head: Buffer,
      callback: (socket: WebSocket, request: IncomingMessage) => void,
    ): void;
  }
}
