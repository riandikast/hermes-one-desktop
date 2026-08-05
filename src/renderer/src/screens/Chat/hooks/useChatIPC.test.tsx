import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRef, useState } from "react";
import { useChatIPC } from "./useChatIPC";
import type { ActiveTurn, ChatMessage, UsageState } from "../types";

type Callback<T extends unknown[]> = (...args: T) => void;

interface ChatIpcCallbacks {
  sessionStarted?: Callback<[string, string]>;
  chunk?: Callback<[string, string]>;
  reasoning?: Callback<[string, string]>;
  done?: Callback<[string, string]>;
  error?: Callback<[string, string]>;
  toolProgress?: Callback<[string, string]>;
  toolEvent?: Callback<[string, unknown]>;
  usage?: Callback<[string, UsageState]>;
}

function installHermesApi(callbacks: ChatIpcCallbacks): {
  getSessionMessages: ReturnType<typeof vi.fn>;
} {
  const getSessionMessages = vi.fn(async (sessionId: string) => {
    if (sessionId === "old-session") {
      return [
        { kind: "user", id: 1, content: "old prompt" },
        { kind: "assistant", id: 2, content: "old answer" },
      ];
    }
    return [];
  });

  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      getSessionMessages,
      onChatSessionStarted: (cb: Callback<[string, string]>) => {
        callbacks.sessionStarted = cb;
        return vi.fn();
      },
      onChatChunk: (cb: Callback<[string, string]>) => {
        callbacks.chunk = cb;
        return vi.fn();
      },
      onChatReasoningChunk: (cb: Callback<[string, string]>) => {
        callbacks.reasoning = cb;
        return vi.fn();
      },
      onChatDone: (cb: Callback<[string, string]>) => {
        callbacks.done = cb;
        return vi.fn();
      },
      onChatError: (cb: Callback<[string, string]>) => {
        callbacks.error = cb;
        return vi.fn();
      },
      onChatToolProgress: (cb: Callback<[string, string]>) => {
        callbacks.toolProgress = cb;
        return vi.fn();
      },
      onChatToolEvent: (cb: Callback<[string, unknown]>) => {
        callbacks.toolEvent = cb;
        return vi.fn();
      },
      onClarifyRequest: vi.fn(() => vi.fn()),
      onChatUsage: (cb: Callback<[string, UsageState]>) => {
        callbacks.usage = cb;
        return vi.fn();
      },
    },
  });

  return { getSessionMessages };
}

function Harness({
  sessionScopeId,
  initialActiveTurn = null,
}: {
  sessionScopeId: string | null;
  initialActiveTurn?: ActiveTurn | null;
}): React.JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [, setHermesSessionId] = useState<string | null>(sessionScopeId);
  const [, setToolProgress] = useState<string | null>(null);
  const [, setIsLoading] = useState(false);
  const [, setUsage] = useState<UsageState | null>(null);
  const activeTurnRef = useRef<ActiveTurn | null>(initialActiveTurn);

  useChatIPC({
    runId: "run-1",
    sessionScopeId,
    setMessages,
    setHermesSessionId,
    setToolProgress,
    setIsLoading,
    setUsage,
    activeTurnRef,
  });

  return (
    <>
      <output data-testid="ids">
        {JSON.stringify(messages.map((message) => message.id))}
      </output>
      <output data-testid="snapshot">
        {JSON.stringify(
          messages.map((m) => {
            const kind = "kind" in m ? m.kind : undefined;
            const content = "content" in m ? m.content : undefined;
            const text = "text" in m ? m.text : undefined;
            return { id: m.id, role: m.role, kind, content, text };
          }),
        )}
      </output>
    </>
  );
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "hermesAPI");
});

describe("useChatIPC session scoping", () => {
  it("ignores late DB refreshes from an old session after the visible chat is cleared", async () => {
    const callbacks: ChatIpcCallbacks = {};
    const api = installHermesApi(callbacks);
    const view = render(<Harness sessionScopeId="old-session" />);

    view.rerender(<Harness sessionScopeId={null} />);

    await act(async () => {
      callbacks.done?.("run-1", "old-session");
    });

    expect(api.getSessionMessages).not.toHaveBeenCalled();
    expect(screen.getByTestId("ids")).toHaveTextContent("[]");
  });

  it("accepts DB refreshes for the visible session", async () => {
    const callbacks: ChatIpcCallbacks = {};
    const api = installHermesApi(callbacks);
    render(<Harness sessionScopeId="old-session" />);

    await act(async () => {
      callbacks.done?.("run-1", "old-session");
    });

    expect(api.getSessionMessages).toHaveBeenCalledWith("old-session");
    expect(screen.getByTestId("ids")).toHaveTextContent(
      JSON.stringify(["db-1", "db-2"]),
    );
  });
});

describe("useChatIPC interleaved streaming", () => {
  const activeTurn: ActiveTurn = {
    turnId: "t1",
    userId: "u1",
    startIndex: 0,
    status: "running",
  };

  it("keeps ONE answer bubble when thinking chunks interleave after tool events", async () => {
    const callbacks: ChatIpcCallbacks = {};
    installHermesApi(callbacks);
    render(
      <Harness
        sessionScopeId="s1"
        initialActiveTurn={activeTurn}
      />,
    );

    // DeepSeek-style stream: thinking chunks, the answer starts, a tool runs,
    // then MORE thinking + answer chunks interleave. Each tool event marks
    // the reasoning segment closed, so the next thinking chunk forces a new
    // segment row — a fresh answer bubble per chunk would remount the row and
    // replay its entry animation (a visible blink on every chunk).
    await act(async () => {
      callbacks.reasoning?.("run-1", "First thought");
      callbacks.chunk?.("run-1", "Start of answer");
      callbacks.toolProgress?.("run-1", "read_file");
      callbacks.reasoning?.("run-1", "Interleaved thought");
      callbacks.chunk?.("run-1", " more answer");
      callbacks.reasoning?.("run-1", " continued.");
      callbacks.chunk?.("run-1", " final.");
    });

    const snapshot = JSON.parse(
      screen.getByTestId("snapshot").textContent ?? "[]",
    ) as {
      id: string;
      role: string;
      kind?: string;
      content?: string;
      text?: string;
    }[];

    const bubbles = snapshot.filter(
      (m) => m.role === "agent" && !m.kind,
    );
    const reasoning = snapshot.filter((m) => m.kind === "reasoning");

    expect(bubbles).toHaveLength(1);
    expect(bubbles[0].content).toBe("Start of answer more answer final.");
    expect(reasoning).toHaveLength(2);
    expect(reasoning[0].text).toBe("First thought");
    expect(reasoning[1].text).toBe("Interleaved thought continued.");
  });
});
