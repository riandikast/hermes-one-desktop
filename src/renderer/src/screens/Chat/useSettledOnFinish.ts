import { useCallback, useEffect, useRef } from "react";
import { readOnFinishSelection, type OnFinishCommand } from "./onFinish";

export interface OnFinishActivity {
  busy: boolean;
  cancelled: boolean;
  revision: string;
}

// @lat: [[chat-on-finish#Settled completion]]
export function useSettledOnFinish({
  loading,
  active,
  identity,
  armed,
  getActivity,
  runQueue,
}: {
  loading: boolean;
  active: boolean;
  identity: string;
  armed: boolean;
  getActivity: () => OnFinishActivity;
  runQueue: (
    ids: string[],
    commands: OnFinishCommand[],
    valid: () => boolean,
  ) => Promise<void>;
}): () => void {
  const latest = useRef({
    loading,
    active,
    identity,
    armed,
    getActivity,
    runQueue,
  });
  latest.current = { loading, active, identity, armed, getActivity, runQueue };
  const pending = useRef(false);
  const previous = useRef(loading);
  const epoch = useRef(0);
  const commandsRef = useRef<OnFinishCommand[]>([]);
  const interrupted = useRef(false);
  const cancel = useCallback((): void => {
    interrupted.current = true;
    pending.current = false;
    epoch.current++;
  }, []);
  const previousIdentity = useRef(identity);
  if (previousIdentity.current !== identity) {
    previousIdentity.current = identity;
    pending.current = false;
    epoch.current++;
  }

  const activity = getActivity();
  useEffect(() => {
    if (loading) {
      pending.current = false;
      interrupted.current = false;
    }
    if (previous.current && !loading && !interrupted.current)
      pending.current = true;
    previous.current = loading;
  }, [loading]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let settledAt: number | null = null;
    let revision: string | null = null;
    let lookingUp = false;
    const scope = identity;
    const invalidate = (): void => {
      settledAt = null;
      epoch.current++;
    };
    const tick = (): void => {
      if (disposed) return;
      const current = latest.current;
      const activity = current.getActivity();
      if (activity.cancelled) cancel();
      const busy =
        current.loading ||
        !current.active ||
        !current.armed ||
        current.identity !== scope ||
        activity.busy;
      if (busy || revision !== activity.revision) invalidate();
      revision = activity.revision;
      if (pending.current && !busy) {
        settledAt ??= Date.now();
        if (Date.now() - settledAt >= 3000 && !lookingUp) {
          lookingUp = true;
          const ticket = epoch.current;
          const valid = (): boolean => {
            const now = latest.current;
            const state = now.getActivity();
            return (
              !disposed &&
              ticket === epoch.current &&
              now.identity === scope &&
              now.active &&
              now.armed &&
              !now.loading &&
              !state.busy &&
              !state.cancelled &&
              state.revision === revision
            );
          };
          void (async () => {
            try {
              commandsRef.current = await window.hermesAPI.listCommands();
            } catch {
              // Preserve the previous command list when refreshing fails.
            }
            if (valid()) {
              pending.current = false;
              await latest.current.runQueue(
                readOnFinishSelection(scope),
                commandsRef.current,
                valid,
              );
            } else invalidate();
          })().finally(() => {
            lookingUp = false;
          });
        }
      }
      if (pending.current && current.active) timer = setTimeout(tick, 100);
    };
    tick();
    return () => {
      disposed = true;
      clearTimeout(timer);
      invalidate();
    };
  }, [
    identity,
    loading,
    active,
    armed,
    activity.busy,
    activity.cancelled,
    activity.revision,
  ]);

  return cancel;
}
