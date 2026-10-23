import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
const prepare = vi.hoisted(() => vi.fn());
vi.mock("../src/main/db", () => ({ getDbConnection: () => ({ prepare }) }));
import { buildSessionHistorySearchQuery, searchSessionHistory } from "../src/main/sessions";
describe("session literal search", () => {
  it("executes canonical search SQL against synthetic in-memory SQLite, never the user's DB", () => {
    const read = buildSessionHistorySearchQuery("s", "needle");
    const output = execFileSync("python", ["-c", `import sqlite3,json,sys
q=json.loads(sys.argv[1]); db=sqlite3.connect(':memory:')
db.execute('CREATE TABLE messages(id INTEGER, session_id TEXT, role TEXT, content TEXT, timestamp REAL, tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, reasoning TEXT, reasoning_content TEXT, reasoning_details TEXT, active INTEGER, compacted INTEGER)')
for row in [(1,'s','user','needle',1,1,0),(2,'s','user','needle',1,0,1),(3,'s','user','needle archived',2,0,0),(4,'other','user','needle',3,1,0),(9000,'s','assistant','needle needle',4,1,0)]:
 db.execute('INSERT INTO messages(id,session_id,role,content,timestamp,active,compacted) VALUES(?,?,?,?,?,?,?)',row)
print(json.dumps([r[0] for r in db.execute(q['sql'],q['params'])]))`, JSON.stringify(read)], { encoding: "utf8" });
    expect(JSON.parse(output)).toEqual([2, 9000]);
  });
  it("binds literal wildcard input, canonical visibility and ordering; Unicode cannot be lost by SQLite LOWER", () => {
    const read = buildSessionHistorySearchQuery("session", "100%_\\");
    expect(read.sql).toContain("m.active = 1 OR m.compacted = 1");
    expect(read.sql).toContain("NOT EXISTS");
    expect(read.sql).toContain("ORDER BY m.timestamp, m.id");
    expect(read.params).toEqual(["session", "%100\\%\\_\\\\%", "%100\\%\\_\\\\%", "%100\\%\\_\\\\%", 0]);
    expect(buildSessionHistorySearchQuery("s", "É").params.at(-1)).toBe(1);
  });
  it("streams old candidates and strips images without reading the whole transcript array", () => {
    prepare.mockReturnValue({ iterate: () => [
      { id: 1, role: "assistant", timestamp: 1, content: "needle needle", reasoning: null, reasoning_content: null, reasoning_details: null, tool_calls: null },
      { id: 9000, role: "user", timestamp: 9000, content: '\u0000json:[{"type":"text","text":"needle"},{"type":"image_url","image_url":"data:image/png;base64,AA=="}]' },
      { id: 9001, role: "user", timestamp: 9001, content: "not a match" },
    ] });
    const rows = searchSessionHistory("s", "needle");
    expect(rows.map(row => row.id)).toEqual([1, 9000]);
    expect(rows.every(row => !("attachments" in row))).toBe(true);
    expect(prepare).toHaveBeenCalledOnce();
  });
});
