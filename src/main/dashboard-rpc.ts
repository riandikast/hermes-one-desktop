import WebSocket from "ws";
import { getDashboardConnection, startDashboard } from "./dashboard";

/**
 * One-shot JSON-RPC call against the Hermes gateway WebSocket.
 *
 * Capabilities screens need profile-scoped RPCs (`plugins.manage`) that the
 * dashboard exposes only over its socket — the HTTP surface has no `/rpc`
 * endpoint. Opening a short-lived socket per call keeps that plumbing out of
 * the renderer, which has no gateway client outside the chat transport.
 */
export interface RpcConnection {
  baseUrl: string;
  token: string;
}

function toWsUrl(baseUrl: string, token: string): string {
  const url = new URL("/api/ws", baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", token);
  return url.toString();
}

/** Local managed dashboard, else whatever remote/SSH target the config names. */
export async function resolveRpcConnection(profile?: string): Promise<RpcConnection> {
  const existing = getDashboardConnection(profile);
  if (existing) return existing;
  const status = await startDashboard(profile);
  if (!status.running || !status.connection) {
    throw new Error(status.error || "Hermes dashboard could not be started.");
  }
  return { baseUrl: status.connection.baseUrl, token: status.connection.token };
}

interface RpcFrame {
  id?: unknown;
  result?: unknown;
  error?: { message?: string; code?: number };
}

export async function dashboardRpc<T>(
  method: string,
  params: Record<string, unknown> = {},
  profile?: string,
  timeoutMs = 30_000,
): Promise<T> {
  const connection = await resolveRpcConnection(profile);
  return requestOverSocket<T>(toWsUrl(connection.baseUrl, connection.token), method, params, timeoutMs);
}

/** The transport half, separated so it can be exercised against a local socket. */
export function requestOverSocket<T>(
  url: string,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const socket = new WebSocket(url);
    const id = 1;
    let settled = false;
    const finish = (error: Error | null, value?: T): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // The socket may already be closing; nothing to clean up.
      }
      if (error) reject(error);
      else resolve(value as T);
    };
    const timer = setTimeout(() => {
      finish(new Error(`Hermes dashboard request timed out: ${method}`));
    }, timeoutMs);
    timer.unref?.();

    socket.on("open", () => {
      socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
    socket.on("message", (data) => {
      let frame: RpcFrame;
      try {
        frame = JSON.parse(data.toString()) as RpcFrame;
      } catch {
        return;
      }
      if (frame.id !== id) return;
      if (frame.error) {
        finish(new Error(frame.error.message || `Hermes dashboard request failed: ${method}`));
        return;
      }
      finish(null, frame.result as T);
    });
    socket.on("error", (error) => {
      finish(error instanceof Error ? error : new Error(String(error)));
    });
    socket.on("close", () => {
      finish(new Error(`Hermes dashboard WebSocket closed during ${method}`));
    });
  });
}
