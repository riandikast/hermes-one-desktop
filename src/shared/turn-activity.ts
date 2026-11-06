/**
 * Cross-process turn activity for a stored chat session.
 *
 * Every Hermes runtime (this desktop's backend, a `hermes` CLI run spawned by
 * another app, the API server) takes a row in state.db's `session_turn_leases`
 * for the duration of a turn. Reading that row is the only way a window can
 * tell that a session is running somewhere else — `session.active_list` only
 * lists live sessions in THIS process.
 */
export interface SessionTurnActivity {
  /** A turn currently holds the session's cross-process lease. */
  active: boolean;
  /** PID stamped into the lease holder (`pid=<n>`), when it names one. */
  holderPid: number | null;
  /**
   * Whether that PID is alive. `null` when the holder carries no probeable pid
   * (foreign PID namespace) or the lease names none.
   */
  holderAlive: boolean | null;
  /** `platform=` fragment of the lease: `desktop`, `cli`, `telegram`, ... */
  platform: string | null;
  /** Lease acquisition / expiry, epoch milliseconds. */
  acquiredAt: number | null;
  expiresAt: number | null;
}

export interface StopSessionTurnResult {
  stopped: boolean;
  pid: number | null;
  /** `inactive` | `unknown-holder` | `already-exited` | `own-process` | `failed` */
  reason?: string;
}
