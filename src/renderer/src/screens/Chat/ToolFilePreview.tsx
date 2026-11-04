import { memo, useEffect, useMemo, useRef, useState } from "react";
import { FileCode2 } from "lucide-react";
import { basicSetup } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import { languages } from "@codemirror/language-data";
import {
  FILE_PREVIEW_LIMIT,
  filePreviewText,
  latestFileTool,
  previewEditRange,
} from "./toolFilePreviewModel";
import type { ChatMessage } from "./types";

/** Read-only transactions animate the observed replacement, never save it. */
export function AnimatedFileCode({
  path,
  before,
  after,
  reading = false,
}: {
  path: string;
  before: string;
  after: string;
  reading?: boolean;
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const language = useMemo(() => new Compartment(), []);
  const started = useRef(false);
  const initialBefore = useRef(before);
  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        extensions: [
          basicSetup,
          oneDark,
          language.of([]),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.contentAttributes.of({
            "aria-label": "Live file preview code",
            "aria-readonly": "true",
            tabindex: "0",
          }),
        ],
      }),
    });
    editor.current = view;
    return () => {
      editor.current = null;
      view.destroy();
    };
  }, [language]);
  useEffect(() => {
    let cancelled = false;
    const extension = path.split(".").at(-1)?.toLowerCase();
    const description = languages.find((entry) =>
      entry.extensions.includes(extension ?? ""),
    );
    if (description)
      void description
        .load()
        .then((support) => {
          if (!cancelled)
            editor.current?.dispatch({
              effects: language.reconfigure(support),
            });
        })
        .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [path, language]);
  useEffect(() => {
    const view = editor.current;
    if (!view) return;
    const target = after.slice(0, FILE_PREVIEW_LIMIT);
    // Late snapshots must not reset an in-flight replay to its final contents.
    const old = reading
      ? target
      : started.current
        ? view.state.doc.toString()
        : initialBefore.current.slice(0, FILE_PREVIEW_LIMIT);
    started.current = true;
    const edit = previewEditRange(old, target);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: old },
      selection: { anchor: edit.from },
      effects: EditorView.scrollIntoView(edit.from, { y: "center" }),
    });
    // Insert-only replay starts immediately, without an empty deletion phase.
    const deletionTime = edit.to > edit.from ? 0.4 : 0;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let timer: ReturnType<typeof setTimeout> | undefined;
    let step = 0;
    // Character-sized steps for small edits; bounded batches for large files.
    const frames = reading
      ? 60
      : Math.min(
          180,
          Math.max(
            30,
            Math.ceil((edit.to - edit.from + edit.insert.length) / 3),
          ),
        );
    const settle = (): void => {
      host.current?.setAttribute("data-animating", "false");
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: target },
        selection: { anchor: 0, head: reading ? target.length : 0 },
      });
    };
    const tick = (): void => {
      step++;
      const progress = Math.min(1, step / frames);
      if (reading) {
        const end = Math.min(
          target.length,
          Math.ceil(target.length * progress),
        );
        view.dispatch({
          selection: { anchor: 0, head: end },
          effects: EditorView.scrollIntoView(end, { y: "center" }),
        });
        host.current?.setAttribute("data-animating", "true");
        if (step < frames) timer = setTimeout(tick, 24);
        else settle();
        return;
      }
      const deleting = progress < deletionTime;
      let end = deleting
        ? edit.to - Math.ceil(((edit.to - edit.from) * progress) / deletionTime)
        : edit.from;
      let count = deleting
        ? 0
        : Math.ceil(
            edit.insert.length *
              Math.max(0, (progress - deletionTime) / (1 - deletionTime)),
          );
      if (end > edit.from && /[\uD800-\uDBFF]/.test(old[end - 1])) end--;
      if (count && /[\uD800-\uDBFF]/.test(edit.insert[count - 1])) count++;
      const text =
        old.slice(0, end) + edit.insert.slice(0, count) + old.slice(edit.to);
      const change = previewEditRange(view.state.doc.toString(), text);
      const cursor = Math.min(text.length, end + count);
      view.dispatch({
        changes: change,
        selection: { anchor: cursor },
        effects: EditorView.scrollIntoView(cursor, { y: "center" }),
      });
      host.current?.setAttribute("data-animating", String(step < frames));
      if (step < frames) timer = setTimeout(tick, 30);
      else settle();
    };
    const finishReduced = (): void => {
      if (reduce?.matches) {
        clearTimeout(timer);
        settle();
      }
    };
    if (reduce?.matches || (!reading && old === target) || (reading && !target))
      settle();
    else timer = setTimeout(tick, 24);
    reduce?.addEventListener("change", finishReduced);
    return () => {
      clearTimeout(timer);
      reduce?.removeEventListener("change", finishReduced);
    };
  }, [after, reading]);
  useEffect(() => {
    host.current?.setAttribute("data-reading", String(reading));
  }, [reading]);

  return (
    <div className="file-viewer-cm-host tool-file-preview-code" ref={host} />
  );
}

const PreviewBody = memo(function PreviewBody({
  messages,
  baseDir,
  local,
}: {
  messages: readonly ChatMessage[];
  baseDir?: string;
  local: boolean;
}): React.JSX.Element | null {
  const file = useMemo(
    () => latestFileTool(messages, baseDir),
    [messages, baseDir],
  );
  const [snapshot, setSnapshot] = useState<{
    id: string;
    before?: string;
    after?: string;
    note?: string;
  }>({ id: "" });
  const id = file ? `${file.id}\0${file.path}` : undefined;
  const path = file?.path;
  const status = file?.status;
  useEffect(() => {
    if (!id || !path || !local) return;
    let disposed = false;
    void window.hermesAPI
      .readFile(path, FILE_PREVIEW_LIMIT)
      .then((result) => {
        if (disposed) return;
        if (!result) throw new Error("unavailable");
        if (
          [...result.content].some((char) => {
            const code = char.charCodeAt(0);
            return code < 9 || (code > 13 && code < 32) || code === 0xfffd;
          })
        )
          throw new Error("binary");
        const content = result.content.slice(0, FILE_PREVIEW_LIMIT);
        setSnapshot((previous) => ({
          id,
          ...(previous.id === id ? previous : {}),
          ...(status === "running" ? { before: content } : { after: content }),
          note:
            result.truncated || result.content.length > FILE_PREVIEW_LIMIT
              ? "Preview limited to 64 KB"
              : undefined,
        }));
      })
      .catch(() => {
        if (!disposed)
          setSnapshot((previous) => ({
            ...(previous.id === id ? previous : { id }),
            note: "File unavailable — showing tool payload only",
          }));
      });
    return () => {
      disposed = true;
    };
  }, [id, path, status, local]);
  if (!file) return null;
  const current = local && snapshot.id === id ? snapshot : undefined;
  const text = filePreviewText(file, current?.before, current?.after);
  const limited =
    text.before.length > FILE_PREVIEW_LIMIT ||
    text.after.length > FILE_PREVIEW_LIMIT;
  return (
    <aside className="tool-file-preview" aria-label="Live file preview">
      <header className="tool-file-preview-header">
        <FileCode2 size={16} aria-hidden="true" />
        <span title={file.path}>{file.path.split(/[\\/]/).at(-1)}</span>
        <span className="tool-file-preview-operation">{file.operation}</span>
      </header>
      <div className="tool-file-preview-path" title={file.path}>
        {file.path}
      </div>
      <div className="tool-file-preview-status" role="status">
        {file.status === "failed"
          ? "Tool failed"
          : "Read-only · animated tool replay"}
        {text.excerpt ? " · patch excerpt" : ""}
      </div>
      <AnimatedFileCode
        key={file.id}
        path={file.path}
        before={text.before}
        after={text.after}
        reading={file.operation === "Read"}
      />
      {(!local || current?.note || limited) && (
        <div className="tool-file-preview-note">
          {!local
            ? "Remote file — tool payload only"
            : (current?.note ?? "Preview limited to 64 KB")}
        </div>
      )}
    </aside>
  );
});

/** No history playback, background reads, editor timers or hidden-tab work. */
export function ToolFilePreview({
  messages,
  enabled,
  running,
  active,
  local,
  baseDir,
}: {
  messages: readonly ChatMessage[];
  enabled: boolean;
  running: boolean;
  active: boolean;
  local: boolean;
  baseDir?: string;
}): React.JSX.Element | null {
  return enabled && running && active ? (
    <PreviewBody messages={messages} baseDir={baseDir} local={local} />
  ) : null;
}
