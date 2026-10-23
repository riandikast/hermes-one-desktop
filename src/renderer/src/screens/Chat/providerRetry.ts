import type { DashboardStreamEvent } from "./dashboardEventAdapter";

export interface ProviderRetry {
  deadline: number | null;
  attempt?: string;
}

/** Only transport diagnostics, never assistant prose or the loading flag. */
export function providerRetry(event: DashboardStreamEvent, now: number): ProviderRetry | null {
  if (!["thinking.delta", "status.update"].includes(event.type)) return null;
  const p = event.payload as Record<string, unknown> | undefined;
  if (!p) return null;
  const text = typeof p.text === "string" ? p.text.trim() : "";
  const match = /^(?:⏳\s*)?(?:waiting on provider|rate limited|provider (?:overloaded|temporarily unavailable)).*?\bretrying in (\d+(?:\.\d+)?)s\b(?:\s*\(attempt (\d+\/\d+)\))?/i.exec(text);
  const structured = event.type === "status.update" && ["provider_retry", "retry_wait"].includes(String(p.kind));
  const seconds = structured && typeof p.retry_after === "number" ? p.retry_after : match ? Number(match[1]) : NaN;
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return { deadline: now + seconds * 1000, ...(match?.[2] ? { attempt: match[2] } : {}) };
}

export function explicitModelLimit(error: string): boolean {
  // Permanent model retirement skips same-model retries; only configured fallbacks apply.
  return /\bModelDeprecated\b|\b(?:HTTP[ :]+410|status(?:_code)?["' :]+410)\b[^\n]*\b(?:model[^\n]*deprecat|deprecat[^\n]*model)|\binsufficient_quota\b|\bquota (?:exceeded|exhausted)\b|\b(?:daily|monthly|model|usage|credit|spend) (?:usage )?limit (?:reached|exceeded)\b|\binsufficient (?:credits|balance)\b/i.test(error);
}

type Request = (method: string, params?: Record<string, unknown>, timeout?: number) => Promise<unknown>;

/** Idle is NOT failure. Missing, malformed, unreachable and live children fail closed. */
export async function probeTurn(request: Request, sessionId: string): Promise<"running" | "idle" | "failed" | "unknown"> {
  try {
    const response = await request("session.active_list", {}, 5000) as { sessions?: { id?: string; status?: string }[] };
    if (!Array.isArray(response?.sessions)) return "unknown";
    const row = response.sessions.find((s) => s.id === sessionId);
    if (!row) return "unknown";
    if (["working", "waiting", "starting", "running"].includes(row.status ?? "")) return "running";
    if (!["idle", "failed", "error", "cancelled"].includes(row.status ?? "")) return "unknown";
    const children = await request("subagent.list", { session_id: sessionId }, 5000) as { subagents?: { status?: string }[] };
    if (!Array.isArray(children?.subagents)) return "unknown";
    if (children.subagents.some((c) => !["complete", "completed", "done", "failed", "error", "cancelled", "canceled", "stopped"].includes(c.status ?? ""))) return "running";
    return row.status === "failed" || row.status === "error" ? "failed" : "idle";
  } catch { return "unknown"; }
}

/** An interrupt ACK requests cancellation; only a later quiescent snapshot confirms it. */
export async function cancelTurn(request: Request, sessionId: string, cancelled: () => boolean): Promise<boolean> {
  try {
    const ack = await request("session.interrupt", { session_id: sessionId }, 5000) as { status?: string };
    if (ack?.status !== "interrupted" || cancelled()) return false;
    for (let i = 0; i < 10; i++) {
      const verdict = await probeTurn(request, sessionId);
      if (cancelled()) return false;
      if (verdict === "idle" || verdict === "failed") return true;
      if (i < 9) await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } catch { /* Unknown cancellation must never replay. */ }
  return false;
}
