// Extract REAL HistoryItem rows for the bench session to a temp JSON file so
// the renderer benchmark runs under plain vitest (no Electron native module).
//   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe \
//     scripts/_bench-extract-rows.mjs [sessionId] [dbPath]
import Database from "better-sqlite3";
import { writeFileSync } from "fs";
import { existsSync } from "fs";

const HOME = process.env.HOME || process.env.USERPROFILE;
const SID = process.argv[2] || "20260815_004037_f049da";
const dbPath =
  process.argv[3] || `${HOME}/AppData/Local/hermes/state.db`;

if (!existsSync(dbPath)) {
  console.error(`db not found: ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });
const rows = db
  .prepare(
    `SELECT id, role, content, timestamp, tool_call_id, tool_calls, tool_name,
            reasoning, reasoning_content, reasoning_details
     FROM messages
     WHERE session_id = ? AND role IN ('user','assistant','tool')
     ORDER BY timestamp, id`,
  )
  .all(SID);
db.close();

const items = [];
for (const r of rows) {
  const content = r.content || "";
  if (r.role === "user") {
    if (!content) continue;
    items.push({ kind: "user", id: r.id, content, timestamp: r.timestamp });
  } else if (r.role === "assistant") {
    const reasoning = r.reasoning || r.reasoning_content || "";
    if (reasoning)
      items.push({ kind: "reasoning", id: r.id, assistantId: r.id, text: reasoning, timestamp: r.timestamp });
    if (content)
      items.push({ kind: "assistant", id: r.id, content, timestamp: r.timestamp });
    let calls = [];
    try {
      const parsed = JSON.parse(r.tool_calls || "[]");
      if (Array.isArray(parsed)) calls = parsed;
    } catch {}
    for (const tc of calls) {
      items.push({
        kind: "tool_call",
        id: r.id,
        assistantId: r.id,
        callId: tc.id || "",
        name: tc?.function?.name || tc?.name || "tool",
        args: tc?.function?.arguments || "",
        timestamp: r.timestamp,
      });
    }
  } else {
    items.push({
      kind: "tool_result",
      id: r.id,
      callId: r.tool_call_id || "",
      name: r.tool_name || "tool",
      content,
      timestamp: r.timestamp,
    });
  }
}

const out = `${HOME}/AppData/Local/Temp/_bench-history-${SID}.json`;
writeFileSync(out, JSON.stringify(items));
console.log(`wrote ${items.length} HistoryItems to ${out}`);
