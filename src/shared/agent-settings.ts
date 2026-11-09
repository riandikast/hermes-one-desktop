/** Curated official desktop controls, pinned to upstream 2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19. */
export interface AgentSettingsField {
  key: string;
  label: string;
  group: string;
  type: "boolean" | "number" | "string" | "list" | "select";
  defaultValue: string;
  min?: number;
  max?: number;
  step?: number;
  nullable?: boolean;
  options?: string[];
  hint?: string;
}

export const MEMORY_SETTINGS: readonly AgentSettingsField[] = [
  { key: "memory.memory_enabled", label: "Persistent Memory", group: "persistent", type: "boolean", defaultValue: "true", hint: "Inject MEMORY.md into new sessions. External provider recall is a separate layer." },
  { key: "memory.user_profile_enabled", label: "User Profile", group: "persistent", type: "boolean", defaultValue: "true", hint: "Inject USER.md preferences into new sessions." },
  { key: "memory.memory_char_limit", label: "Memory Character Limit", group: "persistent", type: "number", defaultValue: "2200", min: 1 },
  { key: "memory.user_char_limit", label: "User Profile Character Limit", group: "persistent", type: "number", defaultValue: "1375", min: 1 },
  { key: "memory.provider", label: "Memory Provider", group: "persistent", type: "select", defaultValue: "", hint: "One external provider adds recall alongside built-in memory. Saving a provider does not install or authenticate it." },
  { key: "memory.write_approval", label: "Approve Memory Writes", group: "persistent", type: "boolean", defaultValue: "false", hint: "Ask before a turn writes built-in memory; background writes are staged for review." },
  { key: "memory.prefetch_spill_enabled", label: "External Recall Spill", group: "persistent", type: "boolean", defaultValue: "false", hint: "Let an external provider spill recalled context to hook output instead of the prompt." },
  { key: "memory.nudge_interval", label: "Memory Review Interval", group: "persistent", type: "number", defaultValue: "10", min: 0, hint: "Turns between built-in memory reviews. 0 disables the periodic nudge." },
  { key: "context.engine", label: "Context Engine", group: "context", type: "select", defaultValue: "compressor", options: ["compressor", "default", "custom"], hint: "Strategy for managing long conversations near the context limit. Plugin engines must already be installed." },
  { key: "compression.enabled", label: "Auto-Compression", group: "context", type: "boolean", defaultValue: "true" },
  { key: "compression.threshold", label: "Compression Threshold", group: "context", type: "number", defaultValue: "0.5", min: 0.01, max: 1, step: 0.01, hint: "Fraction of the context window. The backend may raise this for small windows or supported Codex models." },
  { key: "compression.codex_gpt55_autoraise", label: "Codex Compression Auto-Raise", group: "context", type: "boolean", defaultValue: "true", hint: "Raise compression to 85% for supported ChatGPT Codex OAuth models." },
  { key: "compression.tail_mode", label: "Retained Tail Mode", group: "context", type: "select", defaultValue: "lean", options: ["lean", "legacy"], hint: "Lean keeps a small token-bounded tail with digests; legacy keeps 20% of the threshold verbatim." },
  { key: "compression.target_ratio", label: "Compression Target Ratio", group: "context", type: "number", defaultValue: "0.2", min: 0.01, max: 1, step: 0.01, hint: "Fraction of the compression threshold preserved as recent context." },
  { key: "compression.protect_last_n", label: "Protected Recent Messages", group: "context", type: "number", defaultValue: "20", min: 0 },
  { key: "auxiliary.compression.timeout", label: "Compression Model Timeout (s)", group: "context", type: "number", defaultValue: "120", min: 1 },
  { key: "compression.threshold_tokens", label: "Compression Token Ceiling", group: "context", type: "number", defaultValue: "", min: 1, nullable: true, hint: "Optional absolute cap; blank uses the backend ratio policy. Shared with the chat context popover." },
];

export const ADVANCED_SETTINGS: readonly AgentSettingsField[] = [
  { key: "updates.non_interactive_local_changes", label: "Local Changes During Updates", group: "desktop", type: "select", defaultValue: "stash", options: ["stash", "discard"], hint: "Stash preserves local backend source edits. Discard permanently removes them during non-interactive updates; terminal updates still ask." },
  { key: "agent.max_turns", label: "Maximum Iterations", group: "runtime", type: "number", defaultValue: "", min: 1, nullable: true, hint: "Maximum tool-calling iterations per conversation turn. Blank means unlimited." },
  { key: "agent.api_max_retries", label: "API Retry Attempts", group: "runtime", type: "number", defaultValue: "3", min: 1 },
  { key: "agent.service_tier", label: "Service Tier", group: "runtime", type: "select", defaultValue: "", options: ["", "normal", "fast", "auto", "cold"], hint: "Fast always, auto for the first part of a turn, cold for the first turn only. Provider support and billing vary." },
  { key: "toolsets", label: "Enabled Toolsets", group: "tools", type: "list", defaultValue: '["hermes-cli"]', hint: "Comma-separated toolset names. Clearing all disables memory, terminal, web search, delegation and most tools." },
  { key: "agent.tool_use_enforcement", label: "Tool Use Enforcement", group: "tools", type: "string", defaultValue: "auto", hint: "auto, true, false, or a JSON array of model-name substrings." },
  { key: "terminal.backend", label: "Terminal Backend", group: "terminal", type: "select", defaultValue: "local", options: ["local", "docker", "singularity", "modal", "daytona", "ssh"], hint: "Remote/container backends require their own installed runtime and credentials." },
  { key: "terminal.timeout", label: "Terminal Timeout (s)", group: "terminal", type: "number", defaultValue: "180", min: 1 },
  { key: "terminal.docker_image", label: "Docker Image", group: "terminal", type: "string", defaultValue: "nousresearch/hermes-sandbox:desktop" },
  { key: "terminal.singularity_image", label: "Singularity Image", group: "terminal", type: "string", defaultValue: "", hint: "Only used by backends that support this legacy setting." },
  { key: "terminal.modal_image", label: "Modal Image", group: "terminal", type: "string", defaultValue: "nousresearch/hermes-sandbox:desktop" },
  { key: "terminal.daytona_image", label: "Daytona Image", group: "terminal", type: "string", defaultValue: "nousresearch/hermes-sandbox:desktop" },
  { key: "tool_output.max_bytes", label: "Maximum Tool Output Characters", group: "output", type: "number", defaultValue: "50000", min: 1, hint: "Despite the key name, terminal output is capped in characters, retaining head and tail." },
  { key: "tool_output.max_lines", label: "Maximum File Read Lines", group: "output", type: "number", defaultValue: "2000", min: 1 },
  { key: "tool_output.max_line_length", label: "Maximum Line Length", group: "output", type: "number", defaultValue: "2000", min: 1 },
  { key: "checkpoints.max_snapshots", label: "Maximum Checkpoint Snapshots", group: "output", type: "number", defaultValue: "20", min: 1 },
];

/** Tab order mirrors the official subpages; the pane renders them as segmented tabs. */
export const SETTINGS_TABS: Record<
  "memory" | "advanced",
  ReadonlyArray<{ id: string; label: string }>
> = {
  memory: [
    { id: "persistent", label: "Memory" },
    { id: "context", label: "Context" },
  ],
  advanced: [
    { id: "desktop", label: "Desktop" },
    { id: "runtime", label: "Runtime" },
    { id: "tools", label: "Tools" },
    { id: "terminal", label: "Terminal" },
    { id: "output", label: "Output" },
  ],
};

/** Only these settings get native YAML scalar types; unrelated config writes retain their contract. */
export function agentSettingsScalar(key: string, value: string): string | undefined {
  const field = [...MEMORY_SETTINGS, ...ADVANCED_SETTINGS].find((entry) => entry.key === key);
  if (!field) return undefined;
  if (/[\0\r\n]/.test(value)) throw new Error("Settings values must be single-line strings.");
  if (field.type === "boolean") {
    if (value !== "true" && value !== "false") throw new Error("Expected true or false.");
    return value;
  }
  if (field.type === "number") {
    if (field.nullable && value === "null") return value;
    if (key === "compression.threshold_tokens" && !/^[1-9]\d*$/.test(value)) throw new Error("Compression token ceiling must be a positive integer or null.");
    const n = Number(value);
    if (!value.trim() || !Number.isFinite(n) || (field.step === undefined && !Number.isSafeInteger(n)) ||
      (field.min !== undefined && n < field.min) || (field.max !== undefined && n > field.max)) {
      throw new Error(`Invalid value for ${key}.`);
    }
    return String(n);
  }
  // Preserve provider/plugin-specific strings accepted by the generic config API.
  // The picker limits new choices; stored values must remain round-trippable.
  if (field.type === "list" || (key === "agent.tool_use_enforcement" && value.startsWith("["))) {
    const list: unknown = JSON.parse(value);
    if (!Array.isArray(list) || list.some((item) => typeof item !== "string" || /[\0\r\n]/.test(item))) {
      throw new Error("Expected a JSON array of names.");
    }
    return JSON.stringify(list);
  }
  if (key === "agent.tool_use_enforcement" && (value === "true" || value === "false")) return value;
  return JSON.stringify(value);
}
