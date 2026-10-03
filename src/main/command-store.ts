import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { HERMES_HOME } from "./installer";

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
  /** Optional folder grouping; empty string = ungrouped. */
  folder: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Resolve the commands file. The explicit override and `HERMES_HOME` win;
 * otherwise this uses the SAME home the rest of the app does (`./installer`),
 * which honors the persisted override and the Windows `%LocalAppData%\hermes`
 * default. Deriving a private `~/.hermes` fallback here silently pointed the
 * picker at a file that does not exist on Windows, so every `/` template list
 * came back empty and the saved working directory was never applied.
 */
function commandsFilePath(homeOverride?: string): string {
  const base = homeOverride?.trim() || process.env.HERMES_HOME?.trim() || HERMES_HOME;
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
