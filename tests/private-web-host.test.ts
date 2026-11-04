// @vitest-environment node
import { expect, it } from "vitest";
import { isPrivateWebHost } from "../src/shared/private-web-host";
import { isAllowedWebviewUrl } from "../src/main/security";
import { normaliseUrlInput } from "../src/renderer/src/screens/Chat/browserTabs";

it("permits exact private HTTP only in the sandboxed browser preview", () => {
  for (const host of [
    "10.3.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
  ]) {
    expect(isPrivateWebHost(host)).toBe(true);
    expect(normaliseUrlInput(`${host}/app`)).toBe(`http://${host}/app`);
    expect(isAllowedWebviewUrl(`http://${host}/app`, true)).toBe(true);
    expect(isAllowedWebviewUrl(`http://${host}:8080/app`, true)).toBe(true);
    expect(isAllowedWebviewUrl(`http://${host}:8080/app`)).toBe(false);
  }
  expect(isAllowedWebviewUrl("http://localhost/", true)).toBe(true);
  expect(isAllowedWebviewUrl("http://localhost/")).toBe(false);
});

it("keeps public HTTP and malformed or credentialed LAN addresses blocked", () => {
  for (const host of [
    "172.15.255.255",
    "172.32.0.1",
    "192.169.1.1",
    "8.8.8.8",
    "10.3.0",
    "10.999.0.1",
    "010.3.0.1",
  ]) {
    expect(isPrivateWebHost(host)).toBe(false);
    expect(isAllowedWebviewUrl(`http://${host}/`, true)).toBe(false);
  }
  expect(normaliseUrlInput("10.3.0")).toBe("https://10.3.0");
  expect(normaliseUrlInput("https://10.3.0.1")).toBe("https://10.3.0.1");
  expect(isAllowedWebviewUrl("http://user:pass@10.3.0.1", true)).toBe(false);
  expect(isAllowedWebviewUrl("http://10.3.0.1:99999", true)).toBe(false);
  expect(isAllowedWebviewUrl("file:///C:/private", true)).toBe(false);
});
