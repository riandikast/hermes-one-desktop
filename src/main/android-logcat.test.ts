// @vitest-environment node
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn() }));
vi.mock("child_process", () => mocks);
import {
  listAndroidDevices,
  parseAndroidDevices,
  startAndroidLogcat,
  readAndroidLogcat,
  stopAndroidLogcat,
  stopOwnedAndroidLogcats,
} from "./android-logcat";

function child(): EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
} {
  return Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  stopOwnedAndroidLogcats(1);
  stopOwnedAndroidLogcats(2);
});
it("parses authorized, offline and unauthorized devices without hiding authorization state", () => {
  expect(
    parseAndroidDevices(
      "List of devices attached\nabc device product:x model:Pixel_9 device:z\nother unauthorized\nbroken offline\n* daemon started successfully *\n",
    ),
  ).toEqual([
    { serial: "abc", state: "device", label: "Pixel 9" },
    { serial: "other", state: "unauthorized", label: "other" },
    { serial: "broken", state: "offline", label: "broken" },
  ]);
});
it("reports missing ADB instead of pretending no phone is connected", async () => {
  mocks.execFile.mockImplementation((_path, _args, _options, callback) =>
    callback(Object.assign(new Error("missing"), { code: "ENOENT" }), ""),
  );
  expect(await listAndroidDevices()).toMatchObject({
    devices: [],
    error: expect.stringContaining("ADB not found"),
  });
});
it("streams split UTF-8 lines with bounded history and reads scoped to the owner", () => {
  const process = child();
  mocks.spawn.mockReturnValue(process);
  const id = startAndroidLogcat(1, "emulator-5554");
  expect(mocks.spawn.mock.calls[0][1]).toEqual([
    "-s",
    "emulator-5554",
    "logcat",
    "-v",
    "threadtime",
    "-T",
    "500",
  ]);
  const bytes = Buffer.from("11-04 12:30:00.000  123  124 E Tag: café\n");
  process.stdout.emit("data", bytes.subarray(0, bytes.length - 2));
  process.stdout.emit("data", bytes.subarray(bytes.length - 2));
  expect(readAndroidLogcat(1, id, 0).lines[0]).toMatchObject({
    text: expect.stringContaining("café"),
    priority: "E",
  });
  expect(() => readAndroidLogcat(2, id, 0)).toThrow("not found");
  process.stdout.emit(
    "data",
    Buffer.from(Array.from({ length: 2500 }, (_, n) => `line ${n}\n`).join("")),
  );
  const snapshot = readAndroidLogcat(1, id, 0);
  expect(snapshot.lines).toHaveLength(500);
  expect(snapshot.lines.at(-1)?.text).toBe("line 2499");
  expect(readAndroidLogcat(1, id, snapshot.lines.at(-1)!.seq).lines).toEqual(
    [],
  );
  stopAndroidLogcat(2, id);
  expect(process.kill).not.toHaveBeenCalled();
  stopAndroidLogcat(1, id);
  expect(process.kill).toHaveBeenCalledOnce();
});
it("rejects option injection and stops only owned children", () => {
  expect(() => startAndroidLogcat(1, "-a")).toThrow("Invalid");
  expect(() => startAndroidLogcat(1, "abc; echo bad")).toThrow("Invalid");
  const first = child(),
    second = child();
  mocks.spawn.mockReturnValueOnce(first).mockReturnValueOnce(second);
  startAndroidLogcat(1, "a");
  startAndroidLogcat(2, "b");
  stopOwnedAndroidLogcats(1);
  expect(first.kill).toHaveBeenCalledOnce();
  expect(second.kill).not.toHaveBeenCalled();
});
it("surfaces disconnects and asynchronous spawn errors", () => {
  const process = child();
  mocks.spawn.mockReturnValue(process);
  const id = startAndroidLogcat(1, "a");
  process.emit(
    "error",
    Object.assign(new Error("missing"), { code: "ENOENT" }),
  );
  expect(readAndroidLogcat(1, id, 0)).toMatchObject({
    running: false,
    error: expect.stringContaining("ADB not found"),
  });
});
