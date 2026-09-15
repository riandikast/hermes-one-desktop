// Time the REAL main-process reads (full vs id-scoped tail) on the target
// session, using the actual SQL the code path builds where possible.
//   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe \
//     scripts/_bench-main-read.mjs [sessionId] [dbPath]
import Database from "better-sqlite3";
import { existsSync } from "fs";

const HOME = process.env.HOME || process.env.USERPROFILE;
const SID = process.argv[2] || "20260815_004037_f049da";
const dbPath = process.argv[3] || `${HOME}/AppData/Local/hermes/state.db`;
if (!existsSync(dbPath)) {
  console.error(`db not found: ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });
const COLS = `id, role, content, timestamp, tool_call_id, tool_calls, tool_name,
              reasoning, reasoning_content, reasoning_details`;
const FULL = `SELECT ${COLS} FROM messages
  WHERE session_id = ? AND role IN ('user','assistant','tool')
  ORDER BY timestamp, id`;
const TAIL = `SELECT ${COLS} FROM messages
  WHERE id > ? AND session_id = ? AND role IN ('user','assistant','tool')
  ORDER BY timestamp, id`;

function timeIt(label, fn, iters = 30) {
  fn();
  const t = [];
  for (let i = 0; i < iters; i++) {
    const a = process.hrtime.bigint();
    fn();
    t.push(Number(process.hrtime.bigint() - a) / 1e6);
  }
  t.sort((x, y) => x - y);
  console.log(
    `${label.padEnd(40)} med=${t[Math.floor(iters / 2)].toFixed(1)} ms  min=${t[0].toFixed(1)}  max=${t[iters - 1].toFixed(1)}`,
  );
  return t[Math.floor(iters / 2)];
}

const fullStmt = db.prepare(FULL);
const tailStmt = db.prepare(TAIL);
const maxId = db.prepare("SELECT MAX(id) m FROM messages WHERE session_id = ?").get(SID).m;
const rowCount = db.prepare("SELECT COUNT(*) n FROM messages WHERE session_id = ?").get(SID).n;
console.log(`\nmain-process reads on session ${SID}: rows=${rowCount} maxId=${maxId}`);

const full = timeIt("BEFORE: full read (session_id=?)", () => fullStmt.all(SID));
const tail = timeIt("AFTER:  tail read (id > maxId)", () => tailStmt.all(SID, maxId));
console.log(`\nmain-process read: BEFORE=${full.toFixed(1)} ms  AFTER=${tail.toFixed(1)} ms  speedup=${(full / Math.max(tail, 0.001)).toFixed(0)}x`);
db.close();
