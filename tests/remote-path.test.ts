import { describe, expect, it } from "vitest";
import {
  isRemotePath,
  parseRemotePath,
  remoteBaseName,
  remotePath,
} from "../src/shared/remote-path";

describe("remote path encoding", () => {
  it("round-trips a connection id and absolute path", () => {
    const encoded = remotePath("ab12cd34", "/home/me/project");
    expect(encoded).toBe("ssh://ab12cd34/home/me/project");
    expect(isRemotePath(encoded)).toBe(true);
    expect(parseRemotePath(encoded)).toEqual({
      connectionId: "ab12cd34",
      path: "/home/me/project",
    });
    expect(remoteBaseName(encoded)).toBe("project");
  });

  it("normalizes relative segments and rejects malformed values", () => {
    expect(remotePath("id", "home/me")).toBe("ssh://id/home/me");
    expect(parseRemotePath("ssh://id")).toBeNull();
    expect(parseRemotePath("ssh:///home")).toBeNull();
    expect(parseRemotePath("C:/local/file.ts")).toBeNull();
    expect(isRemotePath("C:/local/file.ts")).toBe(false);
  });
});
