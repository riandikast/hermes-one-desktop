import { randomUUID } from "crypto";

/** One request against a Hermes dashboard API (local or remote); rejects with
 *  `"<status>: <body>"` on HTTP errors, like `dashboardRequestJson`. */
export type AgentRequest = (path: string, method: "GET" | "DELETE") => Promise<unknown>;

interface MutationSnapshot {
  exists: boolean;
  runtime_revision: number;
  runtime_generation: number | null;
}

/** The route itself is missing (an agent older than the mutation fence), not
 *  the session: FastAPI answers `{"detail":"Not Found"}` for unknown routes. */
function isMissingRoute(err: unknown): boolean {
  return /^404: .*"Not Found"/.test(err instanceof Error ? err.message : String(err));
}

/**
 * Delete one session the way the agent's own clients do.
 *
 * The agent never commits an unfenced write: `DELETE /api/sessions/{id}`
 * needs the session's current revision (read from `mutation-snapshot`) and a
 * fresh request id, and is answered by whichever runtime owns the profile —
 * including a running gateway, which is what made the exclusive-maintenance
 * bulk route refuse with 409. Agents that predate the fence have no snapshot
 * route and take the plain delete. An already-absent session is success.
 */
export async function deleteSessionThroughAgent(request: AgentRequest, sessionId: string): Promise<void> {
  const path = `/api/sessions/${encodeURIComponent(sessionId)}`;
  let snapshot: MutationSnapshot;
  try {
    snapshot = (await request(`${path}/mutation-snapshot`, "GET")) as MutationSnapshot;
  } catch (err) {
    if (!isMissingRoute(err)) throw err;
    await request(path, "DELETE");
    return;
  }
  if (!snapshot?.exists) return;
  const identity = new URLSearchParams({
    request_id: randomUUID(),
    expected_revision: String(snapshot.runtime_revision ?? 0),
  });
  if (snapshot.runtime_generation != null) {
    identity.set("expected_generation", String(snapshot.runtime_generation));
  }
  await request(`${path}?${identity}`, "DELETE");
}
