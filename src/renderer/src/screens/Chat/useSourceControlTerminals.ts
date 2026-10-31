import { useCallback, useEffect, useRef, useState } from "react";
import { appConfirm } from "../../components/modal/appConfirm";
import type { TerminalDockHandle } from "../Command/TerminalDock";

/** Own only sessions created here, including late create replies after unmount. */
export function useSourceControlTerminals(dir: string, onClose: () => void, report: (error: string) => void): {
  dock: React.RefObject<TerminalDockHandle | null>;
  visible: boolean;
  mounted: boolean;
  creating: boolean;
  toggle: () => void;
  add: () => void;
  closed: (id: string) => void;
  requestClose: () => Promise<boolean>;
} {
  const dock = useRef<TerminalDockHandle>(null);
  const ids = useRef(new Set<string>());
  const alive = useRef(true);
  const pending = useRef(false);
  const closing = useRef(false);
  const confirming = useRef(false);
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    alive.current = true;
    const owned = ids.current;
    return () => {
      alive.current = false;
      for (const id of owned) void window.hermesAPI.terminalKill(id).catch(() => undefined);
      owned.clear();
    };
  }, []);
  const add = useCallback((): void => {
    if (pending.current || closing.current || confirming.current) return;
    pending.current = true; setCreating(true); setMounted(true); setVisible(true);
    void (async () => {
      let created: string | undefined;
      try {
        const { id } = await window.hermesAPI.terminalCreate({ cwd: dir, cols: 80, rows: 24 });
        created = id;
        if (!alive.current || closing.current) {
          await window.hermesAPI.terminalKill(id);
          return;
        }
        ids.current.add(id);
        if (!dock.current) throw new Error("Terminal pane unavailable");
        dock.current.attachSession(id, `Terminal ${ids.current.size}`, dir);
      } catch (err) {
        if (created && alive.current) {
          ids.current.delete(created);
          await window.hermesAPI.terminalKill(created).catch(() => undefined);
        }
        if (alive.current) report(String(err));
      } finally {
        pending.current = false;
        if (alive.current) { setCreating(false); if (!ids.current.size) setVisible(false); }
      }
    })();
  }, [dir, report]);
  const requestClose = useCallback(async (): Promise<boolean> => {
    if (closing.current || confirming.current) return false;
    confirming.current = true;
    try {
      if ((ids.current.size || pending.current) && !await appConfirm("Close Source Control and all its terminals? Running commands in these terminals will be terminated.")) return false;
    } finally { confirming.current = false; }
    closing.current = true;
    try {
      const failed: string[] = [];
      await Promise.all([...ids.current].map(async (id) => {
        try {
          if (!(await window.hermesAPI.terminalKill(id)).ok) { failed.push(id); return; }
          ids.current.delete(id);
        } catch { failed.push(id); }
      }));
      if (failed.length) { report("Could not close every Source Control terminal. Retry closing."); closing.current = false; return false; }
      onClose();
      return true;
    } catch (err) {
      closing.current = false; report(String(err)); return false;
    }
  }, [onClose, report]);
  const toggle = (): void => {
    if (visible) setVisible(false);
    else if (ids.current.size || pending.current) setVisible(true);
    else add();
  };
  return { dock, visible, mounted, creating, toggle, add, closed: (id) => {
    ids.current.delete(id);
    if (!ids.current.size && !pending.current) setVisible(false);
  }, requestClose };
}
