import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const dir = await mkdtemp(join(tmpdir(), "resource-queue-test-"));
const queue = fileURLToPath(new URL("./resource-queue.mjs", import.meta.url));
const log = join(dir, "events");
const job = join(dir, "job.mjs");
function run(id, code = 0) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [queue, job, log, id, String(code)], { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", resolve);
  });
}
try {
  await writeFile(job, `import { appendFileSync } from 'node:fs';
const [log,id,code] = process.argv.slice(2);
appendFileSync(log, id+' start\\n');
setTimeout(() => { appendFileSync(log,id+' end\\n'); process.exit(Number(code)); }, 300);
`);
  assert.deepEqual(await Promise.all([run("a"), run("b")]), [0, 0]);
  const lines = (await readFile(log, "utf8")).trim().split("\n");
  assert.equal(lines[0].split(" ")[0], lines[1].split(" ")[0]);
  assert.equal(lines[2].split(" ")[0], lines[3].split(" ")[0]);
  assert.equal(await run("failure", 7), 7);
  assert.equal(await run("after-failure"), 0);
  console.log("PASS: concurrent jobs serialized; exit code retained; lock released after failure");
} finally { await rm(dir, { recursive: true, force: true }); }
