import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { getDbConnection, closeDbConnection } from "../src/main/db";
import { activeStateDbPath } from "../src/main/utils";

// Define hoisted mocks (Vitest allows variables prefixed with 'mock')
const { mockClose, mockDatabaseConstructor, mockExistsSync } = vi.hoisted(
  () => {
    const mockClose = vi.fn();
    const mockDatabaseConstructor = vi.fn().mockImplementation(() => {
      return {
        close: mockClose,
        open: true,
      };
    });
    const mockExistsSync = vi.fn();
    return { mockClose, mockDatabaseConstructor, mockExistsSync };
  },
);

vi.mock("better-sqlite3", () => {
  return {
    default: vi.fn().mockImplementation(function (
      dbPath: string,
      options: unknown,
    ) {
      return mockDatabaseConstructor(dbPath, options);
    }),
  };
});

// Mock activeStateDbPath and existsSync
vi.mock("../src/main/utils", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/main/utils")>();
  return {
    ...original,
    activeStateDbPath: vi.fn(),
  };
});

// Lazy evaluation prevents reference errors during hoisting
vi.mock("fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("fs")>();
  return {
    ...original,
    existsSync: (path: string) => mockExistsSync(path),
    default: {
      ...original,
      existsSync: (path: string) => mockExistsSync(path),
    },
  };
});

describe("Database connection caching", () => {
  const dbPath1 = "/fake/path/state1.db";
  const dbPath2 = "/fake/path/state2.db";

  beforeEach(() => {
    mockClose.mockReset();
    mockDatabaseConstructor.mockClear();
    mockExistsSync.mockReset();
    vi.mocked(activeStateDbPath).mockReset();
    mockExistsSync.mockReturnValue(true); // default to true
  });

  afterEach(() => {
    closeDbConnection();
  });

  it("returns null if database file does not exist", () => {
    vi.mocked(activeStateDbPath).mockReturnValue(dbPath1);
    mockExistsSync.mockReturnValue(false);

    const db = getDbConnection();
    expect(db).toBeNull();
    expect(mockDatabaseConstructor).not.toHaveBeenCalled();
  });

  it("caches database connection for same path and readonly status", () => {
    vi.mocked(activeStateDbPath).mockReturnValue(dbPath1);
    mockExistsSync.mockReturnValue(true);

    const db1 = getDbConnection(true);
    const db2 = getDbConnection(true);

    expect(db1).not.toBeNull();
    expect(db2).not.toBeNull();
    expect(db1).toBe(db2); // Cached same connection
    expect(mockDatabaseConstructor).toHaveBeenCalledTimes(1);
  });

  it("re-creates connection if database path changes (e.g. profile switch)", () => {
    mockExistsSync.mockReturnValue(true);

    vi.mocked(activeStateDbPath).mockReturnValue(dbPath1);
    const db1 = getDbConnection(true);

    vi.mocked(activeStateDbPath).mockReturnValue(dbPath2);
    const db2 = getDbConnection(true);

    expect(db1).not.toBeNull();
    expect(db2).not.toBeNull();
    expect(db1).not.toBe(db2); // Different connection because path changed
    // Path switch closes the old cached connections (read + write).
    expect(mockDatabaseConstructor).toHaveBeenCalledTimes(2);
  });

  it("keeps separate readonly and writable connections without thrashing", () => {
    vi.mocked(activeStateDbPath).mockReturnValue(dbPath1);
    mockExistsSync.mockReturnValue(true);

    const dbRead = getDbConnection(true);
    const dbWrite = getDbConnection(false);

    expect(dbRead).not.toBeNull();
    expect(dbWrite).not.toBeNull();
    // Reads use a readonly connection (no lock conflict with the agent CLI);
    // writes use a separate read-write connection. Both are cached and reused,
    // never closed/reopened on flag flips.
    expect(dbRead).not.toBe(dbWrite);
    expect(mockDatabaseConstructor).toHaveBeenCalledTimes(2);
    expect(mockClose).not.toHaveBeenCalled();
  });

  it("closes connection on closeDbConnection", () => {
    vi.mocked(activeStateDbPath).mockReturnValue(dbPath1);
    mockExistsSync.mockReturnValue(true);

    const db = getDbConnection(true);
    expect(db).not.toBeNull();

    closeDbConnection();
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it("does not thrash when switching back and forth repeatedly", () => {
    vi.mocked(activeStateDbPath).mockReturnValue(dbPath1);
    mockExistsSync.mockReturnValue(true);

    getDbConnection(true);
    getDbConnection(false);
    getDbConnection(true);
    getDbConnection(false);
    getDbConnection(true);

    expect(mockDatabaseConstructor).toHaveBeenCalledTimes(2); // read + write
    expect(mockClose).not.toHaveBeenCalled();
  });
});
