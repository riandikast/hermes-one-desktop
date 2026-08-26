import { useCallback, useEffect, useRef } from "react";
import { LOCAL_PRESETS } from "../../../constants";
import {
  isBubbleMessage,
  markActiveTurnFailed,
  normalizeMessageText,
} from "../chatMessages";
import {
  applyDashboardStreamEvent,
  type DashboardStreamEvent,
  WRITE_TOOL_NAMES,
} from "../dashboardEventAdapter";
import {
  extractToolPath,
  gitChangedDuringTurn,
  changedFilesFromToolRows,
  normalizePathKey,
} from "../fileChanges";
import {
  dbItemsToChatMessages,
  reconcileAfterDbRefresh,
  type DbHistoryItem,
} from "../sessionHistory";
import { DashboardGatewayClient } from "../dashboardGatewayClient";
import { executeSlash, type SlashExecOutcome } from "../slashExec";
import type { AgentCommandsCatalogResponse } from "../slash/types";
import type {
  ActiveTurn,
  Attachment,
  ChatMessage,
  FileChange,
  UsageState,
} from "../types";
import type { DesktopSessionContinuationItem } from "../../../../../shared/session-continuation";
import type { SessionModelOverride } from "../../../../../shared/model-override";

/** First non-empty string field among the given keys (mirrors the adapter's
 *  canonical payload keys — gateway events vary between them). */
function payloadText(
  payload: Record<string, unknown>,
  ...keys: string[]
): string {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

interface SessionResponse {
  info?: unknown;
  messages?: unknown[];
  message_count?: number;
  resumed?: string;
  session_id: string;
  stored_session_id?: string | null;
}

interface ModelOptionsResponse {
  model?: string;
  provider?: string;
  providers?: ModelOptionProvider[];
}

interface ModelOptionProvider {
  api_url?: string;
  base_url?: string;
  baseUrl?: string;
  is_current?: boolean;
  models?: string[];
  name?: string;
  slug: string;
}

interface SlashExecResponse {
  output?: string;
  warning?: string;
}

interface ImageAttachBytesResponse {
  attached?: boolean;
  message?: string;
  path?: string;
}

interface FileAttachResponse {
  attached?: boolean;
  message?: string;
  path?: string;
  ref_text?: string;
}

interface DashboardPromptClient {
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
}

interface EnsureDashboardRuntimeSessionParams {
  client: DashboardPromptClient;
  contextFolder?: string | null;
  excludeSeedUserId?: string | null;
  forceCreate?: boolean;
  messages: ReadonlyArray<ChatMessage>;
  profile?: string;
  storedSessionId?: string | null;
  /** Global knowledge bundle index injected as a system-role seed message so
   *  the agent sees it as context — never prepended to the user's prompt text
   *  (which would leak the system prompt into the visible user bubble). */
  knowledgeIndex?: string;
}

interface EnsureDashboardRuntimeSessionResult {
  created: boolean;
  runtimeSessionId: string;
  storedSessionId: string;
}

interface UseDashboardChatTransportArgs {
  activeTurnRef: React.MutableRefObject<ActiveTurn | null>;
  contextFolder: string | null;
  connectionMode: DashboardConnectionMode;
  enabled: boolean;
  fallbackOnUnavailable: boolean;
  hermesSessionId: string | null;
  messages: ChatMessage[];
  sessionModelOverrideRef?: React.MutableRefObject<SessionModelOverride | undefined>;
  model?: string;
  modelBaseUrl?: string;
  profile?: string;
  provider?: string;
  /** Global knowledge bundle names attached to this session. Their content
   *  index is prepended to each submitted prompt so the gateway-side agent
   *  can reference/update those files with its file tools. */
  knowledgeBundles?: string[];
  /** PLAN mode: inject a system-role instruction forbidding file mutations. */
  planMode?: boolean;
  /** Raw / minimal system prompt mode: suppresses default Hermes instructions. */
  rawSystemPrompt?: boolean;
  setHermesSessionId: (id: string) => void;
  setIsLoading: (loading: boolean) => void;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setToolProgress: (tool: string | null) => void;
  setUsage: React.Dispatch<React.SetStateAction<UsageState | null>>;
  /** Called once per connection when the dashboard transport is found to be
   *  unavailable on a remote/SSH connection and the renderer is falling back to
   *  the legacy HTTP transport. Lets the UI surface a one-time notice. */
  onDashboardUnavailable?: (reason: string) => void;
}

interface UseDashboardChatTransportResult {
  abort: () => void;
  enabled: boolean;
  sendMessage: (text: string, attachments?: Attachment[]) => Promise<boolean>;
  /**
   * Answer an inline clarify card (`clarify.respond`) over the live dashboard
   * WebSocket and resume the turn. Returns false when the gateway rejects the
   * answer (request already resolved / expired) so the card can surface an
   * error instead of falsely marking itself resolved.
   */
  respondClarify: (requestId: string, answer: string) => Promise<boolean>;
  /**
   * Un-send the last user turn: truncate the gateway's live history via
   * `session.undo` AND the renderer transcript (remove the last user message +
   * everything after). Returns false when the gateway rejects (e.g. a turn is
   * running — undo requires an idle session). The caller re-populates the
   * composer with the removed text for edit+resend.
   */
  undoLastUser: () => Promise<boolean>;
  /**
   * Run a slash command through the gateway's `slash.exec` pipeline instead of
   * submitting it to the model as a literal prompt. `sys` renders command
   * output into the transcript; a `send` outcome hands an agent prompt back to
   * the caller so it can run a normal streaming turn.
   */
  execSlash: (
    command: string,
    sys: (text: string) => void,
  ) => Promise<SlashExecOutcome>;
  getCommandCatalog: () => Promise<AgentCommandsCatalogResponse>;
  /**
   * Launch a background (`/btw`, `/bg`, `/background`) prompt via the gateway's
   * `prompt.background` RPC. It runs a separate agent concurrently with the
   * main turn — so it never blocks or queues — and the answer arrives later as
   * a `background.complete` event rendered into the transcript.
   */
  runBackground: (text: string) => Promise<{ taskId?: string; error?: string }>;
  /** Immediately persist a session-scoped model override via config.set RPC. */
  applyModelOverride: (provider: string, model: string) => Promise<void>;
}

interface DashboardSeedMessage {
  content: string;
  role: "assistant" | "system" | "user";
}

interface DashboardSeedOptions {
  excludeUserId?: string | null;
}

type DashboardConnectionMode = "local" | "remote" | "ssh";

export function dashboardChatEnabledFromEnv(
  value: string | undefined,
): boolean {
  return value !== "0" && value?.toLowerCase() !== "false";
}

export function dashboardChatEnabledForConnection(
  envValue: string | undefined,
  connectionModeLoaded: boolean,
  mode: "local" | "remote" | "ssh",
  preference: "auto" | "dashboard" | "legacy",
): boolean {
  if (!dashboardChatEnabledFromEnv(envValue) || !connectionModeLoaded) {
    return false;
  }
  if (preference === "legacy") return false;
  if (mode === "local") return true;
  if (mode === "remote") return true;
  return mode === "ssh";
}

export function dashboardShouldPersistLocalOverlays(
  _mode: DashboardConnectionMode,
): boolean {
  return true;
}

export function isDashboardSessionNotFoundError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /session not found/i.test(message);
}

export function isDashboardSlashWorkerExitError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /slash worker exited/i.test(message);
}

export async function submitDashboardPromptWithRecovery(
  client: DashboardPromptClient,
  params: {
    onRecoveredSessionId?: (sessionId: string) => void;
    sessionId: string;
    storedSessionId?: string | null;
    text: string;
    /** Scopes the turn to this profile on the UNIFIED machine dashboard. Without
     *  it, prompt.submit runs in the dashboard's launch profile (default), so a
     *  named profile's chat would answer as `default`. session create/resume
     *  already pass it; prompt.submit must too. */
    profile?: string;
    raw_system_prompt?: boolean;
  },
): Promise<string> {
  const profileParam =
    params.profile && params.profile !== "default"
      ? { profile: params.profile }
      : {};
  const rawParam =
    typeof params.raw_system_prompt === "boolean"
      ? { raw_system_prompt: params.raw_system_prompt }
      : {};
  try {
    await client.request("prompt.submit", {
      session_id: params.sessionId,
      text: params.text,
      ...profileParam,
      ...rawParam,
    });
    return params.sessionId;
  } catch (err) {
    if (!params.storedSessionId || !isDashboardSessionNotFoundError(err)) {
      throw err;
    }

    const resumed = await client.request<SessionResponse>("session.resume", {
      session_id: params.storedSessionId,
      ...profileParam,
    });
    const recoveredSessionId = resumed?.session_id;
    if (!recoveredSessionId) {
      throw err;
    }

    params.onRecoveredSessionId?.(recoveredSessionId);
    await client.request("prompt.submit", {
      session_id: recoveredSessionId,
      text: params.text,
      ...profileParam,
      ...rawParam,
    });
    return recoveredSessionId;
  }
}

export async function ensureDashboardRuntimeSession(
  params: EnsureDashboardRuntimeSessionParams,
): Promise<EnsureDashboardRuntimeSessionResult> {
  const cols = 96;
  const stored = params.forceCreate ? null : params.storedSessionId || null;

  if (stored) {
    try {
      const resumed = await params.client.request<SessionResponse>(
        "session.resume",
        {
          session_id: stored,
          cols,
          ...(params.profile ? { profile: params.profile } : {}),
        },
      );
      if (!resumed.session_id) {
        throw new Error("session.resume returned no session_id");
      }
      return {
        created: false,
        runtimeSessionId: resumed.session_id,
        storedSessionId: resumed.stored_session_id || resumed.resumed || stored,
      };
    } catch (err) {
      if (!isDashboardSessionNotFoundError(err)) {
        throw err;
      }
    }
  }

  const seedMessages = dashboardSeedMessagesFromTranscript(params.messages, {
    excludeUserId: params.excludeSeedUserId ?? null,
  });
  if (params.knowledgeIndex && params.knowledgeIndex.trim()) {
    seedMessages.unshift({
      role: "system",
      content: params.knowledgeIndex,
    });
  }
  const created = await params.client.request<SessionResponse>(
    "session.create",
    {
      cols,
      ...(seedMessages.length > 0 ? { messages: seedMessages } : {}),
      ...(params.contextFolder ? { cwd: params.contextFolder } : {}),
      ...(params.profile ? { profile: params.profile } : {}),
    },
  );

  return {
    created: true,
    runtimeSessionId: created.session_id,
    storedSessionId: created.stored_session_id || created.session_id,
  };
}

export function dashboardModelCommand(
  provider: string | undefined,
  model: string | undefined,
): string | null {
  if (!provider || provider === "auto" || !model) return null;
  return `/model ${model} --provider ${provider}`;
}

function normalizeBaseUrl(value: string | undefined): string {
  return (value || "").trim().replace(/\/+$/, "").toLowerCase();
}

function providerBaseUrl(provider: ModelOptionProvider): string {
  return provider.api_url || provider.base_url || provider.baseUrl || "";
}

function modelIsListedByProvider(
  provider: ModelOptionProvider,
  model: string,
): boolean {
  return (provider.models ?? []).some((candidate) => candidate === model);
}

function builtInProviderForCustomBaseUrl(
  requestedBaseUrl: string,
  requestedModel: string,
  live: ModelOptionsResponse | null | undefined,
): string | null {
  const normalizedBaseUrl = normalizeBaseUrl(requestedBaseUrl);
  if (!normalizedBaseUrl) return null;

  const preset = LOCAL_PRESETS.find(
    (candidate) => normalizeBaseUrl(candidate.baseUrl) === normalizedBaseUrl,
  );
  if (!preset) return null;

  const provider = (live?.providers ?? []).find(
    (candidate) => candidate.slug === preset.id,
  );
  if (!provider || !modelIsListedByProvider(provider, requestedModel)) {
    return null;
  }

  return preset.id;
}

function modelOptionsSummary(
  live: ModelOptionsResponse | null | undefined,
): string {
  const providers = live?.providers ?? [];
  const custom = providers
    .filter((provider) => provider.slug?.toLowerCase().startsWith("custom:"))
    .slice(0, 8)
    .map((provider) => {
      const models = (provider.models ?? []).slice(0, 3).join(", ");
      const modelSuffix = models ? ` models=[${models}]` : "";
      const url = normalizeBaseUrl(providerBaseUrl(provider));
      const urlSuffix = url ? ` url=${url}` : "";
      return `${provider.slug}${urlSuffix}${modelSuffix}`;
    });

  return custom.length ? custom.join("; ") : "no custom providers listed";
}

function base64FromDataUrl(dataUrl: string | undefined): string {
  if (!dataUrl) return "";
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : "";
}

function safeAttachmentFilename(
  name: string | undefined,
  index: number,
): string {
  const trimmed = (name || "").trim();
  return trimmed || `image-${index + 1}.png`;
}

function safeFileAttachmentName(attachment: Attachment, index: number): string {
  const trimmed = (attachment.name || "").trim();
  if (trimmed) return trimmed;
  return `attachment-${index + 1}`;
}

function base64EncodeUtf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function dashboardDataUrlForTextAttachment(
  attachment: Attachment,
): string | null {
  if (attachment.kind !== "text-file" || typeof attachment.text !== "string") {
    return null;
  }
  const mime = attachment.mime || "text/plain";
  return `data:${mime};base64,${base64EncodeUtf8(attachment.text)}`;
}

function dashboardAttachmentUnsupportedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /unknown method|method not found|not found|unsupported/i.test(message);
}

export function dashboardPromptTextForAttachments(
  text: string,
  attachments?: Attachment[],
): string | null {
  if (!attachments?.length) return text;
  const supported = attachments.every(
    (attachment) =>
      attachment.kind === "image" ||
      attachment.kind === "text-file" ||
      attachment.kind === "path-ref",
  );
  if (!supported) return null;
  const images = attachments.filter(
    (attachment) => attachment.kind === "image",
  );
  if (images.some((image) => !base64FromDataUrl(image.dataUrl))) return null;
  const files = attachments.filter((attachment) => attachment.kind !== "image");
  const hasAttachableFiles = files.every((attachment) => {
    if (attachment.kind === "text-file") {
      return typeof attachment.text === "string";
    }
    return attachment.kind === "path-ref" && !!attachment.path;
  });
  if (!hasAttachableFiles) return null;
  if (text.trim()) return text;
  return images.length > 0 ? "What do you see in this image?" : "";
}

export function dashboardPromptTextWithAttachmentRefs(
  text: string,
  refs: string[],
): string {
  return [refs.join("\n").trim(), text.trim()].filter(Boolean).join("\n\n");
}

export async function syncDashboardAttachmentsForSubmit(
  client: DashboardPromptClient,
  sessionId: string,
  attachments?: Attachment[],
): Promise<{ handled: boolean; refs: string[] }> {
  const images = (attachments ?? []).filter(
    (attachment) => attachment.kind === "image",
  );
  const files = (attachments ?? []).filter(
    (attachment) => attachment.kind !== "image",
  );
  if (images.length === 0 && files.length === 0) {
    return { handled: true, refs: [] };
  }

  let attachedCount = 0;
  for (let index = 0; index < images.length; index++) {
    const image = images[index];
    const contentBase64 = base64FromDataUrl(image.dataUrl);
    if (!contentBase64) return { handled: false, refs: [] };

    try {
      const result = await client.request<ImageAttachBytesResponse>(
        "image.attach_bytes",
        {
          session_id: sessionId,
          content_base64: contentBase64,
          filename: safeAttachmentFilename(image.name, index),
        },
      );
      if (!result?.attached) {
        throw new Error(result?.message || `Could not attach ${image.name}`);
      }
      attachedCount += 1;
    } catch (err) {
      if (attachedCount === 0 && dashboardAttachmentUnsupportedError(err)) {
        return { handled: false, refs: [] };
      }
      throw err;
    }
  }

  const refs: string[] = [];
  for (let index = 0; index < files.length; index++) {
    const attachment = files[index];
    const name = safeFileAttachmentName(attachment, index);
    const params: Record<string, unknown> = {
      session_id: sessionId,
      name,
    };

    if (attachment.kind === "text-file") {
      const dataUrl = dashboardDataUrlForTextAttachment(attachment);
      if (!dataUrl) return { handled: false, refs: [] };
      params.data_url = dataUrl;
    } else if (attachment.kind === "path-ref" && attachment.path) {
      params.path = attachment.path;
    } else {
      return { handled: false, refs: [] };
    }

    try {
      const result = await client.request<FileAttachResponse>(
        "file.attach",
        params,
      );
      if (!result?.attached || !result.ref_text) {
        throw new Error(result?.message || `Could not attach ${name}`);
      }
      refs.push(result.ref_text);
      attachedCount += 1;
    } catch (err) {
      if (attachedCount === 0 && dashboardAttachmentUnsupportedError(err)) {
        return { handled: false, refs: [] };
      }
      throw err;
    }
  }

  return { handled: true, refs };
}

export function resolveDashboardProviderForModel(
  requestedProvider: string | undefined,
  requestedModel: string | undefined,
  modelBaseUrl: string | undefined,
  live: ModelOptionsResponse | null | undefined,
): string | undefined {
  if (requestedProvider !== "custom" || !requestedModel) {
    return requestedProvider;
  }

  const providers = live?.providers ?? [];
  const requestedBaseUrl = normalizeBaseUrl(modelBaseUrl);
  const model = requestedModel.trim();

  if (requestedBaseUrl) {
    const builtInProvider = builtInProviderForCustomBaseUrl(
      modelBaseUrl || "",
      model,
      live,
    );
    if (builtInProvider) return builtInProvider;
  }

  const customProviders = providers.filter((provider) =>
    provider.slug?.toLowerCase().startsWith("custom:"),
  );

  if (requestedBaseUrl) {
    // Match ANY provider row on the requested endpoint — named user providers
    // from config.yaml `providers:` (e.g. the mirrored `hermesone` entry) as
    // well as legacy `custom:<name>` rows. Falling through to bare "custom"
    // is the failure mode this avoids: the agent resolves `--provider custom`
    // against the session's *current* base URL, so a session sitting on
    // another provider would send this model to the wrong endpoint (the
    // hermesone-swift → Nous-proxy 404).
    const baseMatches = providers.filter(
      (provider) =>
        !!provider.slug &&
        normalizeBaseUrl(providerBaseUrl(provider)) === requestedBaseUrl,
    );
    return (
      baseMatches.find((provider) => modelIsListedByProvider(provider, model))
        ?.slug ||
      baseMatches.find((provider) => provider.is_current)?.slug ||
      baseMatches[0]?.slug ||
      requestedProvider
    );
  }

  return (
    customProviders.find((provider) => modelIsListedByProvider(provider, model))
      ?.slug ||
    customProviders.find((provider) => provider.is_current)?.slug ||
    requestedProvider
  );
}

export function dashboardModelMatches(
  requestedProvider: string | undefined,
  requestedModel: string | undefined,
  live: ModelOptionsResponse | null | undefined,
): boolean {
  if (!requestedProvider || requestedProvider === "auto" || !requestedModel) {
    return true;
  }

  const liveProvider = (live?.provider || "").trim().toLowerCase();
  const liveModel = (live?.model || "").trim();
  const provider = requestedProvider.trim().toLowerCase();
  const model = requestedModel.trim();

  if (!liveProvider || !liveModel) return false;
  if (liveModel !== model) return false;
  if (liveProvider === provider) return true;

  // Named custom providers can be reported by Hermes Agent as custom:<slug>
  // while Hermes One's older model config still treats them as custom rows.
  return provider === "custom" && liveProvider.startsWith("custom:");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function payloadTextLength(
  payload: Record<string, unknown>,
  key: string,
): number {
  return typeof payload[key] === "string" ? payload[key].length : 0;
}

interface DashboardEventSummary {
  eventSessionId: string | null;
  hasUsage: boolean;
  payloadKeys: string[];
  reasoningLength: number;
  renderedLength: number;
  runtimeSessionId: string | null;
  status: "accepted" | "adopted" | "dropped";
  textLength: number;
  timestamp: string;
  type: string;
}

/** True when the current turn has a tool call that never received its
 *  result — a tool is legitimately in flight (possibly for minutes), so the
 *  stall watchdog must not fail the turn. */
function hasUnresolvedTool(messages: ReadonlyArray<ChatMessage>): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") break;
    const kind = (m as { kind?: string }).kind;
    if (kind === "tool_call") {
      const call = m as unknown as { callId?: string };
      let matched = false;
      for (let j = i + 1; j < messages.length; j++) {
        const n = messages[j];
        if (
          (n as { kind?: string }).kind === "tool_result" &&
          (n as unknown as { callId?: string }).callId === call.callId
        ) {
          matched = true;
          break;
        }
      }
      if (!matched) return true;
      continue;
    }
    if (kind === "reasoning" || kind === "tool_result" || kind === "clarify") {
      continue;
    }
    break;
  }
  return false;
}

declare global {
  interface Window {
    __HERMES_DASHBOARD_EVENTS__?: DashboardEventSummary[];
  }
}

function logDashboardEvent(
  event: DashboardStreamEvent,
  status: "accepted" | "adopted" | "dropped",
  runtimeSessionId: string | null,
): void {
  if (import.meta.env.VITE_HERMES_DESKTOP_DASHBOARD_EVENT_LOG !== "1") return;
  const payload = asRecord(event.payload);
  const summary: DashboardEventSummary = {
    timestamp: new Date().toISOString(),
    status,
    type: event.type,
    eventSessionId: event.session_id || null,
    runtimeSessionId,
    payloadKeys: Object.keys(payload).sort(),
    textLength: payloadTextLength(payload, "text"),
    renderedLength: payloadTextLength(payload, "rendered"),
    reasoningLength: payloadTextLength(payload, "reasoning"),
    hasUsage: !!payload.usage,
  };

  const events = window.__HERMES_DASHBOARD_EVENTS__ ?? [];
  events.push(summary);
  window.__HERMES_DASHBOARD_EVENTS__ = events.slice(-200);
  console.info("[Hermes dashboard event]", summary);
}

export function usageFromPayload(payload: unknown): Partial<UsageState> | null {
  const usage = asRecord(asRecord(payload).usage);
  // The Hermes gateway (`_get_usage` in tui_gateway/server.py) emits
  // snake-case, non-`_tokens` keys: input/output/prompt/completion/total plus
  // context_used/context_max/context_percent when the context compressor is
  // active. Older OpenAI-style payloads use prompt_tokens/promptTokens. Read
  // every spelling so the context gauge works regardless of which backend/
  // provider produced the usage record — no chars/4 estimate needed because
  // the gateway already reports exact counts.
  const promptTokens = Number(
    usage.input ??
      usage.prompt ??
      usage.prompt_tokens ??
      usage.promptTokens ??
      0,
  );
  const completionTokens = Number(
    usage.output ??
      usage.completion ??
      usage.completion_tokens ??
      usage.completionTokens ??
      0,
  );
  const totalTokens = Number(
    usage.total ??
      usage.total_tokens ??
      usage.totalTokens ??
      promptTokens + completionTokens,
  );
  // context_used = the current turn's prompt-token occupancy of the context
  // window (compressor's last_prompt_tokens), which is exactly what the gauge
  // wants — a live snapshot, not a cross-turn sum. Fall back to the latest
  // prompt count when the compressor hasn't reported yet.
  const contextUsed = Number(usage.context_used ?? 0);
  const contextMax = Number(usage.context_max ?? 0);
  if (!promptTokens && !completionTokens && !totalTokens && !contextUsed) {
    return null;
  }
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    contextTokens: contextUsed || promptTokens || undefined,
    contextWindowTokens: contextMax || undefined,
  };
}

function messageChars(message: ChatMessage): number {
  if ("content" in message) return message.content?.length ?? 0;
  switch (message.kind) {
    case "reasoning":
      return message.text.length;
    case "tool_call":
      return message.name.length + message.args.length;
    case "clarify":
      return message.question.length;
    default:
      return 0;
  }
}

/**
 * Rough context-occupancy estimate (~4 chars/token) from the transcript, used
 * as a last resort when the provider omits usage counts so the context gauge
 * still renders (it only shows when `contextTokens` is set — see Chat.tsx).
 *
 * `contextTokens` means the turn's PROMPT-side occupancy, and by the time
 * `message.complete` is handled the just-finished assistant reply has already
 * been reconciled into `messagesRef.current` — so the last assistant bubble
 * (specifically the bubble, not trailing tool/reasoning sub-rows, which were
 * part of the prompt loop) is subtracted back out.
 *
 * Inherently a floor: system prompt, tool schemas, and attachments aren't
 * visible to the renderer.
 */
export function estimateContextTokens(
  messages: ReadonlyArray<ChatMessage>,
): number {
  let totalChars = 0;
  let lastAssistantBubbleChars = 0;
  for (const message of messages) {
    const chars = messageChars(message);
    totalChars += chars;
    const isBubble = message.kind === undefined || message.kind === "assistant";
    if (message.role === "agent" && isBubble) {
      lastAssistantBubbleChars = chars;
    }
  }
  return Math.max(Math.round((totalChars - lastAssistantBubbleChars) / 4), 0);
}

export function completionFailed(payload: unknown): boolean {
  const row = asRecord(payload);
  const status = String(row.status || "").toLowerCase();
  if (status === "error" || status === "failed") return true;
  if (typeof row.error === "string" && row.error.trim()) return true;
  if (row.ok === false || row.success === false) return true;
  const text = String(row.text || row.rendered || "").trim();
  return /^(error:\s*)?(error code:\s*\d+|api call failed after \d+ retries|hermes dashboard did not switch\b)/i.test(
    text,
  );
}

function completionErrorMessage(payload: unknown): string {
  const row = asRecord(payload);
  const raw = String(row.error || row.text || row.rendered || "").trim();
  return raw.replace(/^error\s*:\s*/i, "") || "Hermes reported an error";
}

function userContentById(
  messages: ReadonlyArray<ChatMessage>,
  userId: string | null | undefined,
): string {
  if (!userId) return "";
  const message = messages.find(
    (candidate) =>
      isBubbleMessage(candidate) &&
      candidate.role === "user" &&
      candidate.id === userId,
  );
  return message && isBubbleMessage(message) ? message.content || "" : "";
}

function previousUserIdBefore(
  messages: ReadonlyArray<ChatMessage>,
  beforeIndex: number,
): string | null {
  for (let i = beforeIndex - 1; i >= 0; i--) {
    const message = messages[i];
    if (isBubbleMessage(message) && message.role === "user") return message.id;
    if (
      isBubbleMessage(message) &&
      message.role === "agent" &&
      !message.error
    ) {
      return null;
    }
  }
  return null;
}

export function dashboardSeedMessagesFromTranscript(
  messages: ReadonlyArray<ChatMessage>,
  options: DashboardSeedOptions = {},
): DashboardSeedMessage[] {
  const failedUserIds = new Set<string>();
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (isBubbleMessage(message) && message.role === "agent" && message.error) {
      const userId = previousUserIdBefore(messages, i);
      if (userId) failedUserIds.add(userId);
    }
  }

  const seed: DashboardSeedMessage[] = [];
  for (const message of messages) {
    if (!isBubbleMessage(message)) continue;
    if (message.role === "user" && message.id === options.excludeUserId)
      continue;
    if (message.localOnly || message.error || message.pending) continue;
    if (failedUserIds.has(message.id)) continue;
    const content = normalizeMessageText(message.content);
    if (!content) continue;
    seed.push({
      role: message.role === "agent" ? "assistant" : "user",
      content,
    });
  }
  return seed;
}

export function dashboardContinuationItemsFromTranscript(
  messages: ReadonlyArray<ChatMessage>,
  options: DashboardSeedOptions = {},
): DesktopSessionContinuationItem[] {
  const items: DesktopSessionContinuationItem[] = [];

  for (const message of messages) {
    if (isBubbleMessage(message)) {
      if (message.role === "user" && message.id === options.excludeUserId) {
        continue;
      }

      if (message.role === "user") {
        const content = message.content || "";
        if (!normalizeMessageText(content) && !message.attachments?.length) {
          continue;
        }
        items.push({
          kind: "user",
          content,
          ...(message.attachments?.length
            ? { attachments: message.attachments }
            : {}),
        });
        continue;
      }

      const content = message.content || "";
      const error = message.error || "";
      if (
        !normalizeMessageText(content) &&
        !normalizeMessageText(error) &&
        !message.attachments?.length
      ) {
        continue;
      }
      items.push({
        kind: "assistant",
        content,
        ...(error ? { error } : {}),
        ...(message.attachments?.length
          ? { attachments: message.attachments }
          : {}),
      });
      continue;
    }

    if (message.kind === "reasoning") {
      if (!normalizeMessageText(message.text)) continue;
      items.push({ kind: "reasoning", text: message.text });
      continue;
    }

    if (message.kind === "tool_call") {
      items.push({
        kind: "tool_call",
        callId: message.callId,
        name: message.name,
        args: message.args,
      });
      continue;
    }

    if (message.kind === "tool_result") {
      const content = message.content || "";
      if (!normalizeMessageText(content) && !message.attachments?.length) {
        continue;
      }
      items.push({
        kind: "tool_result",
        callId: message.callId,
        name: message.name,
        content,
        ...(message.attachments?.length
          ? { attachments: message.attachments }
          : {}),
      });
    }
  }

  return items;
}

export function useDashboardChatTransport({
  activeTurnRef,
  contextFolder,
  connectionMode,
  enabled,
  fallbackOnUnavailable,
  hermesSessionId,
  messages,
  model,
  modelBaseUrl,
  sessionModelOverrideRef,
  profile,
  provider,
  knowledgeBundles,
  planMode,
  rawSystemPrompt,
  setHermesSessionId,
  setIsLoading,
  setMessages,
  setToolProgress,
  setUsage,
  onDashboardUnavailable,
}: UseDashboardChatTransportArgs): UseDashboardChatTransportResult {
  const clientRef = useRef<DashboardGatewayClient | null>(null);
  const connectingRef = useRef<Promise<DashboardGatewayClient> | null>(null);
  const clientGenerationRef = useRef(0);
  // Sticky "dashboard transport can't connect on this remote/SSH connection"
  // flag. The dashboard WebSocket (`/api/ws`) never connects against a tunneled
  // `hermes gateway` (issue #667), so once we've learned it's unavailable we
  // fail `ensureClient` fast on every later message instead of re-running the
  // multi-second status+probe — letting the caller fall back to legacy HTTP
  // immediately. Reset on connection change (see the effect below).
  const dashboardUnavailableRef = useRef(false);
  const runtimeSessionIdRef = useRef<string | null>(null);
  const runtimeSessionPromiseRef = useRef<Promise<string> | null>(null);
  const storedSessionIdRef = useRef<string | null>(hermesSessionId);
  const messagesRef = useRef<ChatMessage[]>(messages);
  const modelRef = useRef(model);
  const modelBaseUrlRef = useRef(modelBaseUrl);
  const providerRef = useRef(provider);
  // Keep routing identity current during render. The picker can be followed by
  // an immediate send before React runs effects or publishes another render.
  messagesRef.current = messages;
  modelRef.current = model;
  modelBaseUrlRef.current = modelBaseUrl;
  providerRef.current = provider;
  const reasoningSegmentClosedRef = useRef(false);
  const rawSystemPromptRef = useRef(rawSystemPrompt);
  rawSystemPromptRef.current = rawSystemPrompt;
  const appliedModelRef = useRef<string | null>(null);
  const recreateRuntimeSessionRef = useRef(false);
  const lastRuntimeSessionWasCreatedRef = useRef(false);
  // Foreign-turn watcher bookkeeping (see the active_list poller effect):
  // whether we're mirroring a turn started by another client, the refresh
  // sequence guard, and the last LOCAL turn activity timestamp (a grace
  // window after a local turn ends prevents re-entering foreign mode while
  // the gateway still reports the session as working).
  const foreignTurnRef = useRef(false);
  const foreignRefreshSeqRef = useRef(0);
  const lastLocalActivityAtRef = useRef(0);
  // Delayed post-complete DB reconcile (intermediate answers) — cleared on
  // transport reset so it can't fire into a different session.
  const completeSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  // Per-turn file-change capture: path → latest before/after pair. Reset on
  // each new user turn; attached to the assistant bubble on message.complete.
  const fileChangesRef = useRef<Map<string, FileChange>>(new Map());
  // Working-tree snapshot taken at TURN START (path → status|after). At
  // finalize the current tree is compared against it so ONLY files the agent
  // actually modified THIS turn are reported — files that were already dirty
  // before the turn (pre-existing edits, line-ending churn) or merely READ
  // never appear as "changed by the agent".
  const gitSnapshotRef = useRef<Map<string, string> | null>(null);
  const pendingClarifyRequestIdRef = useRef<string | null>(null);
  const pendingRecoveredContinuationRef = useRef<
    DesktopSessionContinuationItem[]
  >([]);
  const lastSyncedCwdRef = useRef<string | null>(null);
  const knowledgeIndexRef = useRef<string>("");
  const planModeRef = useRef<boolean>(Boolean(planMode));
  useEffect(() => {
    planModeRef.current = Boolean(planMode);
  }, [planMode]);

  useEffect(() => {
    let cancelled = false;
    const bundles = knowledgeBundles ?? [];
    if (!enabled || bundles.length === 0) {
      knowledgeIndexRef.current = "";
      return;
    }
    void window.hermesAPI
      .getKnowledgeIndex(bundles)
      .then((index) => {
        if (!cancelled) knowledgeIndexRef.current = index;
      })
      .catch(() => {
        knowledgeIndexRef.current = "";
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, knowledgeBundles]);

  // Attached workspace folder → system-prompt index (like the knowledge
  // bundles): the model learns the folder's structure by DEFAULT, without
  // requiring an @mention tag in the message. Built once per session creation
  // (same single-shot limitation as the knowledge index).
  const folderIndexRef = useRef<string>("");
  useEffect(() => {
    let cancelled = false;
    const folder = contextFolder?.trim();
    if (!enabled || !folder) {
      folderIndexRef.current = "";
      return;
    }
    void window.hermesAPI
      .getFolderIndex([folder])
      .then((index) => {
        if (!cancelled) folderIndexRef.current = index ?? "";
      })
      .catch(() => {
        folderIndexRef.current = "";
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, contextFolder]);

  useEffect(() => {
    // `messagesRef` is the synchronous source of truth for `handleGatewayEvent`:
    // it reads the ref, applies a stream delta, writes the ref back, then calls
    // `setMessages`. Every `setMessages` in this hook stores that exact array in
    // the ref, so when React finally commits our own push, `messages` is the
    // very same reference and there is nothing to do. Re-syncing on that commit
    // is what dropped streaming chunks (#757): a second delta could land on an
    // older `messages` snapshot and reset the ref behind the deltas already
    // applied. Skip when the identity matches (our push); adopt any other array,
    // which can only come from Chat state changing underneath us — a new user
    // turn (grows), `handleClear` (`setMessages([])`, shrinks), or a clarify
    // card resolving in place (same length). A length check misses the last two.
    if (messages !== messagesRef.current) {
      messagesRef.current = messages;
    }
  }, [messages]);

  useEffect(() => {
    if (hermesSessionId === storedSessionIdRef.current) return;
    storedSessionIdRef.current = hermesSessionId;
    runtimeSessionIdRef.current = null;
    runtimeSessionPromiseRef.current = null;
    reasoningSegmentClosedRef.current = false;
    appliedModelRef.current = null;
    recreateRuntimeSessionRef.current = false;
    lastRuntimeSessionWasCreatedRef.current = false;
    pendingClarifyRequestIdRef.current = null;
    lastSyncedCwdRef.current = null;
    if (completeSyncTimerRef.current !== null) {
      clearTimeout(completeSyncTimerRef.current);
      completeSyncTimerRef.current = null;
    }
  }, [hermesSessionId]);

  useEffect(() => {
    appliedModelRef.current = null;
  }, [model, provider]);

  useEffect(() => {
    clientGenerationRef.current += 1;
    dashboardUnavailableRef.current = false;
    clientRef.current?.close();
    clientRef.current = null;
    connectingRef.current = null;
    runtimeSessionIdRef.current = null;
    runtimeSessionPromiseRef.current = null;
    reasoningSegmentClosedRef.current = false;
    appliedModelRef.current = null;
    recreateRuntimeSessionRef.current = false;
    lastRuntimeSessionWasCreatedRef.current = false;
    pendingClarifyRequestIdRef.current = null;
    pendingRecoveredContinuationRef.current = [];
    lastSyncedCwdRef.current = null;
    // Foreign-turn bookkeeping: re-baseline so a stale tail signature from a
    // previous session can't flag loading on the new one.
    foreignTurnRef.current = false;
    lastLocalActivityAtRef.current = Date.now();
  }, [connectionMode, profile]);

  // Turn stall watchdog: `prompt.submit` is only an ACK — the turn completes
  // via async `message.complete` notifications. If the provider/gateway stalls
  // after the ack (overload, dropped request), nothing ever completes and the
  // chat would show the typing indicator forever. Any accepted stream event
  // resets the timer; firing fails the turn with a clear error.
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const TURN_STALL_TIMEOUT_MS = 120_000;

  const clearStallTimer = useCallback((): void => {
    if (stallTimerRef.current !== null) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
  }, []);

  const resetStallTimer = useCallback((): void => {
    clearStallTimer();
    stallTimerRef.current = setTimeout(() => {
      stallTimerRef.current = null;
      const activeTurn = activeTurnRef.current;
      if (!activeTurn) return;
      // A TOOL may be legitimately running for a long time with no stream
      // events (multi-minute flutter build, slow network op). That is not a
      // stall — failing the turn here would flip isLoading false (spinner
      // disappears, interrupt→send) while the gateway is still working and
      // the transcript keeps streaming. Extend the deadline instead; the
      // user still has the interrupt button.
      if (hasUnresolvedTool(messagesRef.current)) {
        resetStallTimer();
        return;
      }
      const message =
        "No response from the model for 2 minutes — the provider may be " +
        "overloaded or the request was dropped. Send again to retry.";
      activeTurn.status = "failed";
      const failedMessages = markActiveTurnFailed(
        messagesRef.current,
        message,
        activeTurn,
      );
      messagesRef.current = failedMessages;
      setMessages(failedMessages);
      activeTurnRef.current = null;
      setToolProgress(null);
      setIsLoading(false);
      lastLocalActivityAtRef.current = Date.now();
    }, TURN_STALL_TIMEOUT_MS);
  }, [clearStallTimer, setMessages, setToolProgress, setIsLoading]);

  useEffect(() => clearStallTimer, [clearStallTimer]);

  // Quiet-finalize fallback: the gateway sometimes completes a turn WITHOUT
  // delivering `message.complete` (the renderer then never materializes the
  // final answer — with renderAssistantDeltas:false there is no streamed
  // partial either, so the answer only appears after a tab reopen re-reads
  // state.db). If the turn goes quiet for 10s while loading, pull the
  // canonical rows from state.db and reconcile them in — the same recovery
  // the legacy transport performs on `chat-done`. Only finalizes when the DB
  // actually shows a completed answer for the last turn; otherwise it re-arms
  // (a long-running tool or a slow model just pauses >10s).
  const quietFinalizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const QUIET_FINALIZE_MS = 10_000;
  // After the first quiet read, wait again and re-read before finalizing.
  // The gateway writes assistant rows INCREMENTALLY, and the transport renders
  // answer deltas with renderAssistantDeltas:false — so the answer text is
  // generated in TOTAL silence (no events to re-arm the timer), and a single
  // read cannot distinguish "partial answer, still generating" from
  // "complete". If the tail grew between the two reads, the turn is alive.
  const QUIET_FINALIZE_CONFIRM_MS = 4_000;

  // Signature of everything after the last user row — the answer region.
  // Any growth (or a new user message) changes it.
  const answerTailSignature = (msgs: ChatMessage[]): string => {
    let lastUserIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    return JSON.stringify(
      msgs.slice(lastUserIdx + 1).map((m) =>
        "kind" in m
          ? `k:${m.kind}`
          : `${m.role}:${String(m.content)}:${String(m.pending ?? "")}`,
      ),
    );
  };


  const clearQuietFinalize = useCallback((): void => {
    if (quietFinalizeTimerRef.current !== null) {
      clearTimeout(quietFinalizeTimerRef.current);
      quietFinalizeTimerRef.current = null;
    }
  }, []);


  // FOREIGN-TURN liveness is handled by the active_list poller (see the
  // foreign-turn watcher effect below).

  // Per-turn file-changes summary: merge the tool-event capture (paths from
  // write tools) with git working-tree detection (authoritative — catches
  // terminal writes and missed tools; before-content from the HEAD blob),
  // push a renderer-only `file_changes` chip row into the transcript (its own
  // row — independent of the answer bubble, so a missing answer can never
  // swallow the badge), and persist for reopen. Runs at message.complete and
  // the quiet-finalize recovery path.
  const finalizeFileChanges = useCallback((): void => {
    const captured = Array.from(fileChangesRef.current.values());
    console.info("[file-changes] captured", {
      toolPaths: captured.map((c) => c.path),
    });
    fileChangesRef.current = new Map();
    // NO early return on an empty tool capture: the git working-tree diff
    // below is the authoritative source (it catches terminal writes and
    // tools whose payload shape misses the capture heuristics). Skipping it
    // when the capture is empty made the chip silently disappear — the
    // "tracking broke" report.
    void (async () => {
      const byPath = new Map<string, FileChange>();
      // Merge helper: normalized (case-insensitive) keys so the same file
      // reported by different sources with different case/separators lands on
      // ONE row; first source wins per field, later sources fill gaps.
      const add = (path: string, entry: Partial<FileChange>): void => {
        const key = normalizePathKey(path);
        const existing = byPath.get(key);
        if (existing) {
          if (existing.before === null && entry.before !== undefined)
            existing.before = entry.before;
          if (existing.after === null && entry.after !== undefined)
            existing.after = entry.after;
          if (entry.beforeKnown) existing.beforeKnown = true;
          if (entry.removed && !existing.removed) existing.removed = entry.removed;
          if (entry.added && !existing.added) existing.added = entry.added;
          return;
        }
        byPath.set(key, {
          path,
          before: entry.before ?? null,
          after: entry.after ?? null,
          beforeKnown: entry.beforeKnown ?? false,
          removed: entry.removed,
          added: entry.added,
        });
      };

      // 1. Live stream capture (tool.start/tool.complete path heuristics).
      for (const c of captured) add(c.path, c);

      // 2. Transcript tool rows — the OFFICIAL derivation. Catches edits the
      //    stream capture missed (payload shapes) AND files that were already
      //    dirty before the turn, which the git diff below cannot attribute
      //    (its snapshot comparison deliberately excludes pre-existing dirt).
      const folder = contextFolder?.trim();
      const transcriptBaseDir =
        folder && folder.length > 0
          ? folder
          : (lastSyncedCwdRef.current?.trim() || null);
      let lastUserIdx = -1;
      for (let i = messagesRef.current.length - 1; i >= 0; i--) {
        if (messagesRef.current[i].role === "user") {
          lastUserIdx = i;
          break;
        }
      }
      const transcriptPaths = changedFilesFromToolRows(
        messagesRef.current,
        lastUserIdx + 1,
        transcriptBaseDir,
      );
      console.info("[file-changes] transcript", { transcriptPaths });
      for (const p of transcriptPaths) add(p, {});

      // 3. Git working-tree diff vs the turn-start snapshot (authoritative for
      //    terminal writes / missed captures).
      if (folder) {
        try {
          const gitList =
            await window.hermesAPI.getGitWorkingTreeChanges(folder);
          // Only include git entries whose state CHANGED during this turn:
          // compare against the turn-start snapshot. Files that were already
          // dirty before the turn (pre-existing edits, line-ending churn) or
          // only READ never appear — git status alone lists the whole dirty
          // tree, which falsely "changed" files the agent never touched.
          const snapshot = gitSnapshotRef.current;
          gitSnapshotRef.current = null;
          // No turn-start snapshot (race: turn finished before it loaded, or
          // no git) → can't tell what changed this turn; rely on the tool
          // sources only rather than reporting the whole dirty tree.
          if (snapshot) {
            const changedPaths = new Set(
              gitChangedDuringTurn(
                snapshot,
                gitList.map((g) => ({
                  path: g.path,
                  status: g.status,
                  after: g.after,
                })),
              ),
            );
            for (const g of gitList) {
              if (!changedPaths.has(g.path)) continue;
              add(g.path, {
                before: g.before ?? undefined,
                after: g.after ?? undefined,
                beforeKnown: true,
              });
            }
          }
        } catch {
          /* git detection optional — tool sources still apply */
        }
      }

      // 4. Fill after-content for entries still missing it (async reads —
      //    files that no longer exist stay null; deletions are kept only when
      //    the before is known).
      for (const c of byPath.values()) {
        if (c.after !== null) continue;
        try {
          const res = await window.hermesAPI.readFile(c.path);
          c.after = res?.content ?? null;
        } catch {
          c.after = null;
        }
      }
      const changes = Array.from(byPath.values()).filter(
        (c) => c.after !== null || c.before !== null,
      );
      if (changes.length === 0) return;
      const chip: ChatMessage = {
        id: `fc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        kind: "file_changes",
        role: "agent",
        changes,
      };
      const next = [...messagesRef.current, chip];
      messagesRef.current = next;
      setMessages(next);
      const storedSessionId = storedSessionIdRef.current;
      const record = window.hermesAPI.recordSessionFileChanges;
      if (
        dashboardShouldPersistLocalOverlays(connectionMode) &&
        storedSessionId &&
        typeof record === "function"
      ) {
        void record(storedSessionId, changes).catch(() => undefined);
      }
    })();
  }, [connectionMode, contextFolder, setMessages]);

  const resetQuietFinalize = useCallback((): void => {
    clearQuietFinalize();
    quietFinalizeTimerRef.current = setTimeout(() => {
      quietFinalizeTimerRef.current = null;
      const activeTurn = activeTurnRef.current;
      const storedSessionId = storedSessionIdRef.current;
      if (!activeTurn || !storedSessionId) return;
      void (async () => {
        try {
          console.info("[quiet-finalize] firing", {
            storedSessionId,
            isLoading: true,
          });
          const items = (await window.hermesAPI.getSessionMessages(
            storedSessionId,
          )) as DbHistoryItem[];
          const dbMessages = dbItemsToChatMessages(items);
          console.info("[quiet-finalize] db rows", {
            dbMessages: dbMessages.length,
            lastRoles: dbMessages
              .slice(-4)
              .map((m) =>
                "kind" in m
                  ? m.kind
                  : `${m.role}(len ${String(m.content).length})`,
              ),
          });
          // Guard: only finalize when state.db has CAUGHT UP to the live
          // transcript's last user message. If the user has already sent the
          // next message but it isn't persisted yet, reconciling now would
          // delete that message and resurrect the previous turn's canonical
          // answer — the "sent message vanished, old answer got fuller" bug.
          // The live/DB arrays are ChatMessage unions; only the user variant
          // carries role/content, so view them through a user-shaped lens for
          // the catch-up comparison (FileChangesMessage etc. have neither).
          type UserShaped = { role: string; content?: unknown };
          const liveLastUser = ([...messagesRef.current] as UserShaped[])
            .reverse()
            .find((m) => m.role === "user");
          const dbLastUser = ([...dbMessages] as UserShaped[])
            .reverse()
            .find((m) => m.role === "user");
          // Content match alone has a hole: sending the SAME message twice
          // matches while the DB only persisted the FIRST occurrence. Require
          // an equal user-message count so the DB must actually contain the
          // current turn's user row.
          const liveUserCount = messagesRef.current.filter(
            (m) => m.role === "user",
          ).length;
          const dbUserCount = dbMessages.filter(
            (m) => m.role === "user",
          ).length;
          const dbCaughtUp =
            !!liveLastUser &&
            !!dbLastUser &&
            liveUserCount === dbUserCount &&
            String(liveLastUser.content).replace(/\s+/g, " ").trim() ===
              String(dbLastUser.content).replace(/\s+/g, " ").trim();
          console.info("[quiet-finalize] dbCaughtUp", { dbCaughtUp });
          if (!dbCaughtUp) {
            // DB is behind the live transcript — keep waiting, do NOT touch
            // the messages.
            resetQuietFinalize();
            return;
          }
          // Completed = the last user turn is followed by an assistant bubble
          // with non-empty content.
          let lastUserIdx = -1;
          for (let i = dbMessages.length - 1; i >= 0; i--) {
            if (dbMessages[i].role === "user") {
              lastUserIdx = i;
              break;
            }
          }
          const hasAnswer =
            lastUserIdx >= 0 &&
            dbMessages
              .slice(lastUserIdx + 1)
              .some(
                (m) =>
                  m.role === "agent" &&
                  !("kind" in m) &&
                  String(m.content).trim().length > 0,
              );
          console.info("[quiet-finalize] hasAnswer", { hasAnswer });
          if (!hasAnswer) {
            // Turn still in flight (or never persisted) — keep waiting.
            resetQuietFinalize();
            return;
          }
          // STABILITY GATE: the first read passed, but the answer may still be
          // GROWING (incremental db writes during a silent generation). Re-read
          // after a short window; if the answer tail changed, the turn is
          // alive — re-arm (which also pushes the stall watchdog out, since
          // db growth is proof the gateway is working).
          const firstSig = answerTailSignature(dbMessages);
          console.info("[quiet-finalize] answer sig len", firstSig.length);
          await new Promise((resolve) =>
            setTimeout(resolve, QUIET_FINALIZE_CONFIRM_MS),
          );
          const confirmItems = (await window.hermesAPI.getSessionMessages(
            storedSessionId,
          )) as DbHistoryItem[];
          const confirmMessages = dbItemsToChatMessages(confirmItems);
          const confirmSig = answerTailSignature(confirmMessages);
          if (confirmSig !== firstSig) {
            console.info(
              "[quiet-finalize] answer grew during confirm window — still generating, re-arm",
            );
            resetQuietFinalize();
            resetStallTimer();
            return;
          }
          messagesRef.current = reconcileAfterDbRefresh(
            messagesRef.current,
            confirmMessages,
            { activeTurn },
          );
          setMessages(messagesRef.current);
          activeTurnRef.current = null;
          setToolProgress(null);
          setIsLoading(false);
          lastLocalActivityAtRef.current = Date.now();
              // FILE-CHANGES: emit the summary chip (lost message.complete must
          // not lose the badge either).
          finalizeFileChanges();
        } catch {
          resetQuietFinalize();
        }
      })();
    }, QUIET_FINALIZE_MS);
  }, [
    clearQuietFinalize,
    finalizeFileChanges,
    resetStallTimer,
    setMessages,
    setToolProgress,
    setIsLoading,
  ]);

  useEffect(() => {
    clearQuietFinalize();
    if (completeSyncTimerRef.current !== null) {
      clearTimeout(completeSyncTimerRef.current);
      completeSyncTimerRef.current = null;
    }
  }, [clearQuietFinalize]);

  // Pull the canonical rows for THIS session and reconcile them in live,
  // flagging loading when the tail is growing under a foreign writer. Runs on
  // every sessions.changed broadcast (the gateway's change watcher fires it
  // when the shared state.db mtime moves — any process's writes included).

  const handleGatewayEvent = useCallback(
    (event: DashboardStreamEvent): void => {
      const runtimeSessionId = runtimeSessionIdRef.current;
      if (
        event.session_id &&
        runtimeSessionId &&
        event.session_id !== runtimeSessionId
      ) {
        // Auto-compact (or another gateway-initiated session switch) can move
        // the conversation to a NEW runtime session mid-turn while keeping the
        // same STORED (canonical) session id. Adopt it so the live view keeps
        // streaming — otherwise every post-switch event is dropped and the
        // turn freezes until a session reopen shows the progress from state.db.
        if (event.session_id === storedSessionIdRef.current) {
          logDashboardEvent(event, "adopted", runtimeSessionId);
          runtimeSessionIdRef.current = event.session_id;
        } else {
          logDashboardEvent(event, "dropped", runtimeSessionId);
          return;
        }
      }
      logDashboardEvent(event, "accepted", runtimeSessionId);
      // Any accepted event = the turn is alive; push the stall deadline out.
      resetStallTimer();
      // Also re-arm the quiet-finalize fallback (fires if NO further events
      // arrive for 10s — a lost message.complete).
      resetQuietFinalize();

      // Change-watcher broadcast: the shared state.db mtime moved — a write
      // from ANY process (this gateway's stream, another desktop app, a cron
      // run, a messaging platform). Drives foreign-turn liveness for this
      // session; nothing else to apply from the broadcast itself.
      // Change-watcher broadcast: the shared state.db mtime moved — a write
      // from ANY process (this gateway's stream, another desktop app, a cron
      // run, a messaging platform). Foreign-turn liveness is handled by the
      // active_list poller (see the foreign-turn watcher effect); nothing
      // else to apply from the broadcast itself.
      if (event.type === "sessions.changed") {
        return;
      }
      // Background (`/btw`) prompts run on a separate agent and report back via
      // `background.complete` — outside the main turn lifecycle, so render the
      // answer as a standalone agent message without touching isLoading or the
      // active turn.
      if (event.type === "background.complete") {
        const p =
          event.payload && typeof event.payload === "object"
            ? (event.payload as { task_id?: string; text?: string })
            : {};
        const label = p.task_id ? `[bg ${p.task_id}] ` : "[bg] ";
        const body = String(p.text ?? "").trim() || "(no output)";
        const appended: ChatMessage[] = [
          ...messagesRef.current,
          {
            id: `bg-${p.task_id || Date.now()}`,
            role: "agent",
            content: `${label}${body}`,
          },
        ];
        messagesRef.current = appended;
        setMessages(appended);
        return;
      }

      const failed =
        event.type === "message.complete" && completionFailed(event.payload);

      // PLAN MODE: intercept tool.start events for write-mutation tools.
      // Instead of relying on the model to obey a system instruction, we
      // inject an error result directly so the model sees its write attempt
      // was rejected and must proceed read-only.
      if (
        planModeRef.current &&
        event.type === "tool.start" &&
        event.payload &&
        typeof event.payload === "object"
      ) {
        const toolName = String(
          (event.payload as { name?: string; tool_name?: string }).name ||
            (event.payload as { tool_name?: string }).tool_name ||
            "",
        ).toLowerCase();
        const WRITE_TOOLS = [
          "write_file",
          "edit_file",
          "patch_file",
          "delete_file",
          "create_file",
          "move_file",
          "copy_file",
          "rename_file",
          "run_command",
          "execute_code",
          "shell",
          "terminal",
          "apply_patch",
          "str_replace",
          "save_file",
          "create_directory",
          "remove_directory",
          "git_commit",
          "git_push",
          "git_checkout",
          "mkdir",
          "rm",
          "delete",
        ];
        if (WRITE_TOOLS.some((w) => toolName.includes(w))) {
          // Inject a tool error result so the model knows it was blocked.
          const blockedEvent: DashboardStreamEvent = {
            type: "tool.complete",
            payload: {
              tool_id: (event.payload as { tool_id?: string }).tool_id || "",
              name: toolName,
              result:
                "BLOCKED: Plan mode is active. File mutations are not allowed. Switch to BUILD mode to make changes.",
              error: "Plan mode: write tool blocked",
            },
            session_id: event.session_id,
          };
          const blockedNext = applyDashboardStreamEvent(
            {
              messages: messagesRef.current,
              reasoningSegmentClosed: reasoningSegmentClosedRef.current,
            },
            blockedEvent,
            { activeTurn: activeTurnRef.current, renderAssistantDeltas: true },
          );
          messagesRef.current = blockedNext.messages;
          setMessages(blockedNext.messages);
          return; // Suppress the original tool.start so it never executes
        }
      }

      // FILE-CHANGES: best-effort before-snapshot. The gateway's tool.start
      // carries no args (only context/name/tool_id) — the file path can only
      // be recovered from the context description text when it mentions one.
      if (
        event.type === "tool.start" &&
        event.payload &&
        typeof event.payload === "object"
      ) {
        const toolPayload = event.payload as Record<string, unknown>;
        const toolName = payloadText(
          toolPayload,
          "name",
          "tool",
          "function",
          "function_name",
          "tool_name",
        ).toLowerCase();
        const matched = WRITE_TOOL_NAMES.some((w) => toolName.includes(w));
        if (matched) {
          // The path may live in a nested args/context field, OR at the top
          // level of the payload itself (some gateways put `path` directly on
          // the tool payload: {mode, path, new_string, old_string}).
          const path =
            extractToolPath(
              toolPayload.context ??
                (toolPayload.args as unknown) ??
                toolPayload.input ??
                toolPayload.arguments,
              lastSyncedCwdRef.current ?? contextFolder,
            ) ??
            extractToolPath(
              toolPayload,
              lastSyncedCwdRef.current ?? contextFolder,
            );
          // Terminal-like tools READ files too (grep/cat/log tail) — a path in
          // the command is only a change candidate when the command WRITES
          // (>/>>/cp/mv/sed -i/touch/git add/...). Otherwise a log the game
          // keeps writing would show up as "edited by the model".
          const isTerminalLike =
            /terminal|shell|bash|exec|process|run_command|command|powershell|cmd\.exe|pwsh/.test(
              toolName,
            );
          const cmdText = [
            toolPayload.command,
            toolPayload.cmd,
            toolPayload.context,
            ...(Array.isArray(toolPayload.args)
              ? toolPayload.args
              : [toolPayload.args]),
          ]
            .filter((v): v is string => typeof v === "string")
            .join("\n");
          const writes =
            !isTerminalLike ||
            /(^|[;&|])\s*(>|>>|tee|touch|mkdir|install|dd|rm\s|cp\s|mv\s|sed\s+-i|git\s+(add|commit|push|checkout|reset|mv|rm)\b|echo\s+[^>]*>)/.test(
              cmdText,
            );
          if (path && writes && !fileChangesRef.current.has(path)) {
            const startArgs =
              typeof toolPayload.args === "object" &&
              toolPayload.args !== null &&
              !Array.isArray(toolPayload.args)
                ? (toolPayload.args as Record<string, unknown>)
                : null;
            const startOld =
              typeof toolPayload.old_string === "string"
                ? toolPayload.old_string
                : startArgs && typeof startArgs.old_string === "string"
                  ? startArgs.old_string
                  : undefined;
            const startNew =
              typeof toolPayload.new_string === "string"
                ? toolPayload.new_string
                : startArgs && typeof startArgs.new_string === "string"
                  ? startArgs.new_string
                  : undefined;
            fileChangesRef.current.set(path, {
              path,
              before: null,
              after: null,
              beforeKnown: false,
              removed:
                startOld === undefined
                  ? undefined
                  : startOld === ""
                    ? []
                    : startOld.split("\n"),
              added:
                startNew === undefined
                  ? undefined
                  : startNew === ""
                    ? []
                    : startNew.split("\n"),
            });
            void window.hermesAPI
              .readFile(path)
              .then((res) => {
                const current = fileChangesRef.current.get(path);
                if (!current) return;
                // Read succeeded → the file existed before the tool ran.
                fileChangesRef.current.set(path, {
                  ...current,
                  before: res?.content ?? null,
                  beforeKnown: true,
                });
              })
              .catch(() => {
                const current = fileChangesRef.current.get(path);
                if (!current) return;
                // Read failed → the file did not exist yet (created).
                fileChangesRef.current.set(path, {
                  ...current,
                  before: null,
                  beforeKnown: true,
                });
              });
          }
        }
      }

      // FILE-CHANGES: tool.complete carries the authoritative path info.
      if (
        event.type === "tool.complete" &&
        event.payload &&
        typeof event.payload === "object"
      ) {
        const toolPayload = event.payload as Record<string, unknown>;
        const toolName = payloadText(
          toolPayload,
          "name",
          "tool",
          "function",
          "function_name",
          "tool_name",
        ).toLowerCase();
        const matched = WRITE_TOOL_NAMES.some((w) => toolName.includes(w));

        // Patch-style tools carry the exact hunk — at the payload TOP LEVEL
        // for some gateways ({mode, path, old_string, new_string}) or nested
        // under `args`. Capture removed/added so the diff renders git-style
        // even without the full before content.
        let removed: string[] | undefined;
        let added: string[] | undefined;
        const argsRecord =
          typeof toolPayload.args === "object" &&
          toolPayload.args !== null &&
          !Array.isArray(toolPayload.args)
            ? (toolPayload.args as Record<string, unknown>)
            : null;
        const oldString =
          typeof toolPayload.old_string === "string"
            ? toolPayload.old_string
            : argsRecord && typeof argsRecord.old_string === "string"
              ? argsRecord.old_string
              : undefined;
        const newString =
          typeof toolPayload.new_string === "string"
            ? toolPayload.new_string
            : argsRecord && typeof argsRecord.new_string === "string"
              ? argsRecord.new_string
              : undefined;
        if (typeof oldString === "string") {
          removed = oldString === "" ? [] : oldString.split("\n");
        }
        if (typeof newString === "string") {
          added = newString === "" ? [] : newString.split("\n");
        }

        const capturePath = (path: string): void => {
          const existing = fileChangesRef.current.get(path);
          if (existing) {
            if (removed || added) {
              fileChangesRef.current.set(path, {
                ...existing,
                removed,
                added,
              });
            }
          } else {
            // The before was never captured (path unknown at tool.start) —
            // the file may already be modified by the time we read.
            fileChangesRef.current.set(path, {
              path,
              before: null,
              after: null,
              beforeKnown: false,
              removed,
              added,
            });
          }
          void window.hermesAPI
            .readFile(path)
            .then((res) => {
              const current = fileChangesRef.current.get(path);
              if (!current) return;
              fileChangesRef.current.set(path, {
                ...current,
                after: res?.content ?? null,
              });
            })
            .catch(() => undefined);
        };

        // Authoritative: the tool's own files_modified list — never guesses.
        // ONLY for file-edit tools (matched): terminal/process tools report
        // files written by SUBPROCESSES (game logs, build artifacts) that the
        // agent never edited — the "godot.log edited" false positives.
        const filesModified =
          matched && Array.isArray(toolPayload.files_modified)
            ? toolPayload.files_modified.filter(
                (p): p is string => typeof p === "string",
              )
            : [];
        for (const p of filesModified) capturePath(p);

        // Fallback: name match + path extraction (nested args OR the payload
        // top level, where some gateways put `path` directly).
        if (matched && filesModified.length === 0) {
          const args =
            (toolPayload.args as unknown) ??
            toolPayload.input ??
            toolPayload.arguments;
          const path =
            extractToolPath(args, lastSyncedCwdRef.current ?? contextFolder) ??
            extractToolPath(
              toolPayload,
              lastSyncedCwdRef.current ?? contextFolder,
            );
          if (path) capturePath(path);
        }
      }

      const next = applyDashboardStreamEvent(
        {
          messages: messagesRef.current,
          reasoningSegmentClosed: reasoningSegmentClosedRef.current,
        },
        event,
        {
          activeTurn: activeTurnRef.current,
          // Do NOT render streamed answer deltas. The gateway emits answer
          // text, THEN tools, THEN a trailing thought; rendering the deltas
          // live puts a partial answer mid-transcript above the tools and the
          // trailing thought (reads as "cut" / "last response missing", and
          // no amount of gating/merging/reordering fully fixes it). Instead
          // the thought streams live and `message.complete` materializes the
          // final answer ONCE, from the final text, at the end of the turn —
          // same shape as the (working) reopened-from-DB view.
          renderAssistantDeltas: false,
        },
      );
      reasoningSegmentClosedRef.current = next.reasoningSegmentClosed;
      const nextMessages = failed
        ? markActiveTurnFailed(
            next.messages,
            completionErrorMessage(event.payload),
            activeTurnRef.current,
          )
        : next.messages;
      messagesRef.current = nextMessages;
      setMessages(nextMessages);

      if (event.type === "message.complete") {
        const payloadRecord =
          event.payload && typeof event.payload === "object"
            ? (event.payload as Record<string, unknown>)
            : {};
        const rawFinal =
          typeof payloadRecord.text === "string"
            ? payloadRecord.text
            : typeof payloadRecord.rendered === "string"
              ? payloadRecord.rendered
              : typeof payloadRecord.final_response === "string"
                ? payloadRecord.final_response
                : typeof payloadRecord.output_text === "string"
                  ? payloadRecord.output_text
                  : typeof payloadRecord.content === "string"
                    ? payloadRecord.content
                    : "";
        console.info("[gate-diag] message.complete", {
          finalTextLen: rawFinal.length,
          finalTextHead: rawFinal.slice(0, 60),
          payloadKeys: Object.keys(payloadRecord),
          lastRows: nextMessages
            .slice(-5)
            .map((m) =>
              "kind" in m
                ? `kind:${m.kind}`
                : `${m.role}(len ${String(m.content).length}, pending ${!!m.pending})`,
            )
            .join(" | "),
          pendingBubbles: nextMessages.filter(
            (m) => !("kind" in m) && m.role === "agent" && m.pending,
          ).length,
        });
        if (failed) {
          appliedModelRef.current = null;
          recreateRuntimeSessionRef.current = true;
          const storedSessionId = storedSessionIdRef.current;
          const userContent = userContentById(
            messagesRef.current,
            activeTurnRef.current?.userId,
          );
          const recordLocalError = window.hermesAPI.recordSessionLocalError;
          if (
            dashboardShouldPersistLocalOverlays(connectionMode) &&
            storedSessionId &&
            userContent &&
            typeof recordLocalError === "function"
          ) {
            void recordLocalError(storedSessionId, {
              userContent,
              error: completionErrorMessage(event.payload),
            }).catch(() => undefined);
          }
        }
        const activeTurn = activeTurnRef.current;
        if (activeTurn) activeTurn.status = failed ? "failed" : "completed";
        activeTurnRef.current = null;
        clearQuietFinalize();
        setToolProgress(null);
        setIsLoading(false);
        lastLocalActivityAtRef.current = Date.now();
          // FILE-CHANGES: emit the per-turn summary chip row (git + tool merge).
        finalizeFileChanges();
        // The completion payload only carries the LAST answer text.
        // Intermediate answers (model text emitted between tool rounds) are
        // persisted as separate session rows — the official desktop shows
        // them, and reopening the session does too. Pull the stored rows a
        // beat after completion (the gateway persists them just before
        // sending complete) and reconcile, so the live transcript matches
        // the reopened view. Any lagging read self-heals via the next
        // sessions.changed broadcast.
        if (completeSyncTimerRef.current !== null) {
          clearTimeout(completeSyncTimerRef.current);
        }
        completeSyncTimerRef.current = setTimeout(() => {
          completeSyncTimerRef.current = null;
          const stored = storedSessionIdRef.current;
          if (!stored) return;
          void (async () => {
            try {
              const items = (await window.hermesAPI.getSessionMessages(
                stored,
              )) as DbHistoryItem[];
              const dbMessages = dbItemsToChatMessages(items);
              const next = reconcileAfterDbRefresh(
                messagesRef.current,
                dbMessages,
                {},
              );
              messagesRef.current = next;
              setMessages(next);
            } catch {
              /* a later sessions.changed broadcast retries */
            }
          })();
        }, 400);
        const usage = usageFromPayload(event.payload);
        if (usage || !failed) {
          // The gauge only renders when `contextTokens` is set, so it must be
          // populated even when the provider omits usage — entirely
          // (usageFromPayload → null) or just the prompt-side counts. Exact
          // payload values win; otherwise fall back to the chars/4 transcript
          // estimate, then to the previous turn's value. A failed turn with no
          // usage doesn't fabricate one — nothing new entered the context.
          const estimatedContextTokens = estimateContextTokens(
            messagesRef.current,
          );
          // Backend sends cumulative session_input_tokens — use raw values
            // (not accumulated) so the context gauge and usage page show correct counts.
            setUsage(() => ({
            promptTokens: usage?.promptTokens || 0,
            completionTokens: usage?.completionTokens || 0,
            totalTokens: usage?.totalTokens || 0,
            cost: undefined,
            contextTokens:
              usage?.contextTokens ||
              estimatedContextTokens,
            contextWindowTokens:
              usage?.contextWindowTokens,
            cacheReadTokens: undefined,
            cacheWriteTokens: undefined,
          }));
        }
      }

      if (event.type === "clarify.request") {
        const payload =
          event.payload && typeof event.payload === "object"
            ? (event.payload as { request_id?: unknown })
            : {};
        const requestId =
          typeof payload.request_id === "string" ? payload.request_id : "";
        if (requestId) {
          pendingClarifyRequestIdRef.current = requestId;
          // Keep the turn ALIVE while the card waits for an answer. Nulling
          // activeTurn + isLoading here meant the resumed turn (after the user
          // answered) streamed with no spinner and no turn to attach deltas to,
          // so its reasoning/tool rows rendered detached and the answer only
          // materialized via the delayed DB reconcile. Match the legacy
          // transport: loading stays on through the clarify round.
          setToolProgress(null);
        }
      }
    },
    [
      activeTurnRef,
      clearQuietFinalize,
      connectionMode,
      finalizeFileChanges,
      resetQuietFinalize,
      resetStallTimer,
      setIsLoading,
      setMessages,
      setToolProgress,
      setUsage,
    ],
  );

  const ensureClient =
    useCallback(async (): Promise<DashboardGatewayClient> => {
      const existing = clientRef.current;
      if (existing?.connected) return existing;
      // Already known unavailable on this remote/SSH connection — fail fast so the
      // caller falls back to legacy without re-running the slow status+probe.
      if (dashboardUnavailableRef.current) {
        throw new Error("Hermes dashboard transport is unavailable");
      }
      if (connectingRef.current) return connectingRef.current;

      const generation = clientGenerationRef.current;
      const pending = (async () => {
        // The dashboard `/api/ws` is the ONLY chat transport when a dashboard is
        // available (matching apps/desktop, which has no /v1 chat path). A WS
        // drop / "socket hang up" — e.g. a momentary SSH tunnel blip — is
        // TRANSIENT and must reconnect, NOT fall back to the main-process /v1
        // path: over the dashboard tunnel /v1 doesn't exist and 405s. So retry
        // the connect (re-running startDashboard each attempt to re-establish the
        // tunnel). Only a genuinely-absent dashboard (running=false) latches the
        // negative flag and lets the caller drop to legacy gateway /v1.
        let lastConnectErr: unknown = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          const status = await window.hermesAPI.startDashboard(profile);
          if (clientGenerationRef.current !== generation) {
            throw new Error("Hermes dashboard connection was superseded");
          }
          if (!status.running || !status.connection) {
            if (status.needsOAuthLogin) {
              const error = new Error(
                status.error || "Remote gateway sign-in is required",
              ) as Error & { dashboardWasReachable?: boolean };
              error.dashboardWasReachable = true;
              throw error;
            }
            // No dashboard on this remote (gateway-only install). Latch + notify
            // only in auto mode where we actually fall back to legacy.
            if (
              connectionMode !== "local" &&
              fallbackOnUnavailable &&
              !dashboardUnavailableRef.current
            ) {
              dashboardUnavailableRef.current = true;
              onDashboardUnavailable?.(
                status.error || "Hermes dashboard transport is unavailable",
              );
            }
            throw new Error(
              status.error || "Hermes dashboard transport is unavailable",
            );
          }
          const client: DashboardGatewayClient = new DashboardGatewayClient({
            onEvent: handleGatewayEvent,
            onClose: () => {
              if (clientRef.current === client) {
                clientRef.current = null;
              }
            },
          });
          try {
            const freshUrl = window.hermesAPI.freshDashboardWsUrl
              ? await window.hermesAPI.freshDashboardWsUrl(profile)
              : status.connection.wsUrl;
            if (!freshUrl) {
              throw new Error("Hermes dashboard WebSocket URL is unavailable");
            }
            await client.connect(freshUrl);
          } catch (err) {
            lastConnectErr = err;
            client.close();
            if (clientGenerationRef.current !== generation) {
              throw new Error("Hermes dashboard connection was superseded");
            }
            // Transient connect failure while the dashboard IS up — back off and
            // retry (the tunnel may be re-establishing).
            await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
            continue;
          }
          if (clientGenerationRef.current !== generation) {
            client.close();
            throw new Error("Hermes dashboard connection was superseded");
          }
          clientRef.current = client;
          return client;
        }
        // Dashboard was up but the WS wouldn't stay connected. Tag the error so
        // the caller fails the turn (and lets the user retry) instead of POSTing
        // /v1 to the dashboard tunnel (which 405s).
        const err = new Error(
          lastConnectErr instanceof Error
            ? `Hermes dashboard chat connection failed: ${lastConnectErr.message}`
            : "Hermes dashboard chat connection failed",
        ) as Error & { dashboardWasReachable?: boolean };
        err.dashboardWasReachable = true;
        throw err;
      })();
      connectingRef.current = pending;

      try {
        return await pending;
      } finally {
        if (connectingRef.current === pending) {
          connectingRef.current = null;
        }
      }
    }, [
      handleGatewayEvent,
      profile,
      connectionMode,
      fallbackOnUnavailable,
      onDashboardUnavailable,
    ]);

  const ensureRuntimeSessionUnlocked = useCallback(
    async (
      client: DashboardGatewayClient,
      options: {
        excludeSeedUserId?: string | null;
        forceCreate?: boolean;
      } = {},
    ): Promise<string> => {
      let targetSessionId = runtimeSessionIdRef.current;
      let justCreated = false;

      if (!targetSessionId) {
        const stored = storedSessionIdRef.current;
        const excludeSeedUserId =
          options.excludeSeedUserId ?? activeTurnRef.current?.userId ?? null;
        const systemParts: string[] = [];
        // PLAN MODE is intentionally NOT baked into the system context here. A
        // baked instruction goes stale the moment the user toggles plan mode
        // off mid-session: session.resume ignores the seeded knowledgeIndex for
        // an existing stored session, so the model keeps "claiming" plan mode
        // forever. Enforcement is per-turn instead — handleGatewayEvent blocks
        // write/exec tool.start events live, so toggling re-enables them
        // immediately and the model never sees a stale directive.
        if (knowledgeIndexRef.current) {
          systemParts.push(knowledgeIndexRef.current);
        } else if ((knowledgeBundles ?? []).length > 0) {
          // RACE GUARD: the index loads asynchronously in an effect. If the
          // session is created before it resolves (toggle just flipped, or a
          // slow index build), the system prompt would be built WITHOUT the
          // knowledge index — the model then "doesn't know the knowledge
          // files even though the toggle is on", forever (single-shot).
          try {
            const index = await window.hermesAPI.getKnowledgeIndex(
              knowledgeBundles ?? [],
            );
            knowledgeIndexRef.current = index ?? "";
            if (index) systemParts.push(index);
          } catch {
            /* index optional */
          }
        }
        if (folderIndexRef.current) {
          systemParts.push(folderIndexRef.current);
        } else if (contextFolder?.trim()) {
          // Same race guard for the attached-folder index.
          try {
            const index = await window.hermesAPI.getFolderIndex([
              contextFolder.trim(),
            ]);
            folderIndexRef.current = index ?? "";
            if (index) systemParts.push(index);
          } catch {
            /* index optional */
          }
        }
        const response = await ensureDashboardRuntimeSession({
          client,
          contextFolder,
          excludeSeedUserId,
          forceCreate: options.forceCreate ?? false,
          messages: messagesRef.current,
          profile,
          storedSessionId: stored,
          knowledgeIndex: systemParts.join("\n\n"),
        });

        if (stored && response.created) {
          pendingRecoveredContinuationRef.current =
            dashboardContinuationItemsFromTranscript(messagesRef.current, {
              excludeUserId: excludeSeedUserId,
            });
        }

        targetSessionId = response.runtimeSessionId;
        runtimeSessionIdRef.current = targetSessionId;
        lastRuntimeSessionWasCreatedRef.current = response.created;
        justCreated = response.created;
        if (justCreated && contextFolder) {
          lastSyncedCwdRef.current = contextFolder;
        }
        const storedId = response.storedSessionId;
        storedSessionIdRef.current = storedId;
        recreateRuntimeSessionRef.current = false;
        setHermesSessionId(storedId);
        // A new session row was committed to state.db by the agent; ask the
        // sidebar recent-sessions list to re-sync immediately (mirrors the
        // legacy-transport dispatch in useChatIPC).
        window.dispatchEvent(new Event("hermes-session-db-synced"));
      }

      if (
        contextFolder &&
        targetSessionId &&
        lastSyncedCwdRef.current !== contextFolder
      ) {
        lastSyncedCwdRef.current = contextFolder;
        await client
          .request("session.cwd.set", {
            session_id: targetSessionId,
            cwd: contextFolder,
          })
          .catch((err) => {
            lastSyncedCwdRef.current = null;
            console.warn("Failed to sync dashboard CWD:", err);
          });
      }

      return targetSessionId;
    },
    [activeTurnRef, contextFolder, profile, setHermesSessionId],
  );

  const ensureRuntimeSession = useCallback(
    (
      client: DashboardGatewayClient,
      options: {
        excludeSeedUserId?: string | null;
        forceCreate?: boolean;
      } = {},
    ): Promise<string> => {
      const existing = runtimeSessionPromiseRef.current;
      if (existing) return existing;

      const pending = ensureRuntimeSessionUnlocked(client, options);
      runtimeSessionPromiseRef.current = pending;
      const clearPending = (): void => {
        if (runtimeSessionPromiseRef.current === pending) {
          runtimeSessionPromiseRef.current = null;
        }
      };
      void pending.then(clearPending, clearPending);
      return pending;
    },
    [ensureRuntimeSessionUnlocked],
  );

  const ensureSelectedModel = useCallback(
    async (
      client: DashboardGatewayClient,
      sessionId: string,
    ): Promise<string> => {
      const liveOverride = sessionModelOverrideRef?.current;
      const selectedModel = liveOverride?.model ?? modelRef.current;
      const selectedProvider = liveOverride?.provider ?? providerRef.current;
      const selectedBaseUrl = liveOverride?.baseUrl ?? modelBaseUrlRef.current;
      const command = dashboardModelCommand(selectedProvider, selectedModel);
      if (!command) return sessionId;
      const resetRuntimeSession = async (
        targetSessionId: string,
      ): Promise<string> => {
        const storedSessionId = storedSessionIdRef.current;
        await client
          .request("session.close", { session_id: targetSessionId })
          .catch(() => undefined);
        runtimeSessionIdRef.current = null;
        storedSessionIdRef.current = storedSessionId;
        reasoningSegmentClosedRef.current = false;
        appliedModelRef.current = null;
        return ensureRuntimeSession(client);
      };

      const switchAndValidate = async (
        targetSessionId: string,
      ): Promise<string> => {
        let before = await client.request<ModelOptionsResponse>(
          "model.options",
          {
            session_id: targetSessionId,
          },
        );
        let dashboardProvider = resolveDashboardProviderForModel(
          selectedProvider,
          selectedModel,
          selectedBaseUrl,
          before,
        );

        if (
          storedSessionIdRef.current &&
          !dashboardModelMatches(dashboardProvider, selectedModel, before) &&
          (selectedProvider === "custom" ||
            (before.provider || "").toLowerCase().startsWith("custom"))
        ) {
          targetSessionId = await resetRuntimeSession(targetSessionId);
          before = await client.request<ModelOptionsResponse>("model.options", {
            session_id: targetSessionId,
          });
          dashboardProvider = resolveDashboardProviderForModel(
            selectedProvider,
            selectedModel,
            selectedBaseUrl,
            before,
          );
          if (dashboardModelMatches(dashboardProvider, selectedModel, before)) {
            appliedModelRef.current = `${targetSessionId}\n${dashboardProvider}\n${selectedModel}`;
            return targetSessionId;
          }
        }

        if (
          selectedProvider === "custom" &&
          dashboardProvider === "custom" &&
          storedSessionIdRef.current &&
          !dashboardModelMatches("custom", selectedModel, before)
        ) {
          targetSessionId = await resetRuntimeSession(targetSessionId);

          const rebuilt = await client.request<ModelOptionsResponse>(
            "model.options",
            {
              session_id: targetSessionId,
            },
          );
          if (dashboardModelMatches("custom", selectedModel, rebuilt)) {
            appliedModelRef.current = `${targetSessionId}\ncustom\n${selectedModel}`;
            return targetSessionId;
          }
        }

        const resolvedCommand = dashboardModelCommand(dashboardProvider, selectedModel);
        if (!resolvedCommand) return targetSessionId;
        const key = `${targetSessionId}\n${dashboardProvider}\n${selectedModel}`;
        if (appliedModelRef.current === key) return targetSessionId;
        const slashResponse = await client.request<SlashExecResponse>(
          "slash.exec",
          {
            session_id: targetSessionId,
            command: resolvedCommand,
          },
        );

        const live = await client.request<ModelOptionsResponse>(
          "model.options",
          {
            session_id: targetSessionId,
          },
        );
        if (!dashboardModelMatches(dashboardProvider, selectedModel, live)) {
          // The gateway may not reflect a session-only `/model` switch in
          // `model.options`: a resumed (old) session keeps reporting its
          // creation model, and custom providers outside the gateway's
          // auto-detected inventory never appear. The slash was accepted (a
          // non-thrown response) and the custom endpoint accepts the model,
          // so a mismatch here must not block the turn — warn and send on the
          // session instead, and drop the applied key so the next send retries
          // the switch until the gateway reports it.
          appliedModelRef.current = null;
          const warning = slashResponse?.warning
            ? `; /model warning: ${slashResponse.warning}`
            : "";
          const output = slashResponse?.output
            ? `; /model output: ${slashResponse.output}`
            : "";
          console.warn(
            `Hermes dashboard did not report ${dashboardProvider}/${selectedModel}; live model is ${live.provider || "unknown"}/${live.model || "unknown"}${warning}${output}; custom inventory: ${modelOptionsSummary(before)}; continuing on ${targetSessionId}`,
          );
          return targetSessionId;
        }
        appliedModelRef.current = key;
        return targetSessionId;
      };

      try {
        return await switchAndValidate(sessionId);
      } catch (err) {
        if (!isDashboardSlashWorkerExitError(err)) throw err;
        appliedModelRef.current = null;
        const freshSessionId = await resetRuntimeSession(sessionId);
        return switchAndValidate(freshSessionId);
      }
    },
    [ensureRuntimeSession],
  );

  const syncDashboardAttachments = useCallback(
    async (
      client: DashboardGatewayClient,
      sessionId: string,
      attachments?: Attachment[],
    ): Promise<{ handled: boolean; refs: string[] }> => {
      return syncDashboardAttachmentsForSubmit(client, sessionId, attachments);
    },
    [],
  );

  // ── Foreign-turn watcher ─────────────────────────────────────────────────
  // A turn started by ANOTHER client (the official desktop, a dashboard tab,
  // a second instance) streams to THAT client's transport — not ours. The
  // gateway still exposes every live session through `session.active_list`
  // (the official desktop polls it at 1.5s). Poll it too, so an open session
  // whose turn we did not start still: paints the loading state (spinner,
  // interrupt button, tab orb — everything flows from setIsLoading), keeps
  // the transcript fresh at the poll cadence, and finalizes on completion —
  // no reopen needed. This REPLACES the old sessions.changed-broadcast
  // sync, which never fired when our WebSocket was disconnected (the client
  // connects lazily on first send) — the exact "needs reopen" report.
  //
  // REOPEN: on a reopened session the runtime id starts null (it is only
  // established lazily on the first send), so `tick` bails before ever
  // polling `active_list` and an in-flight turn stays invisible until the
  // user sends something or reopens again. Re-attach once up front so a
  // reopened, still-processing session paints its live state immediately.
  useEffect(() => {
    if (!enabled || !hermesSessionId) return;
    if (runtimeSessionIdRef.current) return;
    let cancelled = false;
    void (async () => {
      try {
        const client = await ensureClient();
        if (cancelled) return;
        await ensureRuntimeSession(client);
      } catch {
        /* poller / next send retries */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, hermesSessionId, ensureClient, ensureRuntimeSession]);

  const FOREIGN_TURN_POLL_MS = 2_000;
  // After a LOCAL turn ends the gateway can still report the session as
  // working for a moment; don't re-enter foreign mode during that window.
  const FOREIGN_TURN_GRACE_MS = 5_000;

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const reconcileFromDb = async (): Promise<void> => {
      const stored = storedSessionIdRef.current;
      if (!stored) return;
      const seq = ++foreignRefreshSeqRef.current;
      try {
        const items = (await window.hermesAPI.getSessionMessages(
          stored,
        )) as DbHistoryItem[];
        if (disposed || seq !== foreignRefreshSeqRef.current) return;
        const dbMessages = dbItemsToChatMessages(items);
        messagesRef.current = reconcileAfterDbRefresh(
          messagesRef.current,
          dbMessages,
          { activeTurn: activeTurnRef.current },
        );
        setMessages(messagesRef.current);
      } catch {
        /* transient — the next tick retries */
      }
    };

    const tick = async (): Promise<void> => {
      const runtimeId = runtimeSessionIdRef.current;
      if (!runtimeId) return;
      // A local turn owns the UI — never fight it.
      if (activeTurnRef.current) {
        if (foreignTurnRef.current) foreignTurnRef.current = false;
        return;
      }
      const client =
        clientRef.current ?? (await ensureClient().catch(() => null));
      if (!client || disposed) return;
      const res = (await client
        .request("session.active_list")
        .catch(() => null)) as
        | { sessions?: Array<{ id?: string; status?: string }> }
        | null;
      if (disposed) return;
      const entry = res?.sessions?.find((s) => s.id === runtimeId);
      const busy =
        entry?.status === "working" ||
        entry?.status === "waiting";
      // NOTE: "starting" is deliberately NOT treated as busy. On a cold resume
      // the gateway schedules a lazy agent build (agent_build_started, ready
      // unset) which reports "starting" for a few seconds while NOTHING is
      // actually running — treating it as busy painted a false "processing"
      // spinner every reopen. A genuinely in-flight turn reports "working"
      // (running=True); "starting" only means the agent is still being built.
      const wasForeign = foreignTurnRef.current;
      if (!busy) {
        if (wasForeign) {
          // Foreign turn finished: pull the complete answer in (same
          // machinery as quiet-finalize) and drop the loading state.
          foreignTurnRef.current = false;
          await reconcileFromDb();
          activeTurnRef.current = null;
          setToolProgress(null);
          setIsLoading(false);
        }
        return;
      }
      if (!wasForeign) {
        if (
          Date.now() - lastLocalActivityAtRef.current <
          FOREIGN_TURN_GRACE_MS
        ) {
          return; // a local turn just ended — let the gateway settle
        }
        foreignTurnRef.current = true;
        activeTurnRef.current = {
          turnId: `foreign-${Date.now()}`,
          userId: "",
          startIndex: messagesRef.current.length,
          status: "running",
        };
        setToolProgress(null);
        setIsLoading(true);
        await reconcileFromDb();
        return;
      }
      await reconcileFromDb();
    };

    timer = setInterval(() => {
      void tick();
    }, FOREIGN_TURN_POLL_MS);
    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
      if (foreignTurnRef.current) {
        foreignTurnRef.current = false;
        activeTurnRef.current = null;
        setIsLoading(false);
      }
    };
  }, [enabled, ensureClient, setMessages, setIsLoading, setToolProgress]);

  const sendMessage = useCallback(
    async (text: string, attachments?: Attachment[]): Promise<boolean> => {
      if (!enabled) return false;
      // Stamp LOCAL activity BEFORE the send's await window (ensureClient →
      // ensureRuntimeSession → ensureSelectedModel → syncAttachments can take
      // 1-3s) — during it activeTurnRef is still null, and without a fresh
      // stamp the 2s foreign poll would see the gateway already "working",
      // enter foreign mode and run a full DB reconcile on the UI thread.
      lastLocalActivityAtRef.current = Date.now();
      // FILE-CHANGES: a new user turn starts a fresh accumulator.
      fileChangesRef.current = new Map();
      // Start a fresh quiet-finalize window. The stall watchdog is armed
      // immediately after the optimistic turn is registered below, so setup
      // stalls are covered too.
      resetQuietFinalize();
      const pendingClarifyRequestId = pendingClarifyRequestIdRef.current;
      if (pendingClarifyRequestId) {
        pendingClarifyRequestIdRef.current = null;
        try {
          const client = await ensureClient();
          await client.request("clarify.respond", {
            request_id: pendingClarifyRequestId,
            answer: text,
          });
          return true;
        } catch (err) {
          pendingClarifyRequestIdRef.current = pendingClarifyRequestId;
          const message = err instanceof Error ? err.message : String(err);
          const activeTurn = activeTurnRef.current;
          if (activeTurn) activeTurn.status = "failed";
          setMessages((prev) => {
            const failedMessages = markActiveTurnFailed(
              prev,
              message,
              activeTurn,
            );
            messagesRef.current = failedMessages;
            return failedMessages;
          });
          activeTurnRef.current = null;
          setToolProgress(null);
          setIsLoading(false);
          return true;
        }
      }
      // OPTIMISTIC UI: the gateway may still be booting (model spawn can
      // take 10-20s+ on a cold gateway). Show the user's message + loading
      // IMMEDIATELY so the first seconds aren't a dead void; the submit
      // proceeds when the gateway answers. The DB reconcile dedupes by
      // role+content, so the echoed row replaces this one without a
      // duplicate bubble.
      const optimisticUser: ChatMessage = {
        id: `local-send-${Date.now()}`,
        role: "user",
        content: text,
      };
      messagesRef.current = [...messagesRef.current, optimisticUser];
      setMessages(messagesRef.current);
      activeTurnRef.current = {
        turnId: `send-${Date.now()}`,
        userId: "",
        startIndex: messagesRef.current.length - 1,
        status: "running",
      };
      setToolProgress(null);
      setIsLoading(true);
      resetStallTimer();
      const dashboardText = dashboardPromptTextForAttachments(
        text,
        attachments,
      );
      // FILE-CHANGES: snapshot the working tree BEFORE the agent runs, so at
      // finalize only files it actually modified this turn are reported
      // (pre-existing dirty files / reads never count).
      const folder = contextFolder?.trim();
      if (folder) {
        gitSnapshotRef.current = null;
        void window.hermesAPI
          .getGitWorkingTreeChanges(folder)
          .then((list) => {
            const snap = new Map<string, string>();
            for (const g of list) {
              snap.set(g.path, `${g.status}|${g.after ?? ""}`);
            }
            gitSnapshotRef.current = snap;
          })
          .catch(() => {
            gitSnapshotRef.current = null;
          });
      } else {
        gitSnapshotRef.current = null;
      }
      const mergePendingRecoveredContinuation = (
        existing: DesktopSessionContinuationItem[],
      ): DesktopSessionContinuationItem[] => {
        if (pendingRecoveredContinuationRef.current.length === 0) {
          return existing;
        }
        const pending = pendingRecoveredContinuationRef.current;
        pendingRecoveredContinuationRef.current = [];
        return existing.length > 0 ? existing : pending;
      };
      const recordContinuationItems = async (
        items: DesktopSessionContinuationItem[],
      ): Promise<void> => {
        const storedSessionId = storedSessionIdRef.current;
        const recordContinuation = window.hermesAPI.recordSessionContinuation;
        if (
          dashboardShouldPersistLocalOverlays(connectionMode) &&
          storedSessionId &&
          items.length > 0 &&
          typeof recordContinuation === "function"
        ) {
          await recordContinuation(storedSessionId, items).catch(
            () => undefined,
          );
        }
      };
      const failActiveTurn = (message: string): true => {
        const activeTurn = activeTurnRef.current;
        if (activeTurn) activeTurn.status = "failed";
        let failedMessages: ChatMessage[] | null = null;
        setMessages((prev) => {
          failedMessages = markActiveTurnFailed(prev, message, activeTurn);
          messagesRef.current = failedMessages;
          return failedMessages;
        });
        const storedSessionId = storedSessionIdRef.current;
        const userContent = userContentById(
          failedMessages ?? messagesRef.current,
          activeTurn?.userId,
        );
        const recordLocalError = window.hermesAPI.recordSessionLocalError;
        if (
          dashboardShouldPersistLocalOverlays(connectionMode) &&
          storedSessionId &&
          userContent &&
          typeof recordLocalError === "function"
        ) {
          void recordLocalError(storedSessionId, {
            userContent,
            error: message,
          }).catch(() => undefined);
        }
        activeTurnRef.current = null;
        setToolProgress(null);
        setIsLoading(false);
        return true;
      };
      if (dashboardText === null) {
        if (fallbackOnUnavailable) return false;
        return failActiveTurn(
          "Dashboard chat supports image attachments only in this build. Use Auto or Legacy for mixed file attachments.",
        );
      }
      const promptText = dashboardText;

      let client: DashboardGatewayClient;
      try {
        client = await ensureClient();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // On 429 rate limit or 400 bad request or dashboard error, do NOT double-send via fallback
        if (
          /429|resource|exhausted|quota|400|unsupported/i.test(message) ||
          (err as { dashboardWasReachable?: boolean })?.dashboardWasReachable
        ) {
          return failActiveTurn(message);
        }
        if (fallbackOnUnavailable) {
          console.warn("Falling back to legacy chat transport.", err);
          return false;
        }
        return failActiveTurn(message);
      }

      try {
        let continuationItems: DesktopSessionContinuationItem[] = [];
        if (recreateRuntimeSessionRef.current) {
          continuationItems = dashboardContinuationItemsFromTranscript(
            messagesRef.current,
            { excludeUserId: activeTurnRef.current?.userId ?? null },
          );
          const staleRuntimeSessionId = runtimeSessionIdRef.current;
          if (staleRuntimeSessionId) {
            await client
              .request("session.close", { session_id: staleRuntimeSessionId })
              .catch(() => undefined);
          }
          runtimeSessionIdRef.current = null;
          reasoningSegmentClosedRef.current = false;
          appliedModelRef.current = null;
        }
        // Do NOT force-create a new stored session on failure recovery: that
        // mints a brand-new row in the sidebar ("random new section" bug).
        // Resuming the same stored session gives a fresh runtime bound to the
        // existing id; session.create only happens if resume truly fails
        // (session not found), which is the correct fallback.
        const runtimeSessionId = await ensureRuntimeSession(client, {
          forceCreate: false,
        });
        runtimeSessionIdRef.current = runtimeSessionId;
        if (
          lastRuntimeSessionWasCreatedRef.current ||
          pendingRecoveredContinuationRef.current.length > 0
        ) {
          continuationItems =
            mergePendingRecoveredContinuation(continuationItems);
        } else {
          continuationItems = [];
        }
        await recordContinuationItems(continuationItems);
        const selectedSessionId = await ensureSelectedModel(
          client,
          runtimeSessionId,
        );
        await recordContinuationItems(mergePendingRecoveredContinuation([]));
        const syncedAttachments = await syncDashboardAttachments(
          client,
          selectedSessionId,
          attachments,
        );
        if (!syncedAttachments.handled) {
          if (fallbackOnUnavailable) return false;
          return failActiveTurn(
            "Hermes dashboard could not attach the selected file. Use Auto or Legacy to fall back to the legacy attachment path.",
          );
        }
        const submitText = dashboardPromptTextWithAttachmentRefs(
          promptText,
          syncedAttachments.refs,
        );
        // Arm the stall watchdog: if the gateway never answers (provider
        // overload / dropped request), fail the turn instead of loading
        // forever. Any accepted stream event pushes the deadline out.
        resetStallTimer();
        await submitDashboardPromptWithRecovery(client, {
          sessionId: selectedSessionId,
          storedSessionId: storedSessionIdRef.current,
          text: submitText,
          profile,
          raw_system_prompt: rawSystemPromptRef.current,
          onRecoveredSessionId: (recoveredSessionId) => {
            runtimeSessionIdRef.current = recoveredSessionId;
          },
        });
        return true;
      } catch (err) {
        clearStallTimer();
        appliedModelRef.current = null;
        recreateRuntimeSessionRef.current = true;
        const message = err instanceof Error ? err.message : String(err);
        return failActiveTurn(message);
      }
    },
    [
      activeTurnRef,
      clearStallTimer,
      connectionMode,
      contextFolder,
      enabled,
      fallbackOnUnavailable,
      ensureClient,
      ensureRuntimeSession,
      ensureSelectedModel,
      resetQuietFinalize,
      syncDashboardAttachments,
      setIsLoading,
      setMessages,
      setToolProgress,
      profile,
    ],
  );

  const execSlash = useCallback(
    async (
      command: string,
      sys: (text: string) => void,
    ): Promise<SlashExecOutcome> => {
      if (!enabled) {
        return { kind: "error", message: "dashboard transport disabled" };
      }
      try {
        const client = await ensureClient();
        const runtimeSessionId = await ensureRuntimeSession(client);
        const sessionId = await ensureSelectedModel(client, runtimeSessionId);
        return await executeSlash({
          command,
          sessionId,
          request: (method, params, timeoutMs) =>
            client.request(method, params, timeoutMs),
          sys,
        });
      } catch (err) {
        return {
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
    [enabled, ensureClient, ensureRuntimeSession, ensureSelectedModel],
  );

  const getCommandCatalog =
    useCallback(async (): Promise<AgentCommandsCatalogResponse> => {
      if (!enabled) {
        throw new Error("dashboard transport disabled");
      }
      const client = await ensureClient();
      return client.request<AgentCommandsCatalogResponse>(
        "commands.catalog",
        {},
      );
    }, [enabled, ensureClient]);

  const runBackground = useCallback(
    async (text: string): Promise<{ taskId?: string; error?: string }> => {
      if (!enabled) return { error: "dashboard transport disabled" };
      try {
        const client = await ensureClient();
        const runtimeSessionId = await ensureRuntimeSession(client);
        const sessionId = await ensureSelectedModel(client, runtimeSessionId);
        const r = await client.request<{ task_id?: string }>(
          "prompt.background",
          {
            session_id: sessionId,
            text,
            ...(profile && profile !== "default" ? { profile } : {}),
          },
        );
        return { taskId: r?.task_id };
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    [enabled, ensureClient, ensureRuntimeSession, ensureSelectedModel, profile],
  );

  const respondClarify = useCallback(
    async (requestId: string, answer: string): Promise<boolean> => {
      if (!enabled) return false;
      try {
        const client = await ensureClient();
        await client.request("clarify.respond", {
          request_id: requestId,
          answer,
        });
        // The turn resumes from the clarify answer; keep loading until the
        // next message.complete (mirrors sendMessage's clarify branch).
        pendingClarifyRequestIdRef.current = null;
        resetStallTimer();
        resetQuietFinalize();
        lastLocalActivityAtRef.current = Date.now();
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const activeTurn = activeTurnRef.current;
        if (activeTurn) activeTurn.status = "failed";
        setMessages((prev) => {
          const failedMessages = markActiveTurnFailed(
            prev,
            message,
            activeTurn,
          );
          messagesRef.current = failedMessages;
          return failedMessages;
        });
        activeTurnRef.current = null;
        setToolProgress(null);
        setIsLoading(false);
        return false;
      }
    },
    [
      enabled,
      ensureClient,
      resetStallTimer,
      resetQuietFinalize,
      setMessages,
      setIsLoading,
      setToolProgress,
    ],
  );

  const undoLastUser = useCallback(async (): Promise<boolean> => {
    if (!enabled) return false;
    const sessionId = runtimeSessionIdRef.current;
    if (!sessionId) return false;
    try {
      // Truncate the GATEWAY's live history first so the next prompt.submit
      // builds context WITHOUT the unsent message (skipping this re-sent the
      // "unsent" text into the model on every resend — the duplicate-resend
      // bug). Rejects when a turn is running; unsend only fires while idle.
      const client = await ensureClient();
      await client.request("session.undo", { session_id: sessionId });
      return true;
    } catch {
      return false;
    }
  }, [enabled, ensureClient]);

  const abort = useCallback(() => {
    if (!enabled) return;
    const sessionId = runtimeSessionIdRef.current;
    // STOP receiving FIRST: close the shared streaming client so no late
    // events keep updating the transcript after the interrupt.
    const streaming = clientRef.current;
    if (streaming) {
      streaming.close();
      clientRef.current = null;
    }
    if (sessionId) {
      void (async () => {
        // Throwaway CONTROL connection: the user pressed STOP — we must NOT
        // re-arm the streaming channel. Connect fresh, send the interrupt,
        // close. A dead socket can never eat the interrupt again (the old
        // code sent it over the very WS it was about to close — and when
        // that socket was already closed the interrupt silently dropped,
        // hence the two-press bug).
        let ctrl: DashboardGatewayClient | null = null;
        try {
          const freshUrl = window.hermesAPI.freshDashboardWsUrl
            ? await window.hermesAPI.freshDashboardWsUrl(profile)
            : null;
          if (freshUrl) {
            ctrl = new DashboardGatewayClient({
              onEvent: () => undefined,
              onClose: () => undefined,
            });
            await ctrl.connect(freshUrl);
            await ctrl.request("session.interrupt", {
              session_id: sessionId,
            });
          }
        } catch {
          // Gateway unreachable — nothing is streaming anyway.
        } finally {
          ctrl?.close();
        }
      })();
    }
    // Clear loading immediately — don't wait for the gateway to confirm.
    activeTurnRef.current = null;
    clearQuietFinalize();
    setIsLoading(false);
    lastLocalActivityAtRef.current = Date.now();
    setToolProgress(null);
  }, [clearQuietFinalize, enabled, ensureClient, profile, setIsLoading, setToolProgress]);

  useEffect(
    () => () => {
      clientRef.current?.close();
      clientRef.current = null;
    },
    [],
  );

  /** Immediately persist a session-scoped model override via config.set RPC.
   *  Called by handleSelectModel so the backend switches on pick, not on next send. */
  const applyModelOverride = useCallback(
    async (provider: string, model: string): Promise<void> => {
      if (!enabled) return;
      const command = dashboardModelCommand(provider, model);
      if (!command) return;
      try {
        const client = await ensureClient();
        let sessionId = runtimeSessionIdRef.current;
        if (!sessionId) {
          sessionId = await ensureRuntimeSession(client);
        }
        await client.request("slash.exec", {
          session_id: sessionId,
          command,
        });
      } catch {
        // Best-effort: ensureSelectedModel will retry on send if this fails.
      }
    },
    [enabled, ensureClient, ensureRuntimeSession],
  );

  return {
    abort,
    enabled,
    sendMessage,
    respondClarify,
    undoLastUser,
    execSlash,
    getCommandCatalog,
    runBackground,
    applyModelOverride,
  };
}
