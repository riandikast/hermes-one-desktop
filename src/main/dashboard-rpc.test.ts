import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket, { WebSocketServer } from "ws";

// The transport half needs no dashboard: stub the resolver's module so the
// test never pulls electron into the node environment.
vi.mock("./dashboard", () => ({
  getDashboardConnection: vi.fn(() => null),
  startDashboard: vi.fn(),
}));

import { requestOverSocket } from "./dashboard-rpc";

const servers: WebSocketServer[] = [];

function serve(handler: (socket: WebSocket, frame: Record<string, unknown>) => void): Promise<string> {
  return new Promise((resolve) => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    servers.push(server);
    server.on("connection", (socket) => {
      socket.on("message", (data) => {
        try {
          handler(socket, JSON.parse(data.toString()) as Record<string, unknown>);
        } catch {
          // Malformed frames are the test's problem, not the transport's.
        }
      });
    });
    server.on("listening", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve(`ws://127.0.0.1:${port}/api/ws?token=test`);
    });
  });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("dashboard RPC transport", () => {
  it("sends a JSON-RPC 2.0 frame and resolves the matching result", async () => {
    let seen: Record<string, unknown> | null = null;
    const url = await serve((socket, frame) => {
      seen = frame;
      socket.send(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: { ok: true, echo: frame.method } }));
    });

    const result = await requestOverSocket<{ ok: boolean; echo: string }>(
      url,
      "plugins.manage",
      { action: "list" },
      2_000,
    );

    expect(result).toEqual({ ok: true, echo: "plugins.manage" });
    expect(seen).toMatchObject({ jsonrpc: "2.0", method: "plugins.manage", params: { action: "list" } });
  });

  it("rejects with the gateway's error message", async () => {
    const url = await serve((socket, frame) => {
      socket.send(JSON.stringify({ jsonrpc: "2.0", id: frame.id, error: { code: 4004, message: "profile not found" } }));
    });

    await expect(requestOverSocket(url, "plugins.manage", {}, 2_000)).rejects.toThrow("profile not found");
  });

  it("times out instead of hanging on a silent gateway", async () => {
    const url = await serve(() => {
      // Deliberately never answers.
    });

    await expect(requestOverSocket(url, "plugins.manage", {}, 150)).rejects.toThrow(/timed out/);
  });

  it("ignores foreign response ids", async () => {
    const url = await serve((socket, frame) => {
      socket.send(JSON.stringify({ jsonrpc: "2.0", id: 999, result: { wrong: true } }));
      socket.send(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: { right: true } }));
    });

    await expect(requestOverSocket(url, "plugins.manage", {}, 2_000)).resolves.toEqual({ right: true });
  });
});
