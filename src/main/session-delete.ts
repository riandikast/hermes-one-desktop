import { deleteSessionThroughAgent, type AgentRequest } from "./agent-session-delete";
import { dashboardRequestJson, getDashboardConnection } from "./dashboard";
import {
  deleteSessions,
  finishAgentSessionDelete,
  normalizeSessionIds,
  sessionSubtreeIds,
  type DeleteSessionsResult,
} from "./sessions";
import { getActiveProfileNameSync } from "./utils";

/**
 * Delete local sessions through the agent that owns the schema.
 *
 * The agent's delete is more than `DELETE FROM sessions`: it retires the
 * admission/worker ledgers that reference a session, expands compression
 * chains, refuses rows a live turn owns, and is served by whichever runtime
 * owns the profile (a running gateway included). Newer state.db schemas even
 * install triggers that refuse the desktop's raw SQL outright. The direct-SQL
 * path remains only for when no local dashboard is running.
 */
export async function deleteLocalSessions(sessionIds: unknown): Promise<DeleteSessionsResult> {
  const ids = normalizeSessionIds(Array.isArray(sessionIds) ? sessionIds : []);
  if (ids.length === 0) return { requested: 0, deleted: 0 };

  const profile = getActiveProfileNameSync();
  const conn = getDashboardConnection(profile);
  if (!conn) return deleteSessions(ids);

  const request: AgentRequest = (path, method) => {
    const url = new URL(path, "http://agent.invalid");
    if (profile && profile !== "default") url.searchParams.set("profile", profile);
    return dashboardRequestJson(conn.baseUrl, conn.token, `${url.pathname}${url.search}`, {
      method,
      timeoutMs: 60_000,
    });
  };

  // Children cascade with their parent inside the agent; read them first so
  // their desktop-owned rows are cleaned up afterwards too.
  const scope = sessionSubtreeIds(ids);
  for (const id of ids) {
    try {
      await deleteSessionThroughAgent(request, id);
    } catch (err) {
      // Reported through `failed` below: the row is still in state.db.
      console.error("[sessions] agent refused delete", id, err);
    }
  }
  return finishAgentSessionDelete(ids, scope);
}
