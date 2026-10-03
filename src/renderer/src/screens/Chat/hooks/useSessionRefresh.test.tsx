import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import toast from "react-hot-toast";
import { useSessionRefresh } from "./useSessionRefresh";
import type { ChatMessage } from "../types";
vi.mock("react-hot-toast", () => ({ default: { error: vi.fn() } }));
const initial: ChatMessage[] = [{ id: "local", role: "user", content: "draft transcript" }];
function mount(read: ReturnType<typeof vi.fn>) {
  Object.assign(window, { hermesAPI: { getSessionMessages: read } });
  return renderHook(({ id, loading }) => {
    const [messages, setMessages] = useState(initial);
    return { ...useSessionRefresh(id, loading, messages, setMessages), messages };
  }, { initialProps: { id: "session-a", loading: false } });
}
describe("manual history refresh", () => {
  it("reads current identity, reloads persisted rows without resetting local state", async () => {
    const read = vi.fn().mockResolvedValue([{ id: 1, kind: "user", content: "persisted" }]);
    const { result } = mount(read);
    await act(async () => { await result.current.refresh(); });
    expect(read).toHaveBeenCalledExactlyOnceWith("session-a");
    expect(result.current.messages.some((m) => "content" in m && m.content === "persisted")).toBe(true);
    expect(result.current.refreshing).toBe(false);
  });
  it("ignores duplicate requests and stale identity responses", async () => {
    let resolve!: (items: unknown[]) => void;
    const read = vi.fn(() => new Promise((done) => { resolve = done; }));
    const { result, rerender } = mount(read);
    act(() => { void result.current.refresh(); void result.current.refresh(); });
    expect(result.current.refreshing).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
    rerender({ id: "session-b", loading: false });
    await act(async () => resolve([{ id: 1, kind: "user", content: "wrong session" }]));
    expect(result.current.messages).toBe(initial);
  });
  it("never reads during streaming; discards a response when streaming starts", async () => {
    let resolve!: (items: unknown[]) => void;
    const read = vi.fn(() => new Promise((done) => { resolve = done; }));
    const { result, rerender } = mount(read);
    rerender({ id: "session-a", loading: true });
    await act(async () => result.current.refresh());
    expect(read).not.toHaveBeenCalled();
    rerender({ id: "session-a", loading: false });
    act(() => { void result.current.refresh(); });
    rerender({ id: "session-a", loading: true });
    await act(async () => resolve([]));
    expect(result.current.messages).toBe(initial);
  });
  it("keeps messages and unlocks retry after failure", async () => {
    const read = vi.fn().mockRejectedValue(new Error("offline"));
    const { result } = mount(read);
    await act(async () => result.current.refresh());
    expect(result.current.messages).toBe(initial);
    expect(toast.error).toHaveBeenCalled();
    await waitFor(() => expect(result.current.refreshing).toBe(false));
  });
});
