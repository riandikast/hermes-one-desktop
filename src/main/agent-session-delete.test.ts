import { describe, expect, it, vi } from "vitest";
import { deleteSessionThroughAgent, type AgentRequest } from "./agent-session-delete";

function agent(responses: Record<string, unknown>): { request: AgentRequest; calls: string[] } {
  const calls: string[] = [];
  const request: AgentRequest = vi.fn(async (path, method) => {
    calls.push(`${method} ${path}`);
    const key = Object.keys(responses).find((k) => `${method} ${path}`.startsWith(k));
    const value = key ? responses[key] : undefined;
    if (value instanceof Error) throw value;
    return value;
  });
  return { request, calls };
}

describe("deleteSessionThroughAgent", () => {
  it("sends the fenced identity read from the mutation snapshot", async () => {
    const { request, calls } = agent({
      "GET /api/sessions/s%201/mutation-snapshot": { exists: true, runtime_revision: 7, runtime_generation: 3 },
      "DELETE": { ok: true, deleted_ids: ["s 1"] },
    });
    await deleteSessionThroughAgent(request, "s 1");
    expect(calls[0]).toBe("GET /api/sessions/s%201/mutation-snapshot");
    const url = new URL(calls[1].replace("DELETE ", ""), "http://x");
    expect(url.pathname).toBe("/api/sessions/s%201");
    expect(url.searchParams.get("expected_revision")).toBe("7");
    expect(url.searchParams.get("expected_generation")).toBe("3");
    expect(url.searchParams.get("request_id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("omits the generation when the session has none", async () => {
    const { request, calls } = agent({
      "GET": { exists: true, runtime_revision: 0, runtime_generation: null },
      "DELETE": { ok: true },
    });
    await deleteSessionThroughAgent(request, "a");
    expect(calls[1]).not.toContain("expected_generation");
    expect(calls[1]).toContain("expected_revision=0");
  });

  it("treats an absent session as already deleted", async () => {
    const { request, calls } = agent({ "GET": { exists: false, runtime_revision: 0, runtime_generation: null } });
    await deleteSessionThroughAgent(request, "gone");
    expect(calls).toEqual(["GET /api/sessions/gone/mutation-snapshot"]);
  });

  it("takes the plain delete on an agent without the snapshot route", async () => {
    const { request, calls } = agent({
      "GET": new Error('404: {"detail":"Not Found"}'),
      "DELETE": { ok: true },
    });
    await deleteSessionThroughAgent(request, "a");
    expect(calls[1]).toBe("DELETE /api/sessions/a");
  });

  it("propagates refusals instead of falling back", async () => {
    const busy = agent({
      "GET": { exists: true, runtime_revision: 1, runtime_generation: null },
      "DELETE": new Error('409: {"detail":"session_busy"}'),
    });
    await expect(deleteSessionThroughAgent(busy.request, "a")).rejects.toThrow("session_busy");
    const sessionMissing = agent({ "GET": new Error('404: {"detail":"not_found"}') });
    await expect(deleteSessionThroughAgent(sessionMissing.request, "a")).rejects.toThrow("not_found");
    expect(sessionMissing.calls).toHaveLength(1);
  });
});
