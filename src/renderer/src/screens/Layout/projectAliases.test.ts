import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getProjectAlias,
  getProjectAliasesSnapshot,
  normalizeProjectPath,
  projectDisplayName,
  setProjectAlias,
  subscribeProjectAliases,
  useProjectAliases,
} from "./projectAliases";

describe("normalizeProjectPath", () => {
  it("folds a Windows drive letter but keeps the rest of the path", () => {
    expect(normalizeProjectPath("C:\\Foo\\Bar")).toBe("c:/Foo/Bar");
  });

  it("strips trailing slashes and folds the drive letter on backslash paths", () => {
    expect(normalizeProjectPath("c:\\foo\\bar\\")).toBe("c:/foo/bar");
  });

  it("normalizes a Unix-style path", () => {
    expect(normalizeProjectPath("/a/b/")).toBe("/a/b");
  });

  it("folds mixed-separator paths with a drive prefix", () => {
    expect(normalizeProjectPath("C:/Foo/Bar")).toBe("c:/Foo/Bar");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeProjectPath("  /a/b  ")).toBe("/a/b");
  });
});

describe("project alias storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips an alias through localStorage", () => {
    setProjectAlias("C:\\Foo\\Bar", "My Project");
    expect(getProjectAlias("C:\\Foo\\Bar")).toBe("My Project");
  });

  it("returns null when no alias is stored", () => {
    expect(getProjectAlias("/a/b")).toBeNull();
  });

  it("overwrites an existing alias", () => {
    setProjectAlias("/a/b", "First");
    setProjectAlias("/a/b", "Second");
    expect(getProjectAlias("/a/b")).toBe("Second");
  });

  it("trims the stored alias name", () => {
    setProjectAlias("/a/b", "  Alias  ");
    expect(getProjectAlias("/a/b")).toBe("Alias");
  });

  it("removes the alias when given an empty name", () => {
    setProjectAlias("/a/b", "First");
    setProjectAlias("/a/b", "   ");
    expect(getProjectAlias("/a/b")).toBeNull();
    expect(projectDisplayName("/a/b")).toBe("b");
  });

  it("returns the basename when no alias is set", () => {
    expect(projectDisplayName("C:\\Foo\\Bar")).toBe("Bar");
    expect(projectDisplayName("/a/b")).toBe("b");
  });

  it("returns the alias when set", () => {
    setProjectAlias("/a/b", "My Project");
    expect(projectDisplayName("/a/b")).toBe("My Project");
  });

  it("falls back to the path itself when it has no basename", () => {
    expect(projectDisplayName("/")).toBe("/");
  });

  it("reads malformed JSON as an empty alias map", () => {
    localStorage.setItem("hermes.sidebar.projectAliases", "{not json");
    expect(getProjectAlias("/a/b")).toBeNull();
  });

  it("does not crash when localStorage.setItem throws", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota");
      });
    expect(() => setProjectAlias("/a/b", "Alias")).not.toThrow();
    spy.mockRestore();
  });

  it("does not crash when localStorage.getItem throws", () => {
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    expect(getProjectAlias("/a/b")).toBeNull();
    spy.mockRestore();
  });
});

describe("project alias reactivity", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("bumps the snapshot when an alias changes", () => {
    const before = getProjectAliasesSnapshot();
    setProjectAlias("/a/b", "Alias");
    expect(getProjectAliasesSnapshot()).not.toBe(before);
  });

  it("bumps the snapshot when an alias is removed", () => {
    setProjectAlias("/a/b", "Alias");
    const before = getProjectAliasesSnapshot();
    setProjectAlias("/a/b", "");
    expect(getProjectAliasesSnapshot()).not.toBe(before);
  });

  it("notifies local subscribers when an alias changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeProjectAliases(listener);
    setProjectAlias("/a/b", "Alias");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeProjectAliases(listener);
    unsubscribe();
    setProjectAlias("/a/b", "Alias");
    expect(listener).not.toHaveBeenCalled();
  });

  it("updates the useProjectAliases snapshot on change", () => {
    const { result } = renderHook(() => useProjectAliases());
    const before = result.current;
    act(() => {
      setProjectAlias("/a/b", "Alias");
    });
    expect(result.current).not.toBe(before);
  });
});
