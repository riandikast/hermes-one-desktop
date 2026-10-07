import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import source from "../Chat.tsx?raw";

/**
 * Opening a session (left sidebar) must run the SAME DB refresh the refresh
 * button runs, once.
 *
 * Session open is deliberately cheap: `getSessionMessagesBefore` reads only the
 * newest page, and the startup-preload fast path reads nothing. So a freshly
 * opened transcript could be stale until the user pressed the DB button. These
 * tests pin the wiring: Chat must call `refreshSession` when a session opens,
 * ONCE per session — not on every render or every streamed chunk.
 */

vi.mock("react-hot-toast", () => ({ default: { error: vi.fn() } }));

describe("auto DB refresh on session open", () => {
  it("fires once per session id, and again for a different session", async () => {
    // Mirror of Chat's guard: a ref of the last auto-refreshed session plus an
    // isLoading bail-out. Kept in the test because the real Chat cannot be
    // rendered without its whole provider tree.
    const refresh = vi.fn().mockResolvedValue(undefined);

    const { rerender } = renderHook(
      ({ id, loading }: { id: string | null; loading: boolean }) => {
        const [autoRefreshed] = useState({ current: null as string | null });
        // The effect body as Chat writes it.
        if (
          id &&
          autoRefreshed.current !== id &&
          !loading
        ) {
          autoRefreshed.current = id;
          void refresh();
        }
        return null;
      },
      { initialProps: { id: "session-a", loading: false } },
    );

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

    // Re-render with the SAME session (a streamed chunk / messages change)
    // must not re-fire.
    rerender({ id: "session-a", loading: false });
    rerender({ id: "session-a", loading: false });
    expect(refresh).toHaveBeenCalledTimes(1);

    // A different session gets its own refresh.
    rerender({ id: "session-b", loading: false });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
  });

  it("does not refresh while a turn is loading", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      ({ id, loading }: { id: string | null; loading: boolean }) => {
        const [autoRefreshed] = useState({ current: null as string | null });
        if (id && autoRefreshed.current !== id && !loading) {
          autoRefreshed.current = id;
          void refresh();
        }
        return null;
      },
      { initialProps: { id: "session-a", loading: true } },
    );

    // Nothing while loading...
    await act(async () => undefined);
    expect(refresh).not.toHaveBeenCalled();

    // ...and once the turn settles, the open still refreshes.
    rerender({ id: "session-a", loading: false });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("never refreshes without a session id", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    renderHook(() => {
      const [autoRefreshed] = useState({ current: null as string | null });
      const id: string | null = null;
      if (id && autoRefreshed.current !== id) {
        autoRefreshed.current = id;
        void refresh();
      }
      return null;
    });
    await act(async () => undefined);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("Chat wires the auto-refresh to session open", () => {
  it("calls refreshSession from an effect keyed on hermesSessionId", () => {
    // Source guard: the once-per-session ref, the loading bail-out, and the
    // call must all be present, keyed on the session id.
    expect(source).toContain("autoRefreshedSessionRef");
    expect(source).toMatch(
      /autoRefreshedSessionRef\.current === hermesSessionId\)\s*return/,
    );
    expect(source).toMatch(/void refreshSession\(\)/);
    expect(source).toMatch(
      /\[hermesSessionId, isLoading, loadingEarlier, refreshSession\]/,
    );
    // And it uses the button's own refresh, not a second implementation.
    expect(source).toContain("const { refreshing, refresh: refreshSession } =");
  });
});
