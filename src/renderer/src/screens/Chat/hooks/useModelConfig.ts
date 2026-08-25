import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  OPENAI_COMPATIBLE_BASE_URLS,
  PROVIDERS,
  displayBrandFromConfig,
} from "../../../constants";
import { customProviderEnvKey, expectedEnvKeyForUrl } from "../../../../../shared/url-key-map";
import { useDiscoveredModels } from "../../../hooks/useDiscoveredModels";
import { useI18n } from "../../../components/useI18n";
import type { ModelGroup } from "../types";

const OLLAMA_CLOUD_PROVIDER = "ollama-cloud";
const OLLAMA_CLOUD_BASE_URL = "https://ollama.com/v1";

/**
 * Named providers (deepseek, groq, anthropic, …) have a hardcoded canonical
 * base_url in hermes-agent's PROVIDER_REGISTRY, so a stored `baseUrl` on those
 * entries can be stale and would misroute the request. Keep the baseUrl only
 * for `custom` and `ollama-cloud` entries, where it is authoritative; clear it
 * otherwise so the backend falls back to the provider's canonical URL. Shared
 * by `selectModel` and the chat-screen session override so they can't drift.
 */
export function effectiveOverrideBaseUrl(
  provider: string,
  baseUrl: string,
): string {
  return provider === "custom" || provider === OLLAMA_CLOUD_PROVIDER
    ? baseUrl
    : "";
}

export function effectiveProviderForModel(
  provider: string,
  providerLabel?: string,
): string {
  if (provider !== "custom" || !providerLabel?.trim()) return provider;
  return providerLabel
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface SavedModelForPicker {
  id?: string;
  provider: string;
  model: string;
  name: string;
  baseUrl?: string;
  providerLabel?: string;
}

function mergeLiveOllamaCloudModels(
  savedModels: SavedModelForPicker[],
  liveModels: string[],
  liveStatus: string,
): SavedModelForPicker[] {
  if (liveStatus !== "ok" || liveModels.length === 0) {
    return savedModels;
  }

  const liveEntries = Array.from(new Set(liveModels))
    .sort()
    .map((model) => ({
      provider: OLLAMA_CLOUD_PROVIDER,
      model,
      name: `Ollama Cloud · ${model}`,
      baseUrl: OLLAMA_CLOUD_BASE_URL,
    }));

  return [
    ...savedModels.filter((model) => model.provider !== OLLAMA_CLOUD_PROVIDER),
    ...liveEntries,
  ];
}

interface UseModelConfigResult {
  currentModel: string;
  currentProvider: string;
  currentBaseUrl: string;
  modelGroups: ModelGroup[];
  displayModel: string;
  reload: () => Promise<void>;
  selectModel: (
    provider: string,
    model: string,
    baseUrl: string,
    options?: { persist?: boolean },
  ) => Promise<void>;
}

// `providerLabel` is the durable "Custom / <name>" bucket: user-named
// OpenAI-compatible endpoints (e.g. 9router) that resolve to different
// hosts. Without this they all collapse into the generic "OpenAI Compatible /
// Local" bucket (displayBrandFromConfig falls back to "custom" for unknown
// hosts), which becomes an unbounded list. Grouping by label gives each named
// provider its own rail entry + heading. Empty label + unknown host stays on
// the generic bucket.
function customBucketKey(m: { provider: string; baseUrl?: string; providerLabel?: string }): string | null {
  const label = m.providerLabel?.trim();
  if (label) return `custom-label:${label}`;
  return null;
}

function groupModelsByProvider(
  models: (SavedModelForPicker & { providerLabel?: string })[],
): ModelGroup[] {
  const groupMap = new Map<string, ModelGroup>();
  for (const m of models) {
    const customKey = customBucketKey(m as never);
    const brand = customKey
      ? (m as { providerLabel: string }).providerLabel
      : displayBrandFromConfig(m.provider, m.baseUrl || "");
    const label =
      customKey != null ? (brand as string) : PROVIDERS.labels[brand] || brand;
    const mapKey = customKey ?? brand;
    if (!groupMap.has(mapKey)) {
      groupMap.set(mapKey, {
        provider: customKey != null ? "custom" : brand,
        providerLabel: label,
        models: [],
      });
    }
    groupMap.get(mapKey)!.models.push({
      id: m.id,
      provider: m.provider,
      model: m.model,
      label: m.name,
      baseUrl: m.baseUrl || "",
    });
  }
  return Array.from(groupMap.values());
}

export function useModelConfig(profile?: string): UseModelConfigResult {
  const { t } = useI18n();
  const [currentModel, setCurrentModel] = useState("");
  const [currentProvider, setCurrentProvider] = useState("auto");
  const [currentBaseUrl, setCurrentBaseUrl] = useState("");
  const [modelGroups, setModelGroups] = useState<ModelGroup[]>([]);
  const [savedModels, setSavedModels] = useState<SavedModelForPicker[]>([]);
  const loadSeqRef = useRef(0);

  const ollamaCloudDiscovery = useDiscoveredModels({
    provider: OLLAMA_CLOUD_PROVIDER,
    profile,
    enabled: true,
  });

  const modelsForPicker = useMemo(
    () =>
      mergeLiveOllamaCloudModels(
        savedModels,
        ollamaCloudDiscovery.models,
        ollamaCloudDiscovery.status,
      ),
    [savedModels, ollamaCloudDiscovery.models, ollamaCloudDiscovery.status],
  );

  const isSessionScopedRef = useRef(false);

  const reload = useCallback(async (): Promise<void> => {
    const seq = ++loadSeqRef.current;
    const [mc, savedModels] = await Promise.all([
      window.hermesAPI.getModelConfig(profile),
      window.hermesAPI.listModels(),
    ]);
    if (seq !== loadSeqRef.current) return;
    if (!isSessionScopedRef.current) {
      setCurrentModel(mc.model);
      setCurrentProvider(mc.provider);
      setCurrentBaseUrl(mc.baseUrl);
    }
    setSavedModels(savedModels);
  }, [profile]);

  // Initial load + reload whenever the profile changes (canonical
  // load-on-mount; setState happens inside `reload` via an awaited IPC call).
  useEffect(() => {
    reload();
  }, [reload]);

  // Hide providers without auth in the chat picker — mirrors the Providers tab's
  // pickerProviders filter (don't spam unauthenticated entries). Keep the
  // *current* model visible even if its key was removed so the trigger still
  // shows what the chat is actually on. Local endpoints (empty base URL or
  // localhost) are not filtered.
  const [pickerEnv, setPickerEnv] = useState<Record<string, string>>({});
  const [pickerEnvReady, setPickerEnvReady] = useState(false);
  const pickerEnvRef = useRef<Record<string, string>>({});
  useEffect(() => {
    pickerEnvRef.current = pickerEnv;
  }, [pickerEnv]);
  useEffect(() => {
    let cancelled = false;
    async function loadPickerEnv(): Promise<void> {
      try {
        const env = await window.hermesAPI.getEnv(profile);
        if (!cancelled) {
          setPickerEnv(env);
          setPickerEnvReady(true);
        }
      } catch {
        /* ignore */
      }
    }
    void loadPickerEnv();
    const offConn = window.hermesAPI.onConnectionConfigChanged(() => {
      void loadPickerEnv();
    });
    const offLib = window.hermesAPI.onModelLibraryChanged(() => {
      void loadPickerEnv();
    });
    return () => {
      cancelled = true;
      offConn();
      offLib();
    };
  }, [profile]);
  function isPickerEnvSet(key: string): boolean {
    const v = pickerEnv[key];
    return !!v && !!v.trim();
  }
  function isLocalBaseUrl(url: string): boolean {
    const u = (url || "").trim().toLowerCase();
    if (!u) return true;
    return u.includes("localhost") || u.includes("127.0.0.1") || u.includes("::1");
  }
  // Which env var gates this picker group? null => no auth required (local / oauth-only
  // provider), so never filtered. For everything else the picker mirrors the Providers
  // tab: a group whose key isn't set is hidden (with the active-model exception).
  // `PROVIDERS.setup` is the single source of truth for "what needs a key".
  function groupKeyForFilter(g: { provider: string; providerLabel: string; models: { baseUrl: string }[] }): string | null {
    // Custom-named providers (e.g. 9router) each get their own dedicated key
    // derived from the name — must check that, not the generic CUSTOM_API_KEY.
    if (g.provider === "custom" && g.providerLabel && g.providerLabel !== PROVIDERS.labels["custom"] && g.providerLabel !== "OpenAI Compatible / Local") {
      return customProviderEnvKey(g.providerLabel);
    }
    // Brand groups: look up their canonical env var in PROVIDERS.setup. Any
    // provider whose setup entry has needsKey=true must have that key set to
    // appear in the picker; needsKey=false (nous, oauth-only, local) never filters.
    const setup = (PROVIDERS.setup as { id: string; envKey: string; needsKey: boolean }[]).find((s) => s.id === g.provider);
    if (setup) return setup.needsKey && setup.envKey ? setup.envKey : null;
    // OpenAI-compatible ids (groq, deepseek, …) are persisted as brand ids but
    // route as custom — they still map to their host-derived key. Fall back to
    // expectedEnvKeyForUrl when the brand isn't in `setup` (e.g. groq without a
    // dedicated setup card is still keyed by GROQ_API_KEY).
    const compatUrl = OPENAI_COMPATIBLE_BASE_URLS[g.provider];
    if (compatUrl) {
      return expectedEnvKeyForUrl(compatUrl);
    }
    // Unrecognised provider — don't hide (it may be a truly custom endpoint
    // whose key is under CUSTOM_API_KEY or a local host).
    // Also respect the local-baseUrl escape hatch: local hosts never filter even
    // if their env var is absent.
    const sampleBase = g.models[0]?.baseUrl || "";
    if (isLocalBaseUrl(sampleBase)) return null;
    return null;
  }
  useEffect(() => {
    const all = groupModelsByProvider(modelsForPicker);
    // Avoid filtering before env has loaded at least once — otherwise first paint hides everything.
    if (!pickerEnvReady) {
      setModelGroups(all);
      return;
    }

    const filtered = all.filter((g) => {
      // Always keep the group that contains the currently active model
      const isCurrentGroup = g.models.some((m) => m.model === currentModel && m.provider === currentProvider && (m.baseUrl || "") === (currentBaseUrl || ""));
      if (isCurrentGroup) return true;
      const key = groupKeyForFilter(g);
      if (!key) return true;
      return isPickerEnvSet(key);
    });
    setModelGroups(filtered);
  }, [modelsForPicker, pickerEnv, pickerEnvReady, currentModel, currentProvider, currentBaseUrl]);

  useEffect(() => {
    return window.hermesAPI.onConnectionConfigChanged(() => {
      setModelGroups([]);
      void reload();
    });
  }, [reload]);

  useEffect(() => {
    return window.hermesAPI.onModelLibraryChanged(() => {
      void reload();
    });
  }, [reload]);

  const selectModel = useCallback(
    async (
      provider: string,
      model: string,
      baseUrl: string,
      { persist = true }: { persist?: boolean } = {},
    ): Promise<void> => {
      const effectiveBaseUrl = effectiveOverrideBaseUrl(provider, baseUrl);
      isSessionScopedRef.current = !persist;
      setCurrentModel(model);
      setCurrentProvider(provider);
      setCurrentBaseUrl(effectiveBaseUrl);
      // Session-only selection: update local state only, do not write to
      // config.yaml so the global default model is preserved (issue #688).
      // Advance the sequence counter so any in-flight reload() triggered by
      // onConnectionConfigChanged / onModelLibraryChanged cannot clobber the
      // session-scoped selection with the persisted value.
      if (!persist) {
        ++loadSeqRef.current;
        return;
      }
      const seq = ++loadSeqRef.current;
      try {
        await window.hermesAPI.setModelConfig(
          provider,
          model,
          effectiveBaseUrl,
          profile,
        );
        const mc = await window.hermesAPI.getModelConfig(profile);
        if (seq !== loadSeqRef.current) return;
        setCurrentModel(mc.model);
        setCurrentProvider(mc.provider);
        setCurrentBaseUrl(mc.baseUrl);
      } catch (err) {
        if (seq === loadSeqRef.current) await reload();
        throw err;
      }
    },
    [profile, reload],
  );

  const displayModel = useMemo(
    () => {
      if (!currentModel) {
        return currentProvider === "auto" ? t("chat.auto") : t("chat.noModel");
      }
      const active = savedModels.find(
        (m) =>
          m.model === currentModel &&
          m.provider === currentProvider &&
          (m.baseUrl || "") === (currentBaseUrl || ""),
      );
      return active?.name?.trim() || currentModel.split("/").pop() || currentModel;
    },
    [currentModel, currentProvider, currentBaseUrl, savedModels, t],
  );

  return {
    currentModel,
    currentProvider,
    currentBaseUrl,
    modelGroups,
    displayModel,
    reload,
    selectModel,
  };
}
