// @vitest-environment node

import { createServer, Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { queryEverything } from "./everything-search";

describe("queryEverything", () => {
  let mockServer: Server;
  const mockPort = 18080;

  beforeAll(async () => {
    mockServer = createServer((req, res) => {
      const decodedUrl = decodeURIComponent(req.url || "");
      if (decodedUrl.includes("MainActivity")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            results: [
              {
                name: "MainActivity.kt",
                path: "C:\\Projects\\App\\src\\main",
                type: "file",
              },
            ],
          }),
        );
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => mockServer.listen(mockPort, "127.0.0.1", resolve));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  });

  it("returns parsed search results when Everything server responds", async () => {
    const results = await queryEverything("MainActivity", "C:/Projects/App", {
      port: mockPort,
      timeoutMs: 1000,
    });
    expect(results).not.toBeNull();
    expect(results).toHaveLength(1);
    expect(results![0].name).toBe("src/main/MainActivity.kt");
  });

  it("returns null when connection fails or times out", async () => {
    const results = await queryEverything("MainActivity", undefined, {
      port: 19999, // unopened port
      timeoutMs: 100,
    });
    expect(results).toBeNull();
  });
});
