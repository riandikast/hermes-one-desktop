import { useCallback, useRef, useState } from "react";
import { resolveOnFinishCommands, type OnFinishCommand } from "./onFinish";

export interface OnFinishRunState {
  /** True while a queue is executing (drives the armed indicator). */
  running: boolean;
  /** 1-based index of the command in flight, 0 when idle. */
  current: number;
  total: number;
  lastError: string | null;
}

const IDLE: OnFinishRunState = {
  running: false,
  current: 0,
  total: 0,
  lastError: null,
};

/**
 * Runs the On-Finish queue SEQUENTIALLY, in selection order.
 *
 * Sequential, not parallel: the user chose an order, and fire-and-forget would
 * discard it (and interleave unrelated output across terminals). Each command
 * gets its own terminal session, attached to the dock as it starts, so the tab
 * appears before output arrives.
 *
 * Re-entrancy is guarded: a new turn finishing while the previous queue is
 * still running must not start a second overlapping queue.
 */
export function useOnFinishRunner(
  attachSession: (id: string, title: string) => void,
): {
  state: OnFinishRunState;
  runQueue: (
    selectedIds: readonly string[],
    commands: readonly OnFinishCommand[],
  ) => Promise<void>;
  cancel: () => void;
} {
  const [state, setState] = useState<OnFinishRunState>(IDLE);
  const runningRef = useRef(false);
  const cancelledRef = useRef(false);

  const cancel = useCallback((): void => {
    cancelledRef.current = true;
  }, []);

  const runQueue = useCallback(
    async (
      selectedIds: readonly string[],
      commands: readonly OnFinishCommand[],
    ): Promise<void> => {
      // Guard: never overlap queues.
      if (runningRef.current) return;
      // Resolve against the live list so a deleted command is skipped rather
      // than throwing mid-run, and so ORDER comes from the selection.
      const queue = resolveOnFinishCommands(selectedIds, commands);
      if (queue.length === 0) return;

      runningRef.current = true;
      cancelledRef.current = false;
      setState({
        running: true,
        current: 0,
        total: queue.length,
        lastError: null,
      });

      try {
        for (let i = 0; i < queue.length; i += 1) {
          if (cancelledRef.current) break;
          const cmd = queue[i];
          setState((prev) => ({ ...prev, current: i + 1 }));
          try {
            const { id } = await window.hermesAPI.commandRun({
              commandId: cmd.id,
              cwd: cmd.cwd ?? "",
              command: cmd.command,
            });
            attachSession(id, cmd.name ?? "On-Finish");
          } catch {
            // One failing launch must not abort the rest of the queue; record
            // it and continue so later commands still run in order.
            setState((prev) => ({
              ...prev,
              lastError: `Failed to start ${cmd.name ?? cmd.id}`,
            }));
          }
          // Let the main process spawn the pty before the next one, so tab
          // order in the dock matches selection order.
          await new Promise((resolve) => setTimeout(resolve, 60));
        }
      } finally {
        runningRef.current = false;
        setState(IDLE);
      }
    },
    [attachSession],
  );

  return { state, runQueue, cancel };
}
