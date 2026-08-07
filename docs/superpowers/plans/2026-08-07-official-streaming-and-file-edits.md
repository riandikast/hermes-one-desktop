# Adopt Official Streaming + File-Edit Tracking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt the official Hermes desktop's stable streaming (live deltas replaced by one authoritative final at completion) and inline_diff-based file-edit tracking (per-edit +N/−M cards + per-turn "N files changed" row), keeping our chat chrome, watchdog, quiet-finalize, and git fallback.

**Architecture:** The backend our fork already spawns emits `payload.inline_diff` on `tool.complete` for file-edit tools (verified: `tui_gateway/server.py:5189-5233`). Streaming: flip `renderAssistantDeltas` to always-render, add `mergeFinalAssistantText` (official stability contract) to `dashboardEventAdapter.ts`, add `finalizeInterruptedMessages` on `session.info running:false`. File tracking: capture `inline_diff` per toolCallId, port the official diff parser/counter into `diffLines.ts`, render diffs in the existing tool rows and the per-turn row (replacing the chip's message kind), persist diffs via the existing `desktop_session_file_changes` JSON (no schema change). Delete the answer-gate machinery (`useReasoningGate`, `reasoningStall`, force-reveal). `lossyText` is KEPT — `mergeStreamedWithFinal` still needs `isLossyChunkCopy` for the last-turn-only (#746) branch of `mergeFinalAssistantText`.

**Tech Stack:** React 18 + TypeScript, vitest, Electron main (better-sqlite3), i18next.

---

## File Structure

**New files:**
- `src/renderer/src/screens/Chat/diffLines.ts` — official unified-diff parser/counter (parseHunks, parseDiff, countDiffLineStats, stripDiffChrome, filePathFromInlineDiff)
- `src/renderer/src/screens/Chat/diffLines.test.ts` — parser tests
- `src/main/session-continuation-store.test.ts` — diff-field persistence test

**Modified files:**
- `src/renderer/src/screens/Chat/dashboardEventAdapter.ts` — always stream deltas; `mergeFinalAssistantText`; `finalizeInterruptedMessages`; `session.info` case; remove `renderAssistantDeltas` option, reasoningStall import (lossyText import STAYS — used by the #746 merge branch)
- `src/renderer/src/screens/Chat/dashboardEventAdapter.test.ts` — update delta-path tests; new merge/settle tests
- `src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts` — inline_diff capture; diff persistence; N-files-changed row; remove force-reveal/`[gate-diag]`; `session.info` settle hook; keep watchdog/quiet-finalize
- `src/renderer/src/screens/Chat/types.ts` — `FileChange.diff?`; `ToolResultMessage.diff/added/removed?`
- `src/renderer/src/screens/Chat/MessageRow.tsx` — remove gate; tool-result diff card
- `src/renderer/src/screens/Chat/MessageList.tsx` — FileChangesRow counts with +A −B
- `src/renderer/src/screens/Chat/Chat.tsx` — remove forceReleaseAllReasoning
- `src/renderer/src/screens/Chat/FileChangesDialog.tsx` — render unified diff from `change.diff` first
- `src/renderer/src/assets/main.css` — diff card + chip styles
- `src/main/session-continuation-store.ts` — `StoredFileChange.diff?`; pass-through in persist/load
- `src/shared/session-continuation.ts` — (check) no change needed (JSON blob)

**Deleted files:**
- `src/renderer/src/screens/Chat/useReasoningGate.ts` + `useReasoningGate.test.tsx`
- `src/renderer/src/screens/Chat/reasoningStall.ts`
- `src/renderer/src/screens/Chat/ReasoningRow.test.tsx` (tests reasoningStall — delete; ReasoningRow component stays)

---

### Task 1: Unified-diff primitives (port from official)

**Files:**
- Create: `src/renderer/src/screens/Chat/diffLines.ts`
- Test: `src/renderer/src/screens/Chat/diffLines.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  countDiffLineStats,
  filePathFromInlineDiff,
  parseDiff,
  parseHunks,
  stripDiffChrome,
} from "./diffLines";

const SAMPLE_DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 123..456 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -10,5 +10,6 @@ export function run() {",
  "  const x = 1;",
  "-  return x;",
  "+  return x + 1;",
  "+  console.log(x);",
  " }",
  "",
].join("\n");

describe("diffLines — official unified-diff primitives", () => {
  it("counts +/− lines, excluding headers", () => {
    expect(countDiffLineStats(SAMPLE_DIFF)).toEqual({ added: 2, removed: 1 });
  });

  it("returns 0/0 for a diff with no hunks", () => {
    expect(countDiffLineStats("diff --git a/x b/x\nindex 1..2\n")).toEqual({
      added: 0,
      removed: 0,
    });
  });

  it("parses hunks with old/new ranges", () => {
    const hunks = parseHunks(SAMPLE_DIFF);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({ oldStart: 10, oldLines: 5, newStart: 10, newLines: 6 });
  });

  it("parses diff lines with kinds", () => {
    const lines = parseDiff(SAMPLE_DIFF);
    expect(lines.filter((l) => l.kind === "add")).toHaveLength(2);
    expect(lines.filter((l) => l.kind === "remove")).toHaveLength(1);
    expect(lines.filter((l) => l.kind === "context")).toHaveLength(2);
  });

  it("strips ANSI codes and the Hermes ┊ review diff marker", () => {
    const dirty = "\u001b[32m  ┊ review diff\u001b[0m\n\u001b[31m- old\u001b[0m\n+ new";
    expect(stripDiffChrome(dirty)).toBe("- old\n+ new");
  });

  it("extracts the file path from ---/+++ and the arrow form", () => {
    expect(filePathFromInlineDiff(SAMPLE_DIFF)).toBe("src/a.ts");
    const arrow = "a/src/a.ts → b/src/a.ts\n@@ -1 +1 @@\n-x\n+y";
    expect(filePathFromInlineDiff(arrow)).toBe("src/a.ts");
  });

  it("returns null path for a headerless diff", () => {
    expect(filePathFromInlineDiff("@@ -1 +1 @@\n-x\n+y")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/screens/Chat/diffLines.test.ts`
Expected: FAIL with "Failed to resolve import ./diffLines"

- [ ] **Step 3: Write minimal implementation**

Create `src/renderer/src/screens/Chat/diffLines.ts`:

```ts
/**
 * Unified-diff primitives ported from the official desktop's
 * `components/chat/diff-lines.tsx` (NousResearch/hermes-agent). The backend
 * ships file-edit diffs as an opaque unified-diff string on `tool.complete`
 * (`payload.inline_diff`), so the renderer only needs a parser + counters —
 * no before/after snapshots.
 */

export type DiffLineKind = "add" | "remove" | "context";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  newNo?: number;
  oldNo?: number;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  body: DiffLine[];
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Split a unified diff into `@@` hunks. Lines before the first hunk are
 *  dropped (file headers). */
export function parseHunks(diff: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldNo: number | undefined;
  let newNo: number | undefined;

  for (const raw of diff.split(/\r?\n/)) {
    const line = raw;
    const hunkMatch = HUNK_RE.exec(line);
    if (hunkMatch) {
      current = {
        oldStart: Number(hunkMatch[1]),
        oldLines: hunkMatch[2] ? Number(hunkMatch[2]) : 1,
        newStart: Number(hunkMatch[3]),
        newLines: hunkMatch[4] ? Number(hunkMatch[4]) : 1,
        body: [],
      };
      hunks.push(current);
      oldNo = current.oldStart;
      newNo = current.newStart;
      continue;
    }
    if (!current) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.body.push({ kind: "add", text: line.slice(1), newNo });
      newNo = newNo !== undefined ? newNo + 1 : undefined;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      current.body.push({ kind: "remove", text: line.slice(1), oldNo });
      oldNo = oldNo !== undefined ? oldNo + 1 : undefined;
    } else {
      current.body.push({ kind: "context", text: line.slice(1), oldNo, newNo });
      if (oldNo !== undefined) oldNo += 1;
      if (newNo !== undefined) newNo += 1;
    }
  }
  return hunks;
}

/** Flatten a diff into ordered lines (headers excluded). */
export function parseDiff(diff: string): DiffLine[] {
  return parseHunks(diff).flatMap((hunk) => hunk.body);
}

/** Count +/− content lines, excluding `+++`/`---` header lines. */
export function countDiffLineStats(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) removed += 1;
  }
  return { added, removed };
}

const ANSI_RE = /\u001b\[[0-9;]*m/g;

/** Strip ANSI color codes and the backend's leading `┊ review diff` marker
 *  line the inline diff can be prefixed with. */
export function stripDiffChrome(diff: string): string {
  const cleaned = diff.replace(ANSI_RE, "").trim();
  const lines = cleaned.split(/\r?\n/).filter((l) => !l.includes("┊ review diff"));
  return lines.join("\n");
}

/** Scrape the edited file path from `--- a/<p>` / `+++ b/<p>` headers or the
 *  Hermes arrow form `a/<p> → b/<p>`. Returns null when absent. */
export function filePathFromInlineDiff(diff: string): string | null {
  const stripped = stripDiffChrome(diff);
  const arrow = /a\/(.+?)\s*→\s*b\//.exec(stripped);
  if (arrow) return arrow[1].trim();
  const fromHeader = /^---\s+a\/(.+)$/m.exec(stripped);
  if (fromHeader) return fromHeader[1].trim();
  const toHeader = /^\+\+\+\s+b\/(.+)$/m.exec(stripped);
  if (toHeader) return toHeader[1].trim();
  return null;
}

/** True when the payload carries a usable file-edit diff (official
 *  `gatewayEventCompletedFileDiff` equivalent). */
export function inlineDiffFromPayload(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const raw = payload.inline_diff;
  if (typeof raw !== "string" || !raw.trim()) return null;
  return stripDiffChrome(raw);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/screens/Chat/diffLines.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/screens/Chat/diffLines.ts src/renderer/src/screens/Chat/diffLines.test.ts
git commit -m "feat(chat): unified-diff primitives ported from official desktop"
```

---

### Task 2: Adapter — always stream + final merge + interrupted settle

**Files:**
- Modify: `src/renderer/src/screens/Chat/dashboardEventAdapter.ts`
- Test: `src/renderer/src/screens/Chat/dashboardEventAdapter.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/renderer/src/screens/Chat/dashboardEventAdapter.test.ts`:

```ts
import {
  applyDashboardStreamEvent,
  finalizeInterruptedMessages,
  mergeFinalAssistantText,
} from "./dashboardEventAdapter";

describe("mergeFinalAssistantText — official stability contract", () => {
  const streamedBubble = (content: string, id = "a1"): ChatMessage => ({
    id,
    role: "agent",
    content,
    pending: true,
    turnId: "t1",
  });

  it("replaces every streamed text bubble with one authoritative final", () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "hi" },
      streamedBubble("The final "),
      streamedBubble("answer is here.", "a2"),
      { id: "r1", kind: "reasoning", role: "agent", text: "Let me think" },
    ];
    const out = mergeFinalAssistantText(messages, "The final answer is here.", "t1");
    const bubbles = out.filter((m) => m.role === "agent" && !("kind" in m));
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0].content).toBe("The final answer is here.");
    expect(bubbles[0].pending).toBe(false);
    expect(bubbles[0].turnId).toBe("t1");
  });

  it("drops reasoning fully covered by the final text", () => {
    const messages: ChatMessage[] = [
      streamedBubble("The final answer.", "a1"),
      { id: "r1", kind: "reasoning", role: "agent", text: "The final answer." },
      { id: "r2", kind: "reasoning", role: "agent", text: "Unrelated thought" },
    ];
    const out = mergeFinalAssistantText(messages, "The final answer.", "t1");
    const reasoning = out.filter((m) => "kind" in m && m.kind === "reasoning");
    expect(reasoning).toHaveLength(1);
    expect(reasoning[0].text).toBe("Unrelated thought");
  });

  it("appends a fresh final bubble when no streamed text exists", () => {
    const messages: ChatMessage[] = [
      { id: "r1", kind: "reasoning", role: "agent", text: "thought" },
    ];
    const out = mergeFinalAssistantText(messages, "Final", "t1");
    const bubbles = out.filter((m) => m.role === "agent" && !("kind" in m));
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0].content).toBe("Final");
  });

  it("leaves a final empty string untouched (no bubble appended)", () => {
    const messages: ChatMessage[] = [streamedBubble("streamed", "a1")];
    const out = mergeFinalAssistantText(messages, "", "t1");
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe("streamed");
    expect(out[0].pending).toBe(true);
  });
});

describe("finalizeInterruptedMessages — session.info running:false settle", () => {
  it("un-pends a stranded pending bubble, keeping its text", () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "hi" },
      { id: "a1", role: "agent", content: "Partial answer", pending: true, turnId: "t1" },
    ];
    const out = finalizeInterruptedMessages(messages);
    const bubble = out.find((m) => m.id === "a1");
    expect(bubble && (bubble as ChatBubbleMessage).pending).toBe(false);
  });

  it("drops an empty pending placeholder", () => {
    const messages: ChatMessage[] = [
      { id: "a1", role: "agent", content: "", pending: true },
    ];
    const out = finalizeInterruptedMessages(messages);
    expect(out).toHaveLength(0);
  });

  it("leaves completed bubbles untouched", () => {
    const messages: ChatMessage[] = [
      { id: "a1", role: "agent", content: "done", pending: false },
    ];
    const out = finalizeInterruptedMessages(messages);
    expect(out).toHaveLength(1);
  });
});

describe("applyDashboardStreamEvent — live delta rendering", () => {
  it("renders message.delta into the pending bubble (no suppression option)", () => {
    const state = {
      messages: [{ id: "u1", role: "user" as const, content: "hi" }],
      reasoningSegmentClosed: false,
    };
    const s1 = applyDashboardStreamEvent(state, {
      type: "message.delta",
      payload: { text: "Hello " },
    });
    const s2 = applyDashboardStreamEvent(s1, {
      type: "message.delta",
      payload: { text: "world" },
    });
    const bubbles = s2.messages.filter(
      (m) => m.role === "agent" && !("kind" in m),
    );
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0].content).toBe("Hello world");
    expect(bubbles[0].pending).toBe(true);
  });

  it("message.complete applies the final merge", () => {
    const state = {
      messages: [
        { id: "u1", role: "user" as const, content: "hi" },
        { id: "a1", role: "agent" as const, content: "Hel", pending: true, turnId: "t1" },
      ],
      reasoningSegmentClosed: false,
    };
    const out = applyDashboardStreamEvent(state, {
      type: "message.complete",
      payload: { text: "Hello world" },
    });
    const bubbles = out.messages.filter(
      (m) => m.role === "agent" && !("kind" in m),
    );
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0].content).toBe("Hello world");
    expect(bubbles[0].pending).toBe(false);
  });

  it("session.info running:false settles stranded pending bubbles", () => {
    const state = {
      messages: [
        { id: "a1", role: "agent" as const, content: "Partial", pending: true },
      ],
      reasoningSegmentClosed: false,
    };
    const out = applyDashboardStreamEvent(state, {
      type: "session.info",
      payload: { running: false },
    });
    const bubble = out.messages.find((m) => m.id === "a1");
    expect((bubble as ChatBubbleMessage).pending).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/src/screens/Chat/dashboardEventAdapter.test.ts`
Expected: FAIL — `mergeFinalAssistantText is not a function` (plus the delta test fails because `renderAssistantDeltas:false` behavior is still in place)

- [ ] **Step 3: Implement the adapter changes**

In `src/renderer/src/screens/Chat/dashboardEventAdapter.ts`:

1. Remove the import of `markReasoningSettled` from `./reasoningStall` (line 3) and replace `markReasoningSettled(...)` calls with nothing (the settle concept is gone; `reasoningSegmentClosed` state and its transitions remain as-is). KEEP the `isLossyChunkCopy` import from `./lossyText` (line 2) — `mergeFinalAssistantText` uses it via `mergeStreamedWithFinal` for the #746 branch.

2. Remove `renderAssistantDeltas?: boolean` from `ApplyDashboardEventOptions` and the `if (options.renderAssistantDeltas === false)` guard in the `message.delta` case (lines 721-727) — deltas always render.

3. Add `mergeFinalAssistantText` after `completeAssistantWithFinalText` (line 710):

```ts
/**
 * Official stability contract (merged from the upstream desktop's
 * `mergeFinalAssistantText`): EVERY streamed text bubble of the turn is
 * discarded and replaced by ONE authoritative final bubble. Reasoning rows
 * fully covered by the final text are dropped too; reasoning that adds
 * content survives. This is what makes the live stream stable — the final
 * text always wins, so dropped/garbled delta chunks can never corrupt the
 * answer.
 */
export function mergeFinalAssistantText(
  messages: ReadonlyArray<ChatMessage>,
  finalText: string,
  turnId?: string | null,
  now = Date.now(),
): ChatMessage[] {
  const final = finalText.trim();
  if (!final) return [...messages];

  const normFinal = normalizeText(final);
  const turnMatches = (msg: ChatMessage): boolean =>
    !turnId || !("turnId" in msg) || !msg.turnId || msg.turnId === turnId;

  const filtered = messages.filter((msg) => {
    // Keep everything before the turn boundary (user rows etc.).
    if (!turnMatches(msg)) return true;
    if (msg.role === "agent" && isAssistantBubble(msg)) {
      // All streamed text bubbles of this turn are removed.
      return false;
    }
    if ("kind" in msg && msg.kind === "reasoning" && turnMatches(msg)) {
      const reasoning = normalizeText(msg.text);
      if (reasoning && normFinal.startsWith(reasoning)) return false;
    }
    return true;
  });

  return [
    ...filtered,
    {
      id: `agent-dashboard-${now}-${messages.length}`,
      role: "agent",
      content: final,
      pending: false,
      ...(turnId ? { turnId } : {}),
    },
  ];
}

/**
 * Settle stranded pending bubbles when a turn ends without `message.complete`
 * (official `finalizeInterruptedMessages` equivalent — triggered by
 * `session.info running:false`). Empty placeholders are dropped; pending
 * bubbles that accumulated text are un-pended and kept.
 */
export function finalizeInterruptedMessages(
  messages: ReadonlyArray<ChatMessage>,
): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const msg of messages) {
    if (msg.role === "agent" && isAssistantBubble(msg) && msg.pending) {
      if (!(msg.content ?? "").trim()) continue; // drop empty placeholder
      out.push({ ...msg, pending: false });
      continue;
    }
    out.push(msg);
  }
  return out;
}
```

4. In the `message.complete` case (lines 786-832), replace the `completeAssistantWithFinalText` call with `mergeFinalAssistantText`:

```ts
    case "message.complete": {
      const finalText = textFromPayload(
        event.payload,
        "text",
        "rendered",
        "final_response",
        "output_text",
        "content",
      );
      const finalReasoning = thinkingTextFromPayload(
        event.payload,
        "reasoning",
        "thinking",
      );
      const messagesWithReasoning = addCompletionReasoningFallback(
        state.messages,
        finalText,
        finalReasoning,
        now,
      );
      return {
        messages: mergeFinalAssistantText(
          messagesWithReasoning,
          finalText,
          options.activeTurn?.turnId ?? null,
          now,
        ),
        reasoningSegmentClosed: false,
      };
    }
    case "session.info": {
      const payload = isRecord(event.payload) ? event.payload : {};
      if (payload.running === false) {
        return {
          messages: finalizeInterruptedMessages(state.messages),
          reasoningSegmentClosed: state.reasoningSegmentClosed,
        };
      }
      return state;
    }
```

Note: `completeAssistantWithFinalText`, `mergeStreamedWithFinal`, and `removeDuplicateReasoning` become unused — remove them (and `findLastUserIndex` if now unused). Keep `addCompletionReasoningFallback`, `hasReasoningSinceLastUser`, `isAssistantBubble`, `appendAssistantDelta`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/src/screens/Chat/dashboardEventAdapter.test.ts`
Expected: PASS (existing tests updated in Step 5 may still fail — fix those next)

- [ ] **Step 5: Update the existing tests**

In `dashboardEventAdapter.test.ts`:
- The tests titled "uses final when nothing was streamed (remote / suppressed-delta path)" and "falls back to final_response when deltas are suppressed (remote path)" no longer apply — replace them with a test asserting deltas ARE rendered (covered by the new "renders message.delta" test); delete the old two.
- Any test passing `renderAssistantDeltas: false` in options: remove the option (the interface no longer has it).

- [ ] **Step 6: Run full adapter test file + typecheck**

Run: `npx vitest run src/renderer/src/screens/Chat/dashboardEventAdapter.test.ts && npm run typecheck:web`
Expected: PASS; typecheck clean

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/screens/Chat/dashboardEventAdapter.ts src/renderer/src/screens/Chat/dashboardEventAdapter.test.ts
git commit -m "feat(chat): live delta streaming with official final-merge stability"
```

---

### Task 3: Delete the answer-gate machinery

**Files:**
- Delete: `src/renderer/src/screens/Chat/useReasoningGate.ts`, `useReasoningGate.test.tsx`, `reasoningStall.ts`, `ReasoningRow.test.tsx` (lossyText.ts is KEPT)
- Modify: `src/renderer/src/screens/Chat/Chat.tsx`, `MessageRow.tsx`

- [ ] **Step 1: Delete the files**

```bash
git rm src/renderer/src/screens/Chat/useReasoningGate.ts src/renderer/src/screens/Chat/useReasoningGate.test.tsx src/renderer/src/screens/Chat/reasoningStall.ts src/renderer/src/screens/Chat/ReasoningRow.test.tsx
```

- [ ] **Step 2: Remove gate usage in Chat.tsx**

In `src/renderer/src/screens/Chat/Chat.tsx`:
- Remove `import { forceReleaseAllReasoning } from "./reasoningStall";` (line 11)
- In the isLoading effect (lines 178-189), remove the `forceReleaseAllReasoning();` call and its comment — keep `playFinishChime()`:

```tsx
  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = isLoading;
    if (!wasLoading || isLoading) return;
    // Agent just finished — play a short notification chime (shared context).
    playFinishChime();
  }, [isLoading]);
```

- [ ] **Step 3: Remove gate usage in MessageRow.tsx**

In `src/renderer/src/screens/Chat/MessageRow.tsx`:
- Remove `import { useReasoningGate } from "./useReasoningGate";` (line 12)
- Remove the `const { waiting } = useReasoningGate({...})` block (lines 226-239) and the `waiting` prop usage on the bubble. Find where `waiting` is consumed (e.g. `waiting ? ... : ...` on the message wrapper) and delete that conditional, always rendering the bubble.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck:web`
Expected: no errors (if something else imported the deleted modules, fix it)

- [ ] **Step 5: Run the Chat renderer tests**

Run: `npx vitest run src/renderer/src/screens/Chat`
Expected: PASS except the known pre-existing failures (useDashboardChatTransport "creates a clean runtime…", dashboard-event-adapter "preserves reasoning…" — verify the latter still exists; if the adapter test file was renamed/removed note it)

- [ ] **Step 6: Commit**

```bash
git add -A && git reset HEAD tmp/
git commit -m "chore(chat): delete answer-gate machinery (useReasoningGate, reasoningStall)"
```

---

### Task 4: Transport — inline_diff capture + session.info settle

**Files:**
- Modify: `src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts`

- [ ] **Step 1: Add the diff capture + settle hook**

In the `tool.complete` FILE-CHANGES block (lines 1589-1695), add inline_diff capture FIRST (authoritative). Insert before the existing `oldString`/`newString` extraction:

```ts
      // FILE-CHANGES: authoritative inline diff from the backend (official
      // desktop contract — tui_gateway emits payload.inline_diff for
      // write_file/patch/skill_manage). Captured verbatim per tool call; the
      // per-file record prefers it over the heuristics below.
      const inlineDiff = inlineDiffFromPayload(event.payload);
      const diffPath = inlineDiff
        ? filePathFromInlineDiff(inlineDiff)
        : null;
      if (inlineDiff) {
        const stats = countDiffLineStats(inlineDiff);
        toolDiffsRef.current.set(
          String(
            (toolPayload.tool_id as string | undefined) ??
              (toolPayload.tool_call_id as string | undefined) ??
              toolName,
          ),
          inlineDiff,
        );
        const p = diffPath;
        if (p) {
          const existing = fileChangesRef.current.get(p);
          fileChangesRef.current.set(p, {
            path: p,
            before: null,
            after: null,
            beforeKnown: false,
            diff: inlineDiff,
            ...(existing?.removed ? { removed: existing.removed } : {}),
            ...(existing?.added ? { added: existing.added } : {}),
          });
          void window.hermesAPI
            .readFile(p)
            .then((res) => {
              const current = fileChangesRef.current.get(p);
              if (!current) return;
              fileChangesRef.current.set(p, {
                ...current,
                after: res?.content ?? null,
              });
            })
            .catch(() => undefined);
        }
      }
```

Add the ref near `fileChangesRef` (line 1007):

```ts
  // toolCallId → unified diff string captured from tool.complete inline_diff.
  const toolDiffsRef = useRef<Map<string, string>>(new Map());
```

Add the `session.info` settle in the event switch (near the `message.complete` handling at line 1727):

```ts
      if (event.type === "session.info") {
        const payload =
          event.payload && typeof event.payload === "object"
            ? (event.payload as Record<string, unknown>)
            : {};
        if (payload.running === false) {
          // Official fallback settle: the turn ended without message.complete
          // (crash/reconnect gap) — un-pend stranded bubbles via the adapter.
          const settled = applyDashboardStreamEvent(
            {
              messages: messagesRef.current,
              reasoningSegmentClosed: reasoningSegmentClosedRef.current,
            },
            event,
            { activeTurn: activeTurnRef.current },
          );
          messagesRef.current = settled.messages;
          setMessages(settled.messages);
        }
      }
```

- [ ] **Step 2: Update imports + message.complete wiring**

At the top of the file, import the new primitives:

```ts
import {
  countDiffLineStats,
  filePathFromInlineDiff,
  inlineDiffFromPayload,
} from "../diffLines";
```

Remove `renderAssistantDeltas` from BOTH `applyDashboardStreamEvent` call sites (the blocked-event path at ~line 1491 passes `renderAssistantDeltas: true`; the main path at ~line 1713 passes `false`) — pass `{ activeTurn: activeTurnRef.current }` in both. In the `message.complete` block, remove the `[gate-diag]` console.info block (lines 1744-1759). Remove the force-release/resetReasoningGate references if present in `handleSend` (search for `resetReasoningGate` — it was defined in useChatActions, remove there too; see Task 5 note).

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck:web`
Expected: no errors

- [ ] **Step 4: Run transport + adapter tests**

Run: `npx vitest run src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.test.tsx src/renderer/src/screens/Chat/dashboardEventAdapter.test.ts`
Expected: PASS except the known pre-existing "creates a clean runtime after a failed provider turn" failure

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts
git commit -m "feat(chat): capture inline_diff on tool.complete; session.info settle"
```

---

### Task 5: useChatActions reset cleanup

**Files:**
- Modify: `src/renderer/src/screens/Chat/hooks/useChatActions.ts` (check existence first)

- [ ] **Step 1: Find and remove the gate reset**

Search: `rg -n "resetReasoningGate|forceReleaseAllReasoning" src/renderer/src/screens/Chat/hooks/useChatActions.ts src/renderer/src/screens/Chat`

Remove `resetReasoningGate()` calls in `handleSend` (they reset the deleted module state — no longer needed) and any `reasoningStall` imports.

- [ ] **Step 2: Typecheck + run Chat tests**

Run: `npm run typecheck:web && npx vitest run src/renderer/src/screens/Chat`
Expected: clean (except pre-existing failures)

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/screens/Chat/hooks/useChatActions.ts
git commit -m "chore(chat): remove reasoning-gate resets from send path"
```

---

### Task 6: Types — FileChange.diff + ToolResultMessage diff fields

**Files:**
- Modify: `src/renderer/src/screens/Chat/types.ts`
- Modify: `src/main/session-continuation-store.ts`

- [ ] **Step 1: Write the failing persistence test**

Create `src/main/session-continuation-store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadSessionFileChanges } from "./session-continuation-store";

// loadSessionFileChanges needs a real better-sqlite3 DB; the function is
// exercised through persist/load round-trip in the integration path. For the
// unit level, verify the StoredFileChange shape accepts the diff field via
// the shared parser used by load (JSON round-trip).
import { normalizeFileChangesWithDiff } from "./session-continuation-store";

describe("session-continuation-store — diff field", () => {
  it("normalizeFileChangesWithDiff keeps the diff string on records", () => {
    const raw = [
      { path: "a.ts", before: null, after: "x", diff: "@@ -1 +1 @@\n+x" },
      { path: "b.ts", before: null, after: "y" },
    ];
    const out = normalizeFileChangesWithDiff(raw);
    expect(out[0].diff).toBe("@@ -1 +1 @@\n+x");
    expect(out[1].diff).toBeUndefined();
  });

  it("drops non-record entries", () => {
    const out = normalizeFileChangesWithDiff([null, "x", { path: "a.ts" }]);
    expect(out).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/session-continuation-store.test.ts`
Expected: FAIL — `normalizeFileChangesWithDiff is not a function`

- [ ] **Step 3: Implement types + store changes**

In `src/renderer/src/screens/Chat/types.ts`:

```ts
export interface FileChange {
  path: string;
  before: string | null;
  after: string | null;
  beforeKnown?: boolean;
  removed?: string[];
  added?: string[];
  /** Unified-diff text captured from the backend's tool.complete
   *  `inline_diff` (authoritative; renders directly without before/after). */
  diff?: string;
}
```

In `ToolResultMessage` (types.ts line 73-81):

```ts
export interface ToolResultMessage {
  id: string;
  kind: "tool_result";
  role: "agent";
  callId: string;
  name: string;
  content: string;
  attachments?: Attachment[];
  /** Unified diff from tool.complete inline_diff (authoritative). */
  diff?: string;
  added?: number;
  removed?: number;
}
```

In `src/main/session-continuation-store.ts`:

```ts
export interface StoredFileChange {
  path: string;
  before: string | null;
  after: string | null;
  beforeKnown?: boolean;
  removed?: string[];
  added?: string[];
  /** Unified diff text (backend inline_diff) — survives reopen verbatim. */
  diff?: string;
}
```

Add the normalizer (used by `loadSessionFileChanges`):

```ts
/** Validate + normalize persisted file-change records, keeping the optional
 *  diff string. */
export function normalizeFileChangesWithDiff(
  value: unknown,
): StoredFileChange[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (c): c is StoredFileChange =>
      isRecord(c) &&
      typeof c.path === "string" &&
      c.path.length > 0 &&
      (c.diff === undefined || typeof c.diff === "string"),
  );
}
```

Update `loadSessionFileChanges` to use it:

```ts
    const parsed = JSON.parse(row.changes_json);
    return normalizeFileChangesWithDiff(parsed);
```

(`persistSessionFileChanges` stores the JSON blob verbatim — no change needed; the diff rides inside the objects.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/session-continuation-store.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck:node && npm run typecheck:web`
Expected: clean

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/screens/Chat/types.ts src/main/session-continuation-store.ts src/main/session-continuation-store.test.ts
git commit -m "feat(chat): FileChange.diff + ToolResult diff fields; persist diffs across reopen"
```

---

### Task 7: UI — tool-result diff cards + N-files-changed row

**Files:**
- Modify: `src/renderer/src/screens/Chat/MessageRow.tsx`, `MessageList.tsx`, `FileChangesDialog.tsx`, `src/renderer/src/assets/main.css`

- [ ] **Step 1: Tool-result diff card in MessageRow**

In `src/renderer/src/screens/Chat/MessageRow.tsx`, add the import for the diff primitives and the `ToolResultMessage` type:

```tsx
import type { ToolResultMessage } from "./types";
import { countDiffLineStats, parseDiff } from "./diffLines";
```

Add the card component (top of file, after imports):

```tsx
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { countDiffLineStats, parseDiff, type DiffLine } from "./diffLines";
import type { ToolResultMessage } from "./types";

/** Collapsible unified-diff card for a file-edit tool result (+N −M chip in
 *  the header, diff body below). Ported presentation from the official
 *  desktop's per-edit card. */
function ToolResultDiffCard({
  diff,
  added,
  removed,
}: {
  diff: string;
  added?: number;
  removed?: number;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const stats =
    added !== undefined && removed !== undefined
      ? { added, removed }
      : countDiffLineStats(diff);
  const lines = parseDiff(diff);
  return (
    <div className={`tool-diff-card ${open ? "is-open" : ""}`}>
      <button
        type="button"
        className="tool-diff-card-header"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="tool-diff-card-title">Diff</span>
        <span className="tool-diff-card-stats">
          <span className="tool-diff-add">+{stats.added}</span>
          <span className="tool-diff-del">−{stats.removed}</span>
        </span>
      </button>
      {open && (
        <div className="tool-diff-card-body">
          {lines.length === 0 ? (
            <div className="tool-diff-empty">No hunks</div>
          ) : (
            lines.map((line, i) => (
              <div
                key={i}
                className={`tool-diff-line tool-diff-line-${line.kind}`}
              >
                {line.text}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
```

Then find where the tool-result row renders its content (the `ToolResultMessage` branch of the row component) and add the card after the result content:

```tsx
{("kind" in msg && msg.kind === "tool_result" && (msg as ToolResultMessage).diff) ? (
  <ToolResultDiffCard
    diff={(msg as ToolResultMessage).diff!}
    added={(msg as ToolResultMessage).added}
    removed={(msg as ToolResultMessage).removed}
  />
) : null}
```

- [ ] **Step 2: Wire the diff card + per-file counts into the capture path**

In `useDashboardChatTransport.ts`, when a tool completes with `inline_diff`, also store counts on the pending tool row's result. In the `applyDashboardStreamEvent`-fed adapter path this is handled by `toolEventFromGatewayEvent` — extend it in `dashboardEventAdapter.ts` to attach `diff`/`added`/`removed` to `ToolResultMessage`:

In `dashboardEventAdapter.ts` `toolEventFromGatewayEvent` (lines 206-234), add:

```ts
  const inlineDiff = inlineDiffFromPayload(payload);
  let diff: string | undefined;
  let added: number | undefined;
  let removed: number | undefined;
  if (inlineDiff) {
    diff = inlineDiff;
    const stats = countDiffLineStats(inlineDiff);
    added = stats.added;
    removed = stats.removed;
  }
  return {
    callId,
    hasStableCallId: ...,
    name,
    status,
    ...(label ? { label, preview: label } : {}),
    ...(result ? { result } : {}),
    ...(diff ? { diff, added, removed } : {}),
  };
```

Then in the transport's tool.complete handler, after `applyDashboardStreamEvent`, the resulting `ToolResultMessage` rows already carry `diff` — the MessageRow renders the card (Step 1). Remove the transport-level `toolDiffsRef` if it ends up unused (or keep for future use — remove if typecheck flags it).

- [ ] **Step 3: Per-turn row — counts + click**

In `src/renderer/src/screens/Chat/MessageList.tsx`, update `FileChangesRow` (lines 23-45) to show +A −B per file and keep the click-to-open:

```tsx
const FileChangesRow = memo(function FileChangesRow({
  msg,
  onOpen,
}: {
  msg: FileChangesMessage;
  onOpen?: (changes: FileChange[]) => void;
}): React.JSX.Element {
  const count = msg.changes.length;
  const added = msg.changes.reduce(
    (sum, c) => sum + (c.diff ? countDiffLineStats(c.diff).added : c.added?.length ?? 0),
    0,
  );
  const removed = msg.changes.reduce(
    (sum, c) => sum + (c.diff ? countDiffLineStats(c.diff).removed : c.removed?.length ?? 0),
    0,
  );
  return (
    <button
      type="button"
      className="chat-file-changes-row"
      onClick={() => onOpen?.(msg.changes)}
      title="View file changes"
    >
      <FilePlus2 size={13} />
      <span>
        {count} file{count > 1 ? "s" : ""} changed
      </span>
      <span className="chat-file-changes-row-stats">
        <span className="file-changes-stat-add">+{added}</span>
        <span className="file-changes-stat-del">−{removed}</span>
      </span>
      <span className="chat-file-changes-row-arrow">▸</span>
    </button>
  );
});
```

Import `countDiffLineStats` in MessageList.tsx.

- [ ] **Step 4: FileChangesDialog prefers the unified diff**

In `src/renderer/src/screens/Chat/FileChangesDialog.tsx`, in `diffFor` (lines 60-71), add the diff-first branch:

```ts
function diffFor(change: FileChange): DiffLine[] | null {
  if (change.diff) {
    return parseDiff(change.diff);
  }
  if (change.removed || change.added) {
    const lines: DiffLine[] = [];
    for (const r of change.removed ?? []) lines.push({ type: "del", text: r });
    for (const a of change.added ?? []) lines.push({ type: "add", text: a });
    return lines;
  }
  if (change.before !== null && change.after !== null) {
    return diffLines(change.before, change.after);
  }
  return null;
}
```

And in `diffStats` (lines 9-38), use `countDiffLineStats(change.diff)` when present. Import `parseDiff`, `countDiffLineStats` from `./diffLines`.

- [ ] **Step 5: CSS**

Append to `src/renderer/src/assets/main.css`:

```css
/* ---- Tool result diff card ---- */
.tool-diff-card { border: 1px solid var(--border, #2a2f3a); border-radius: 8px; margin-top: 6px; overflow: hidden; }
.tool-diff-card-header { display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px 10px; background: var(--bg-tertiary, #232834); color: var(--text-secondary, #8b93a7); font-size: 11px; font-weight: 600; cursor: pointer; border: none; }
.tool-diff-card-title { flex: 1; text-align: left; }
.tool-diff-card-stats { display: inline-flex; gap: 6px; font-family: ui-monospace, monospace; }
.tool-diff-add { color: #34d399; }
.tool-diff-del { color: #f87171; }
.tool-diff-card-body { max-height: 260px; overflow-y: auto; padding: 6px 10px; font-family: ui-monospace, monospace; font-size: 11px; background: var(--bg-secondary, #1a1e27); }
.tool-diff-line { white-space: pre-wrap; word-break: break-all; }
.tool-diff-line-add { color: #34d399; background: rgba(52, 211, 153, 0.08); }
.tool-diff-line-remove { color: #f87171; background: rgba(248, 113, 113, 0.08); }
.tool-diff-line-context { color: var(--text-tertiary, #6b7280); }
.tool-diff-empty { color: var(--text-tertiary, #6b7280); padding: 4px; }
.chat-file-changes-row-stats { display: inline-flex; gap: 6px; font-family: ui-monospace, monospace; font-size: 11px; }
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run src/renderer/src/screens/Chat && npm run typecheck:web`
Expected: PASS except pre-existing failures

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/screens/Chat/MessageRow.tsx src/renderer/src/screens/Chat/MessageList.tsx src/renderer/src/screens/Chat/FileChangesDialog.tsx src/renderer/src/screens/Chat/dashboardEventAdapter.ts src/renderer/src/screens/Chat/hooks/useDashboardChatTransport.ts src/renderer/src/assets/main.css
git commit -m "feat(ui): tool-result diff cards + N-files-changed row with counts"
```

---

### Task 8: Chat.tsx file-changes wiring (diff dialog)

**Files:**
- Modify: `src/renderer/src/screens/Chat/Chat.tsx`

- [ ] **Step 1: Wire the dialog already used**

The existing `onOpenFileChanges={(changes) => setFileChangesOpen(changes)}` (Chat.tsx:1263) already opens `FileChangesDialog` with the changes — the dialog now renders unified diffs (Task 7 Step 4). No code change needed; verify the dialog still receives `FileChange[]` (now with `diff`).

- [ ] **Step 2: Verify + commit**

Run: `npm run typecheck:web && npx vitest run src/renderer/src/screens/Chat/Chat.test.tsx` (if exists)
Expected: PASS

```bash
git add -A && git reset HEAD tmp/
git commit -m "chore(chat): wire diff-capable file-changes dialog"
```

---

### Task 9: lat.md docs + final verification

**Files:**
- Modify: `lat.md/chat-performance.md`, `lat.md/file-changes.md` (create/rewrite), `lat.md/lat.md` index

- [ ] **Step 1: Rewrite the streaming + file-changes docs**

In `lat.md/chat-performance.md`, update the streaming section: document the official stability contract (live deltas → final merge at message.complete, `mergeFinalAssistantText`), the `session.info running:false` settle, and that the answer gate was removed.

Create `lat.md/file-changes.md` (or rewrite if it exists) documenting: `inline_diff` capture from `tool.complete` (backend `tui_gateway/server.py`), the `diffLines.ts` primitives, tool-result diff cards, the per-turn "N files changed" row, and persistence through `desktop_session_file_changes` with the `diff` field. Follow lat.md section rules (leading paragraph ≤250 chars, wiki links, `// @lat:` refs).

Add the file to `lat.md/lat.md` index if not present.

- [ ] **Step 2: Full test + typecheck run**

Run: `npm run typecheck && npx vitest run`
Expected: all green except the known pre-existing failures (useDashboardChatTransport "creates a clean runtime after a failed provider turn", Sessions, AgentMarkdown, terminal-launcher, cronjobs, hermes-api, hermes-cli-session-id, preload-api-surface, remote-sessions, gateway-restart, gpu-fallback flake, ClarifyCard flake) — verify the list matches the pre-change baseline.

- [ ] **Step 3: Manual smoke test**

Start the app (`npm run dev`), verify:
1. Send a chat turn: text streams live into the bubble, then at completion the final text replaces it cleanly (no duplicate/garbled text, no blink).
2. Ask the agent to edit a file: the tool row shows a "Diff" card with +N −M; expand to see the unified diff.
3. The per-turn "N files changed" row shows at the end of the turn with +A −B.
4. Reopen the session: the file-changes row and diffs are restored.
5. Trigger a terminal-driven edit (no inline_diff): the git-fallback chip still appears.
6. Minimize during streaming: text keeps arriving (timer flush).
7. Chat box, status strip, interrupt confirm, nav arrows all behave as before.

- [ ] **Step 4: Commit**

```bash
git add lat.md/
git commit -m "docs: streaming stability contract + inline_diff file tracking"
git push fork custom
```

---

## Self-Review Notes

- **Spec coverage:** all spec sections map to tasks — streaming (Tasks 2-3, 5), final merge (Task 2), session.info settle (Tasks 2, 4), inline_diff capture (Task 4), diff primitives (Task 1), tool-result cards + N-files-changed row (Task 7), persistence (Task 6), git fallback kept (Task 4 keeps existing capture path), cleanup (Tasks 3, 5), docs (Task 9).
- **Placeholders:** all steps carry concrete code. Task 5 is intentionally a search-and-remove (the exact call sites were deleted with the module); Task 8 is a verification-only task.
- **Type consistency:** `FileChange.diff` defined in Task 6, used in Tasks 4, 7; `ToolResultMessage.diff/added/removed` defined in Task 6, consumed in Task 7; `mergeFinalAssistantText`/`finalizeInterruptedMessages` exported in Task 2, tested there; `diffLines.ts` exports (`parseDiff`, `countDiffLineStats`, `stripDiffChrome`, `filePathFromInlineDiff`, `inlineDiffFromPayload`) defined in Task 1 and used in Tasks 4 and 7.

