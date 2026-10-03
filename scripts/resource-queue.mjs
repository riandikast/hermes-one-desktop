// ponytail: serializes opted-in Node jobs on this host, not arbitrary shell commands.
import net from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const [script, ...args] = process.argv.slice(2);
if (!script) throw new Error("Usage: resource-queue.mjs <node-script> [args...]");
const deadline = Date.now() + 30 * 60_000;
const lock = net.createServer((socket) => socket.destroy());
let announced = false;
for (;;) {
  try {
    await new Promise((ok, fail) => {
      const error = (err) => { lock.removeListener("listening", ready); fail(err); };
      const ready = () => { lock.removeListener("error", error); ok(); };
      lock.once("error", error);
      lock.once("listening", ready);
      lock.listen({ host: "127.0.0.1", port: 47839, exclusive: true });
    });
    break;
  } catch (error) {
    if (error.code !== "EADDRINUSE") throw error;
    if (Date.now() >= deadline) throw new Error("Resource queue timed out after 30 minutes");
    if (!announced) console.error("Waiting for another resource-queued job...");
    announced = true;
    await delay(500);
  }
}
// Keep the lock in the actual job process: no orphaned wrapper lock or stale file.
lock.unref();
process.argv = [process.execPath, resolve(script), ...args];
await import(pathToFileURL(resolve(script)).href);
