// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  PINNED_IDS_KEY,
  PINNED_META_KEY,
  getPinnedIdsKey,
  getPinnedMetaKey,
  readStoredPinned,
  readStoredPinnedMeta,
  storePinned,
} from "./SidebarRecentSessions";

describe("pinned chats persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("isolates storage keys per profile with fallback for default", () => {
    expect(getPinnedIdsKey("default")).toBe(PINNED_IDS_KEY);
    expect(getPinnedIdsKey("work")).toBe("hermes.sidebar.pinnedSessions.work");
    expect(getPinnedMetaKey("default")).toBe(PINNED_META_KEY);
    expect(getPinnedMetaKey("work")).toBe("hermes.sidebar.pinnedMetadata.work");
  });

  it("persists pinned IDs and metadata across restart for default profile", () => {
    const session = {
      id: "session-123",
      title: "Pinned task conversation",
      contextFolder: "C:/projects/app",
      contextFolders: ["C:/projects/app"],
      parentSessionId: null,
    };
    const metaMap = new Map([["session-123", session]]);
    const ids = new Set(["session-123"]);

    storePinned("default", ids, metaMap);

    // Verify localStorage has both IDs and full metadata
    expect(localStorage.getItem(PINNED_IDS_KEY)).toContain("session-123");
    expect(localStorage.getItem(PINNED_META_KEY)).toContain("Pinned task conversation");

    // Simulate app restart / fresh mount
    const loadedIds = readStoredPinned("default");
    const loadedMeta = readStoredPinnedMeta("default");

    expect(loadedIds.has("session-123")).toBe(true);
    expect(loadedMeta.get("session-123")).toEqual(session);
  });

  it("supports profile isolation between different profiles", () => {
    const defaultSession = {
      id: "sess-default",
      title: "Default Chat",
      contextFolder: null,
      contextFolders: [],
      parentSessionId: null,
    };
    const workSession = {
      id: "sess-work",
      title: "Work Chat",
      contextFolder: "D:/work",
      contextFolders: ["D:/work"],
      parentSessionId: null,
    };

    storePinned("default", new Set(["sess-default"]), new Map([["sess-default", defaultSession]]));
    storePinned("work", new Set(["sess-work"]), new Map([["sess-work", workSession]]));

    const defaultIds = readStoredPinned("default");
    const workIds = readStoredPinned("work");

    expect(defaultIds.has("sess-default")).toBe(true);
    expect(defaultIds.has("sess-work")).toBe(false);

    expect(workIds.has("sess-work")).toBe(true);
    expect(workIds.has("sess-default")).toBe(false);
  });

  it("retains pinned metadata when session is not in recent sessions list (e.g. after tab closed)", () => {
    const oldSession = {
      id: "old-session-456",
      title: "Important Reference Chat",
      contextFolder: "C:/docs",
      contextFolders: ["C:/docs"],
      parentSessionId: null,
    };

    storePinned("default", new Set(["old-session-456"]), new Map([["old-session-456", oldSession]]));

    // When only other sessions are loaded in recent sessions (closed tab was dropped from top N)
    const loadedMeta = readStoredPinnedMeta("default");
    expect(loadedMeta.has("old-session-456")).toBe(true);
    expect(loadedMeta.get("old-session-456")?.title).toBe("Important Reference Chat");
  });
});
