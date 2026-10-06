import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LocalSessionCounter } from "./LocalSessionCounter";
import chatSource from "./Chat.tsx?raw";
import inputSource from "./ChatInput.tsx?raw";
// @ts-expect-error -- node types are intentionally outside the web tsconfig
const nodeModule = (await import("node:module")) as unknown as {
  createRequire: (url: string) => (id: string) => { readFileSync: (path: string, encoding: string) => string };
};
const counterCss = nodeModule.createRequire(import.meta.url)("node:fs").readFileSync("src/renderer/src/screens/Chat/LocalSessionCounter.css", "utf8");

describe("local session counter", () => {
  it("shows refresh beside DB count and disables it during streaming", async () => {
    Object.assign(window, { hermesAPI: { listSessions: vi.fn().mockResolvedValue([]), getConnectionConfig: vi.fn().mockResolvedValue({ mode: "local" }) } });
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const view = render(<LocalSessionCounter sessionId="a" isLoading={true} onRefresh={onRefresh} />);
    const button = screen.getByRole("button", { name: "Refresh session" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<LocalSessionCounter sessionId="a" isLoading={false} onRefresh={onRefresh} />);
    expect((button as HTMLButtonElement).disabled).toBe(false);
    button.click();
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await screen.findByText("DB · unavailable");
  });
  it("anchors DB metadata top-right and keeps model actions in the composer", () => {
    expect(chatSource.length).toBeGreaterThan(1000);
    // Whitespace-tolerant: the two props are on separate lines after
    // formatting, and asserting the exact run also broke the guard whenever
    // prettier reflowed it. What matters is that BOTH are wired to Chat's own
    // state/handler, not that they sit on one line.
    expect(chatSource).toMatch(/refreshing=\{refreshing\}[\s\S]{0,80}?onRefresh=\{refreshSession\}/);
    expect(counterCss).toContain("position: absolute;");
    expect(counterCss).toContain("top: 12px;");
    expect(counterCss).toContain("right: 18px;");
    expect(inputSource).not.toContain("chat-context-float-row");
    expect(inputSource.indexOf("<ContextGauge")).toBeGreaterThan(inputSource.indexOf('className="chat-input-toolbar"'));
    expect(inputSource).toContain("onCompact={onCompactContext}");
    expect(inputSource).toContain("onNewSessionWithContext={onNewSessionWithContext}");
  });
  it("reads persisted metadata beyond the first page, never model tokens", async () => {
    const listSessions = vi.fn().mockResolvedValueOnce(Array.from({ length: 200 }, (_, i) => ({ id: `other-${i}`, messageCount: 1 }))).mockResolvedValueOnce([{ id: "target", messageCount: 12345 }]);
    Object.assign(window, { hermesAPI: { listSessions, getConnectionConfig: vi.fn().mockResolvedValue({ mode: "local" }) } });
    render(<LocalSessionCounter sessionId="target" isLoading={false} />);
    expect(await screen.findByText("DB · 12,345 messages")).toBeTruthy();
    expect(listSessions).toHaveBeenNthCalledWith(2, 200, 200);
    expect(screen.queryByText(/%/)).toBeNull();
  });
  it("clears stale counts on session switch and refreshes after a turn", async () => {
    const listSessions = vi.fn().mockResolvedValue([{ id: "a", messageCount: 4 }]);
    Object.assign(window, { hermesAPI: { listSessions, getConnectionConfig: vi.fn().mockResolvedValue({ mode: "local" }) } });
    const view = render(<LocalSessionCounter sessionId="a" isLoading={true} />);
    await screen.findByText("DB · 4 messages");
    listSessions.mockResolvedValue([{ id: "a", messageCount: 9 }]);
    view.rerender(<LocalSessionCounter sessionId="a" isLoading={false} />);
    await screen.findByText("DB · 9 messages");
    view.rerender(<LocalSessionCounter sessionId="missing" isLoading={false} />);
    expect(screen.queryByText("DB · 9 messages")).toBeNull();
    await screen.findByText("DB · unavailable");
  });
  it("does not label a remote session as local", async () => {
    const listSessions = vi.fn();
    Object.assign(window, { hermesAPI: { listSessions, getConnectionConfig: vi.fn().mockResolvedValue({ mode: "remote" }) } });
    render(<LocalSessionCounter sessionId="remote" isLoading={false} />);
    await screen.findByText("DB · unavailable");
    expect(listSessions).not.toHaveBeenCalled();
  });
  it("handles failed metadata reads without inventing zero", async () => {
    Object.assign(window, { hermesAPI: { listSessions: vi.fn().mockRejectedValue(new Error("offline")), getConnectionConfig: vi.fn().mockResolvedValue({ mode: "local" }) } });
    render(<LocalSessionCounter sessionId="a" isLoading={false} />);
    await waitFor(() => expect(screen.getByText("DB · unavailable")).toBeTruthy());
  });
});
