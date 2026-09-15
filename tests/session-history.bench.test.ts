/**
 * Turn-completion tail read/reconcile benchmark — REAL session ids (read-only).
 *
 * Proves which half of the ~2 s completion lock dominates and that the fix
 * removes it. The DB rows for the target session are extracted once (read-only,
 * via Electron so the native sqlite module loads) into a temp JSON file, so
 * this runs under plain vitest without the Electron-only native module.
 *
 * Extraction (only if the temp file is missing) is done by
 * scripts/_bench-extract-rows.mjs, run with:
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe \
 *     scripts/_bench-extract-rows.mjs
 *
 * Run: npx vitest run src/renderer/src/screens/Chat/_bench_completion.test.ts \
 *        --disable-console-intercept
 */
// @vitest-environment node
import { existsSync, readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import {
  dbItemsToChatMessages,
  reconcileAfterDbRefresh,
  reconcileTailAfterDbRefresh,
  highestDbId,
  messageDbId,
  type DbHistoryItem,
} from "../src/renderer/src/screens/Chat/sessionHistory";
import type { ChatMessage } from "../src/renderer/src/screens/Chat/types";

const HOME = process.env.HOME || process.env.USERPROFILE || "";
const SID = process.env.HERMES_BENCH_SESSION || "20260815_004037_f049da";
const SRC =
  process.env.HERMES_BENCH_ROWS ||
  `${HOME}/AppData/Local/Temp/_bench-history-${SID}.json`;

const ms = (n: bigint): number => Number(n) / 1e6;
const median = (a: number[]): number =>
  a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];

function timeIt(label: string, fn: () => void, iters = 12): number {
  fn();
  const t: number[] = [];
  for (let i = 0; i < iters; i++) {
    const a = process.hrtime.bigint();
    fn();
    t.push(ms(process.hrtime.bigint() - a));
  }
  const med = median(t);
  console.log(
    `${label.padEnd(46)} med=${med.toFixed(1)} ms  min=${Math.min(...t).toFixed(1)}  max=${Math.max(...t).toFixed(1)}`,
  );
  return med;
}

describe(`turn-completion cost on real session ${SID}`, () => {
  it("measures full vs tail read/reconcile and asserts the win", () => {
    if (!existsSync(SRC)) {
      console.log(
        `\n[bench] rows file missing: ${SRC}\n` +
          `[bench] run: ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe scripts/_bench-extract-rows.mjs`,
      );
      return;
    }

    const items = JSON.parse(readFileSync(SRC, "utf8")) as DbHistoryItem[];
    console.log(`\n[bench] real HistoryItems: ${items.length}`);
    expect(items.length).toBeGreaterThan(1000);

    // Split the REAL session into a canonical prefix + the final turn, matching
    // what the renderer holds at completion (prefix already synced, tail new).
    const liveFull = dbItemsToChatMessages(items);
    const lastUserId = highestDbId(liveFull);

    // Find the last user row's db id: the boundary the tail read starts from.
    let boundaryId = 0;
    for (let i = liveFull.length - 1; i >= 0; i--) {
      const m = liveFull[i];
      if (!("kind" in m) && m.role === "user") {
        const mine = messageDbId(m);
        if (mine > 0) boundaryId = mine;
        break;
      }
    }
    const tailItems = items.filter((it) => it.id > boundaryId);
    const tailMessages = dbItemsToChatMessages(tailItems);
    console.log(
      `[bench] prefix msgs=${liveFull.length - tailMessages.length}  tail items=${tailItems.length}  boundaryId=${boundaryId}  lastDbId=${lastUserId}`,
    );

    // (1) The renderer's LIVE transcript at completion: the canonical prefix
    //     (already reconciled, so a settled fixed point) + streamed pending
    //     bubbles for the final turn.
    const prefixDb = dbItemsToChatMessages(
      items.slice(0, items.length - tailItems.length),
    );
    const prefix = reconcileAfterDbRefresh(prefixDb, prefixDb, {});
    const current: ChatMessage[] = [
      ...prefix,
      ...tailMessages.map((m) => ({ ...m, pending: true })),
    ];

    // (2) Full path — what the code did BEFORE this change: read the whole
    //     session and reconcile the whole transcript.
    const fullMed = timeIt("BEFORE: reconcileAfterDbRefresh(full)", () => {
      reconcileAfterDbRefresh(current, liveFull, {});
    });

    // (3) Tail path — what the code does AFTER this change.
    const tailMed = timeIt(
      "AFTER:  reconcileTailAfterDbRefresh(tail)",
      () => {
        reconcileTailAfterDbRefresh(current, tailMessages, {
          lastSyncedDbId: boundaryId,
        });
      },
    );

    console.log(
      `\n[bench] renderer reconcile: BEFORE=${fullMed.toFixed(1)} ms  AFTER=${tailMed.toFixed(1)} ms  speedup=${(fullMed / Math.max(tailMed, 0.0001)).toFixed(1)}x`,
    );

    // Correctness bar: (1) every prefix row is carried over BY IDENTITY, and
    // (2) the tail region reconciles identically to the full reconcile. We do
    // NOT compare against a whole-transcript full reconcile: on this real
    // session that function churns deep historical duplicate-user rows on
    // every pass (it is not a stable fixed point), whereas the tail path
    // deliberately leaves settled history alone.
    const actual = reconcileTailAfterDbRefresh(current, tailMessages, {
      lastSyncedDbId: boundaryId,
    });
    expect(actual.length).toBeGreaterThanOrEqual(prefix.length);
    let identityOk = true;
    for (let i = 0; i < prefix.length; i++) {
      if (actual[i] !== prefix[i]) {
        identityOk = false;
        break;
      }
    }
    expect(identityOk).toBe(true);

    const tailCurrent = current.slice(prefix.length);
    const expectedTail = reconcileAfterDbRefresh(tailCurrent, tailMessages, {});
    const sig = (arr: readonly ChatMessage[]) =>
      arr.map(
        (m) =>
          `${m.id}|${"kind" in m ? m.kind : m.role}|${"pending" in m ? !!m.pending : false}`,
      );
    expect(sig(actual.slice(prefix.length))).toEqual(sig(expectedTail));
    console.log(
      `[bench] correctness: prefix ${prefix.length} rows preserved by identity; tail region identical to full reconcile (${expectedTail.length} rows)`,
    );

    expect(tailMed).toBeLessThan(fullMed / 2);
  }, 120000);
});
