import { useEffect, useMemo, useState } from "react";
import { Search, Wrench } from "lucide-react";
import { useFileAutosaveDefault } from "./fileAutosave";
import { useSendConfirm } from "./sendConfirm";
import { useDefaultKnowledge } from "./defaultKnowledge";
import SettingsHint from "./SettingsHint";
import { KNOWLEDGE_RENAMED } from "../../screens/Knowledge/knowledgeSelection";

/**
 * Utilities that shape how the app's built-in tools behave. Starts with the
 * default save mode for the file editor; per-file overrides live in the
 * editor's own toolbar.
 */
export default function UtilsPane(): React.JSX.Element {
  const [autoSave, setAutoSave] = useFileAutosaveDefault();
  const [saveError, setSaveError] = useState(false);
  const [sendConfirm, setSendConfirm] = useSendConfirm();
  const [confirmError, setConfirmError] = useState(false);
  const [defaultKnowledge, setDefaultKnowledge] = useDefaultKnowledge();
  const [knowledgeError, setKnowledgeError] = useState(false);
  const [bundles, setBundles] = useState<Array<{ name: string; path: string }>>([]);
  const [bundlesLoading, setBundlesLoading] = useState(true);
  const [bundlesFailed, setBundlesFailed] = useState(false);
  const [bundleQuery, setBundleQuery] = useState("");

  const filteredBundles = useMemo(() => {
    const query = bundleQuery.trim().toLowerCase();
    if (!query) return bundles;
    return bundles.filter(
      (bundle) =>
        bundle.name.toLowerCase().includes(query) ||
        bundle.path.toLowerCase().includes(query),
    );
  }, [bundles, bundleQuery]);

  // Same source as the chat's Knowledge chip, so the list is always the
  // bundles that actually exist on the Knowledge page.
  useEffect(() => {
    let cancelled = false;
    const load = window.hermesAPI?.listKnowledgeBundles;
    if (typeof load !== "function") {
      setBundlesLoading(false);
      return;
    }
    const refresh = (): void => { void load
      .call(window.hermesAPI)
      .then((list) => {
        if (!cancelled && Array.isArray(list)) setBundles(list);
      })
      .catch(() => {
        if (!cancelled) setBundlesFailed(true);
      })
      .finally(() => {
        if (!cancelled) setBundlesLoading(false);
      }); };
    refresh();
    window.addEventListener(KNOWLEDGE_RENAMED, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(KNOWLEDGE_RENAMED, refresh);
    };
  }, []);

  const choose = (next: boolean): void => {
    if (next === autoSave) return;
    setSaveError(!setAutoSave(next));
  };

  const chooseConfirm = (next: boolean): void => {
    if (next === sendConfirm) return;
    setConfirmError(!setSendConfirm(next));
  };

  const toggleBundle = (name: string): void => {
    const next = defaultKnowledge.includes(name)
      ? defaultKnowledge.filter((item) => item !== name)
      : [...defaultKnowledge, name];
    setKnowledgeError(!setDefaultKnowledge(next));
  };

  return (
    <div className="settings-pane">
      <header className="settings-pane-head">
        <h2>
          <Wrench size={18} aria-hidden="true" /> Utils
        </h2>
        <p className="settings-pane-subtitle">
          Defaults for the app&rsquo;s built-in tools. Individual files can
          override the editor behaviour from the editor toolbar.
        </p>
      </header>

      <div className="settings-group">
        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-label">File editor auto-save</div>
            {saveError ? (
              <div className="settings-row-hint">Could not save the editor preference.</div>
            ) : (
              <SettingsHint>
                Newly opened files save 500 ms after the last keystroke. Turn it off to save manually with the toolbar button or Ctrl+S.
              </SettingsHint>
            )}
          </div>
          <div
            className="settings-seg"
            role="group"
            aria-label="Default file editor auto-save"
          >
            {([true, false] as const).map((value) => (
              <button
                key={String(value)}
                type="button"
                className={`settings-seg-btn ${autoSave === value ? "active" : ""}`}
                aria-pressed={autoSave === value}
                onClick={() => choose(value)}
              >
                {value ? "On" : "Off"}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-label">Send prompt confirmation</div>
            {confirmError ? (
              <div className="settings-row-hint">Could not save the send preference.</div>
            ) : (
              <SettingsHint>
                Off (default): Enter sends immediately. On: the first Enter asks again — naming the target project — before the prompt is sent.
              </SettingsHint>
            )}
          </div>
          <div
            className="settings-seg"
            role="group"
            aria-label="Send prompt confirmation"
          >
            {([true, false] as const).map((value) => (
              <button
                key={String(value)}
                type="button"
                className={`settings-seg-btn ${sendConfirm === value ? "active" : ""}`}
                aria-pressed={sendConfirm === value}
                onClick={() => chooseConfirm(value)}
              >
                {value ? "On" : "Off"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-row settings-row--stacked">
          <div className="settings-row-text">
            <div className="settings-row-label">Default knowledge</div>
            {knowledgeError ? (
              <div className="settings-row-hint">Could not save the knowledge defaults.</div>
            ) : (
              <SettingsHint>
                Attached automatically to every new session. Existing sessions keep their own selection — toggle bundles per chat from the Knowledge chip.
              </SettingsHint>
            )}
          </div>
          <div className="settings-knowledge">
            {!bundlesLoading && !bundlesFailed && bundles.length > 0 && (
              <div className="settings-knowledge-toolbar">
                <label className="settings-knowledge-search">
                  <Search size={14} aria-hidden="true" />
                  <input
                    type="search"
                    value={bundleQuery}
                    onChange={(event) => setBundleQuery(event.target.value)}
                    placeholder="Search bundles"
                    aria-label="Search knowledge bundles"
                  />
                </label>
                <span className="settings-knowledge-count">
                  {defaultKnowledge.length} selected
                </span>
              </div>
            )}
            <div
              className="settings-knowledge-list"
              role="group"
              aria-label="Default knowledge bundles"
            >
              {!bundlesLoading && !bundlesFailed && defaultKnowledge.filter((name) => !bundles.some((bundle) => bundle.name === name)).map((name) => (
                <label key={`missing:${name}`} className="settings-check">
                  <input type="checkbox" checked onChange={() => toggleBundle(name)} />
                  <span className="settings-check-text">{name} (missing)</span>
                </label>
              ))}
              {bundlesLoading ? (
                <span className="settings-knowledge-empty">Loading…</span>
              ) : bundlesFailed ? (
                <span className="settings-knowledge-empty" role="alert">
                  Could not load knowledge bundles.
                </span>
              ) : bundles.length === 0 ? (
                <span className="settings-knowledge-empty">
                  No knowledge bundles yet. Create one on the Knowledge page.
                </span>
              ) : filteredBundles.length === 0 ? (
                <span className="settings-knowledge-empty">
                  No bundles match “{bundleQuery.trim()}”.
                </span>
              ) : (
                filteredBundles.map((bundle) => (
                  <label key={bundle.name} className="settings-check" title={bundle.path}>
                    <input
                      type="checkbox"
                      checked={defaultKnowledge.includes(bundle.name)}
                      onChange={() => toggleBundle(bundle.name)}
                    />
                    <span className="settings-check-text">{bundle.name}</span>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
