import { webcrypto } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  cloudInputNames,
  liveInputState,
  livePasswordLoginAndSync,
  officialCloudEnvironment,
  requireLiveInputSet,
  selfHostedInputNames,
  selfHostedLiveEnvironment,
} from "./live-standard-password-login";
import { resolveLiveDisposition } from "./live-test-protocol";

test.use({ screenshot: "off", trace: "off", video: "off" });
test.describe.configure({ mode: "serial", timeout: 120_000 });

test.beforeAll(() => {
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto });
});

test("pins official US and EU Web API and Identity API contracts", () => {
  expect(officialCloudEnvironment("US")).toEqual({
    apiUrl: "https://api.bitwarden.com",
    identityUrl: "https://identity.bitwarden.com",
    iconsUrl: "https://icons.bitwarden.net",
    webVaultUrl: "https://vault.bitwarden.com",
    sendUrl: "https://send.bitwarden.com",
  });
  expect(officialCloudEnvironment("EU")).toEqual({
    apiUrl: "https://api.bitwarden.eu",
    identityUrl: "https://identity.bitwarden.eu",
    iconsUrl: "https://icons.bitwarden.eu",
    webVaultUrl: "https://vault.bitwarden.eu",
    sendUrl: "https://vault.bitwarden.eu",
  });
});

test("pins path-preserving self-hosted Web API and Identity API contracts", () => {
  expect(selfHostedLiveEnvironment("https://vault.example.test/base/")).toEqual({
    apiUrl: "https://vault.example.test/base/api",
    identityUrl: "https://vault.example.test/base/identity",
    iconsUrl: "https://vault.example.test/base/icons",
    webVaultUrl: "https://vault.example.test/base",
    sendUrl: "https://vault.example.test/base",
  });
});

test("rejects partial runtime input without reflecting any supplied value", () => {
  const partial = { BARWARDEN_LIVE_SERVER_URL: "https://private.invalid.test" };
  expect(liveInputState(selfHostedInputNames, partial)).toBe("partial");
  expect(() => requireLiveInputSet(selfHostedInputNames, partial)).toThrow(
    "Live test input configuration is incomplete",
  );
});

test("performs opt-in read-only self-hosted password login and sync", async () => {
  const disposition = resolveLiveDisposition(selfHostedInputNames, "read-only");
  test.skip(disposition.status !== "ready", disposition.reasonCode);
  const inputs = requireLiveInputSet(selfHostedInputNames);
  await livePasswordLoginAndSync(
    selfHostedLiveEnvironment(inputs.BARWARDEN_LIVE_SERVER_URL),
    inputs.BARWARDEN_LIVE_EMAIL,
    inputs.BARWARDEN_LIVE_PASSWORD,
  );
});

test("performs opt-in read-only official cloud password login and sync", async () => {
  const disposition = resolveLiveDisposition(cloudInputNames, "read-only");
  test.skip(disposition.status !== "ready", disposition.reasonCode);
  const inputs = requireLiveInputSet(cloudInputNames);
  await livePasswordLoginAndSync(
    officialCloudEnvironment(inputs.BARWARDEN_LIVE_CLOUD_REGION),
    inputs.BARWARDEN_LIVE_CLOUD_EMAIL,
    inputs.BARWARDEN_LIVE_CLOUD_PASSWORD,
  );
});
