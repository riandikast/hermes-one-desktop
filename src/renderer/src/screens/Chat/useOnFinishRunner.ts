import { useCallback, useRef, useState } from "react";
import { type OnFinishCommand } from "./onFinish";
import { decodeTerminalInput, TERMINAL_INPUT_PREFIX, terminalInputBytes } from "./onFinishTerminal";

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
  getLiveSessions: () => { id: string; title: string }[] = () => [],
): {
  state: OnFinishRunState;
  runQueue: (
    selectedIds: readonly string[],
    commands: readonly OnFinishCommand[],
    valid?: () => boolean,
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
      valid: () => boolean = () => true,
    ): Promise<void> => {
      // Guard: never overlap queues.
      if (runningRef.current) return;
      // Resolve against the live list so a deleted command is skipped rather
      // than throwing mid-run, and so ORDER comes from the selection.
      const queue = selectedIds.filter((id) =>
        id.startsWith(TERMINAL_INPUT_PREFIX) || commands.some((cmd) => cmd.id === id),
      );
      let lastError: string | null = null;
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
          if (cancelledRef.current || !valid()) break;
          const actionId = queue[i];
          const cmd = commands.find((command) => command.id === actionId);
          setState((prev) => ({ ...prev, current: i + 1 }));
          try {
            if (actionId.startsWith(TERMINAL_INPUT_PREFIX)) {
              const input = decodeTerminalInput(actionId);
              if (!input) throw new Error("Invalid terminal input action");
              if (!getLiveSessions().some((session) => session.id === input.terminalId))
                throw new Error(`Terminal “${input.title}” is closed. Select an existing terminal in On-Finish.`);
              const response = await window.hermesAPI.terminalWrite({
                id: input.terminalId, data: terminalInputBytes(input),
              });
              if (!response?.ok) throw new Error("Terminal input failed");
              continue;
            }
            if (!cmd) continue;
            const { id } = await window.hermesAPI.commandRun({
              commandId: cmd.id,
              cwd: cmd.cwd ?? "",
              command: cmd.command,
            });
            attachSession(id, cmd.name ?? "On-Finish");
          } catch (error) {
            lastError = actionId.startsWith(TERMINAL_INPUT_PREFIX)
              ? (error instanceof Error ? error.message : "Terminal input failed")
              : `Failed to start ${cmd?.name ?? actionId}`;
            setState((prev) => ({ ...prev, lastError }));
          }
          // Let the main process spawn the pty before the next one, so tab
          // order in the dock matches selection order.
          await new Promise((resolve) => setTimeout(resolve, 60));
        }
      } finally {
        runningRef.current = false;
        setState({ ...IDLE, lastError });

      }
    },
    [attachSession, getLiveSessions],
  );

  return { state, runQueue, cancel };
}
