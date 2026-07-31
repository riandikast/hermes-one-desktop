import { describe, expect, it } from "vitest";
import {
  MENTION_END,
  MENTION_SEP,
  MENTION_START,
  displayText,
  displayToRawPos,
  expandTags,
  findMention,
  parseTags,
  rankMentions,
  rawToDisplayPos,
  scoreFuzzy,
  truncatePath,
} from "./mention";
import type { MentionEntry } from "./mention";

const EN = (name: string, isDirectory = false): MentionEntry => ({
  name,
  isDirectory,
  path: "/root/" + name,
});

describe("mention tags", () => {
  it("round-trips name → path and reports positions", () => {
    const tag = MENTION_START + "main.js" + MENTION_SEP + "/a/b/main.js" + MENTION_END;
    const text = "see " + tag + " now";
    expect(expandTags(text)).toBe("see /a/b/main.js now");
    const tags = parseTags(text);
    expect(tags).toHaveLength(1);
    expect(tags[0]).toMatchObject({
      name: "main.js",
      path: "/a/b/main.js",
      start: 4,
      end: 4 + tag.length,
    });
  });

  it("handles multiple tags", () => {
    const t1 = MENTION_START + "a.ts" + MENTION_SEP + "/x/a.ts" + MENTION_END;
    const t2 = MENTION_START + "b.ts" + MENTION_SEP + "/y/b.ts" + MENTION_END;
    expect(expandTags(t1 + " " + t2)).toBe("/x/a.ts /y/b.ts");
    expect(parseTags(t1 + " " + t2)).toHaveLength(2);
  });

  it("strips stray markers", () => {
    expect(expandTags("a\uE000b")).toBe("ab");
  });
});

describe("scoreFuzzy", () => {
  it("rejects when chars are missing or out of order", () => {
    expect(scoreFuzzy("abc", "xyz")).toBeNull();
    expect(scoreFuzzy("ba", "ab")).toBeNull();
  });

  it("matches subsequences", () => {
    expect(scoreFuzzy("lhr", "laporan_ht.dart")).not.toBeNull();
    expect(scoreFuzzy("lhr", "lh_attendance.dart")).not.toBeNull();
  });

  it("prefers prefix and contiguous runs", () => {
    const prefix = scoreFuzzy("chat", "chat_input.tsx");
    const scattered = scoreFuzzy("chat", "cache_handler_a.ts");
    expect(prefix).not.toBeNull();
    expect(scattered).not.toBeNull();
    expect(prefix!).toBeLessThan(scattered!);
  });

  it("ranks exact prefix over loose subsequence of same target", () => {
    const tight = scoreFuzzy("inp", "input.ts");
    const loose = scoreFuzzy("ip", "input.ts");
    expect(tight).not.toBeNull();
    expect(loose).not.toBeNull();
    expect(tight!).toBeLessThan(loose!);
  });

  it("handles case-insensitivity", () => {
    expect(scoreFuzzy("LHR", "Laporan_Ht.dart")).not.toBeNull();
    expect(scoreFuzzy("lhr", "LAPORAN_HT.dart")).not.toBeNull();
  });
});

describe("truncatePath", () => {
  it("leaves short paths untouched", () => {
    expect(truncatePath("src/main.js")).toBe("src/main.js");
  });

  it("keeps head and tail, joins with ...", () => {
    const out = truncatePath(
      "src/renderer/src/screens/Chat/ChatInput.tsx",
      12,
      26,
    );
    expect(out.startsWith("src/renderer")).toBe(true);
    expect(out.endsWith("screens/Chat/ChatInput.tsx")).toBe(true);
    expect(out).toContain("...");
    expect(out.length).toBeLessThan(
      "src/renderer/src/screens/Chat/ChatInput.tsx".length,
    );
  });
});

describe("findMention", () => {
  it("returns null without @", () => {
    expect(findMention("hello world", 11)).toBeNull();
  });

  it("detects a bare @ at caret", () => {
    expect(findMention("hi @", 4)).toEqual({ start: 3, query: "", folderOnly: false });
  });

  it("detects @ at string start", () => {
    expect(findMention("@lo", 3)).toEqual({ start: 0, query: "lo", folderOnly: false });
  });

  it("detects @ after whitespace only", () => {
    expect(findMention("see @lo", 7)).toEqual({ start: 4, query: "lo", folderOnly: false });
  });

  it("ignores @ glued to a word (email, mention)", () => {
    expect(findMention("x@y", 3)).toBeNull();
    expect(findMention("a@b@c", 5)).toBeNull();
  });

  it("caps the query at whitespace or another @", () => {
    expect(findMention("hi @a b", 7)).toEqual({ start: 3, query: "a", folderOnly: false });
    expect(findMention("hi @@", 5)).toBeNull();
  });

  it("uses only the last @ on the current word", () => {
    expect(findMention("@old @new", 9)).toEqual({ start: 5, query: "new", folderOnly: false });
  });

  it("detects @/ as a folder token", () => {
    expect(findMention("@/src", 5)).toEqual({ start: 0, query: "src", folderOnly: true });
  });

  it("detects a bare @/ (all folders)", () => {
    expect(findMention("hi @/", 5)).toEqual({ start: 3, query: "", folderOnly: true });
  });

  it("caps a folder query at whitespace", () => {
    expect(findMention("@/a b", 6)).toEqual({ start: 0, query: "a", folderOnly: true });
  });

  it("keeps nested slashes in the folder query", () => {
    expect(findMention("@/a/b", 5)).toEqual({ start: 0, query: "a/b", folderOnly: true });
  });

  it("ignores @/ glued to a word", () => {
    expect(findMention("x@/y", 4)).toBeNull();
  });
});

describe("rankMentions", () => {
  it("exact basename match ranks first", () => {
    const entries = [
      EN("src/main/ipc/register.ts"),
      EN("app/src/MainActivity.kt"),
      EN("main_helper.ts"),
    ];
    const out = rankMentions("MainActivity.kt", entries, false);
    expect(out[0].name).toBe("app/src/MainActivity.kt");
  });

  it("exact beats prefix, prefix beats path substring", () => {
    const entries = [
      EN("src/main/ipc/register.ts"),
      EN("b/main.ts"),
      EN("a/main.tsx"),
    ];
    const out = rankMentions("main.ts", entries, false);
    expect(out.map((e) => e.name)).toEqual(["b/main.ts", "a/main.tsx", "src/main/ipc/register.ts"]);
  });

  it("basename prefix outranks substring matches in the full path", () => {
    const entries = [
      EN("src/main/ipc/register.ts"),
      EN("src/maintenance/db.ts"),
      EN("app/MainActivity.kt"),
    ];
    const out = rankMentions("main", entries, false);
    expect(out[0].name).toBe("app/MainActivity.kt");
  });

  it("shorter path wins exact-name ties", () => {
    const entries = [EN("deep/nested/dir/main.ts"), EN("main.ts")];
    const out = rankMentions("main.ts", entries, false);
    expect(out.map((e) => e.name)).toEqual(["main.ts", "deep/nested/dir/main.ts"]);
  });

  it("exact name + extension wins case-insensitively", () => {
    const entries = [
      EN("app/src/MainActivity.kt"),
      EN("src/main/MainActivity2.kt"),
      EN("tools/activity.kt"),
    ];
    const out = rankMentions("MAINACTIVITY.KT", entries, false);
    expect(out[0].name).toBe("app/src/MainActivity.kt");
  });

  it("exact basename with extension outranks prefix lookalikes", () => {
    const entries = [
      EN("app/src/main/MainActivity.kt.bak"),
      EN("app/src/MainActivity.kt"),
      EN("app/src/MainActivity.ktx"),
      EN("tests/MainActivityTest.kt"),
    ];
    const out = rankMentions("MainActivity.kt", entries, false);
    expect(out[0].name).toBe("app/src/MainActivity.kt");
  });

  it("basename substring outranks plain subsequence (camelCase middle)", () => {
    const entries = [
      EN("src/renderer/GlRenderer.ts"),
      EN("src/g_loader_rerender.ts"),
      EN("src/main/gl/render/engine.ts"),
    ];
    const out = rankMentions("GlRenderer", entries, false);
    expect(out[0].name).toBe("src/renderer/GlRenderer.ts");
  });

  it("exact full path outranks fuzzy basename matches", () => {
    const entries = [
      EN("app/src/main.ts"),
      EN("app/src/MainActivity.kt"),
      EN("src/main.ts"),
    ];
    const out = rankMentions("app/src/MainActivity.kt", entries, false);
    expect(out[0].name).toBe("app/src/MainActivity.kt");
  });

  it("matches queries typed with Windows backslashes", () => {
    const entries = [
      EN("app/src/main/ipc/register.ts"),
      EN("src/register.ts"),
    ];
    const out = rankMentions("app\\src\\main\\ipc\\register.ts", entries, false);
    expect(out[0].name).toBe("app/src/main/ipc/register.ts");
  });

  it("folder token filters to directories only", () => {
    const entries = [EN("src", true), EN("src/main.ts"), EN("src/lib", true), EN("README.md")];
    const out = rankMentions("", entries, true);
    expect(out.map((e) => e.name)).toEqual(["src", "src/lib"]);
  });

  it("file token excludes directories", () => {
    const entries = [EN("src", true), EN("src/main.ts")];
    const out = rankMentions("", entries, false);
    expect(out.map((e) => e.name)).toEqual(["src/main.ts"]);
  });

  it("keeps hint rows (empty path) in both modes", () => {
    const hint: MentionEntry = { name: "No folder selected", isDirectory: false, path: "" };
    const src = EN("src", true);
    expect(rankMentions("", [src, hint], true)).toEqual([src, hint]);
    expect(rankMentions("", [src, hint], false)).toEqual([hint]);
  });

  it("rejects entries with no fuzzy match", () => {
    const entries = [EN("aaa.ts"), EN("bbb.ts")];
    expect(rankMentions("zzz", entries, false)).toEqual([]);
  });
});

describe("displayText / displayToRawPos / rawToDisplayPos", () => {
  const tag = (name: string, path: string): string =>
    MENTION_START + name + MENTION_SEP + path + MENTION_END;

  it("collapses tag inner text to a single zero-width space (no PUA leak)", () => {
    const raw = `see ${tag("main.js", "/a/b/main.js")} now`;
    const d = displayText(raw);
    expect(d).toBe("see \u200B now");
    expect(d).not.toMatch(/[\uE000\uE001\uE002]/);
    expect(d.length).toBeLessThan(raw.length);
  });

  it("round-trips caret positions before, inside, and after a tag", () => {
    const raw = `a ${tag("x.ts", "/p/x.ts")} z`;
    const d = displayText(raw); // "a \u200B z"
    expect(displayToRawPos(raw, 2)).toBe(2);
    expect(displayToRawPos(raw, 3)).toBe(2 + tag("x.ts", "/p/x.ts").length);
    expect(displayToRawPos(raw, 4)).toBe(2 + tag("x.ts", "/p/x.ts").length + 1);
    expect(displayToRawPos(raw, d.length)).toBe(raw.length);
  });

  it("round-trips raw offsets to display offsets", () => {
    const raw = `a ${tag("x.ts", "/p/x.ts")} z`;
    const d = displayText(raw);
    expect(rawToDisplayPos(raw, 0)).toBe(0);
    expect(rawToDisplayPos(raw, 2)).toBe(2);
    expect(rawToDisplayPos(raw, 2 + tag("x.ts", "/p/x.ts").length)).toBe(3);
    expect(rawToDisplayPos(raw, raw.length)).toBe(d.length);
  });

  it("handles multiple tags", () => {
    const raw = `${tag("a.ts", "/x/a.ts")} ${tag("b.ts", "/y/b.ts")}`;
    const d = displayText(raw);
    expect(d.match(/\u200B/g)).toHaveLength(2);
    expect(displayToRawPos(raw, d.length)).toBe(raw.length);
    expect(rawToDisplayPos(raw, raw.length)).toBe(d.length);
  });

  it("leaves plain text untouched", () => {
    expect(displayText("hello @world")).toBe("hello @world");
    expect(displayToRawPos("hello", 3)).toBe(3);
  });
});
