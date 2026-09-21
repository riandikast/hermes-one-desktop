// Renders REAL tool results from state.db through the actual formatter, so the
// output can be eyeballed against what the user complained about.
import { execFileSync } from "node:child_process";
import { formatToolResult } from "../src/renderer/src/screens/Chat/toolResultFormat.ts";

const DB = "C:/Users/riand/AppData/Local/hermes/state.db";
const q = (tool) =>
  execFileSync(
    "python",
    [
      "-c",
      `import sqlite3,json;c=sqlite3.connect("file:${DB}?mode=ro",uri=True);` +
        `print(json.dumps([r[0] for r in c.execute("SELECT content FROM messages WHERE role='tool' AND tool_name=? ORDER BY id DESC LIMIT 1",("${tool}",)).fetchall()]))`,
    ],
    { encoding: "utf8", maxBuffer: 1e8 },
  );

for (const tool of ["skill_manage", "todo", "search_files", "terminal", "Bash"]) {
  let rows;
  try {
    rows = JSON.parse(q(tool));
  } catch {
    continue;
  }
  if (!rows || rows.length === 0) continue;
  console.log("\n" + "=".repeat(72));
  console.log("TOOL:", tool);
  const r = formatToolResult(rows[0]);
  console.log(`  ${r.title}${r.meta.length ? "  [" + r.meta.join(" | ") + "]" : ""}`);
  for (const s of r.sections) {
    console.log(`  --- ${s.label} (${s.language})`);
    console.log(
      s.body
        .split("\n")
        .slice(0, 12)
        .map((l) => "      " + l)
        .join("\n"),
    );
  }
}
