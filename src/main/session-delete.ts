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
 * admission/worker ledgers that reference a session with `ON DELETE
 * RESTRICT`, expands compression chains, and refuses rows a live turn owns.
 * The desktop's own SQL could do none of that, so deleting a conversation the
 * gateway had ever queued work for failed — and in a bulk delete that one row
 * rolled back every other selected conversation. The direct-SQL path remains
 * only for when no local dashboard is running (or it predates bulk-delete).
 */
export async function deleteLocalSessions(sessionIds: unknown): Promise<DeleteSessionsResult> {
  const ids = normalizeSessionIds(Array.isArray(sessionIds) ? sessionIds : []);
  if (ids.length === 0) return { requested: 0, deleted: 0 };

  const profile = getActiveProfileNameSync();
  const conn = getDashboardConnection(profile);
  if (!conn) return deleteSessions(ids);

  const scope = sessionSubtreeIds(ids);
  try {
    await dashboardRequestJson(conn.baseUrl, conn.token, "/api/sessions/bulk-delete", {
      method: "POST",
      body: { ids, profile },
      timeoutMs: 60_000,
    });
  } catch (err) {
    console.error("[sessions] agent bulk-delete unavailable, using direct delete", err);
    return deleteSessions(ids);
  }
  return finishAgentSessionDelete(ids, scope);
}
