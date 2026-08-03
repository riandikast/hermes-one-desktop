import { mkdir, readFile, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

export interface CommandRecord {
  id: string;
  /** Display name shown in the Command list. */
  name: string;
  /** The command itself — may be multi-line (run via a temp script). */
  command: string;
  /** Optional free-text description. */
  description: string;
  /** Optional working directory the command runs in. */
  cwd: string;
  createdAt: number;
  updatedAt: number;
}

function commandsFilePath(homeOverride?: string): string {
  const base =
    homeOverride || process.env.HERMES_HOME || join(homedir(), ".hermes");
  return join(base, "commands.json");
}

export async function listCommands(
  homeOverride?: string,
): Promise<CommandRecord[]> {
  try {
    const raw = await readFile(commandsFilePath(homeOverride), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CommandRecord[]) : [];
  } catch {
    return [];
  }
}

async function writeCommands(
  records: CommandRecord[],
  homeOverride?: string,
): Promise<void> {
  const file = commandsFilePath(homeOverride);
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, JSON.stringify(records, null, 2), "utf8");
}

export async function saveCommand(
  record: CommandRecord,
  homeOverride?: string,
): Promise<CommandRecord> {
  const all = await listCommands(homeOverride);
  const idx = all.findIndex((r) => r.id === record.id);
  const now = Date.now();
  const next: CommandRecord = {
    ...record,
    createdAt: idx >= 0 ? all[idx].createdAt : record.createdAt || now,
    updatedAt: now,
  };
  if (idx >= 0) all[idx] = next;
  else all.push(next);
  await writeCommands(all, homeOverride);
  return next;
}

export async function deleteCommand(
  id: string,
  homeOverride?: string,
): Promise<boolean> {
  const all = await listCommands(homeOverride);
  const next = all.filter((r) => r.id !== id);
  if (next.length === all.length) return false;
  await writeCommands(next, homeOverride);
  return true;
}
