import "zone.js";
import "@angular/compiler";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it } from "vitest";

import type { AuthSession } from "../../auth/auth-session-store";
import { buildSelfHostedEnvironmentFromServerUrl } from "../../bitwarden-api/bitwarden-api";
import { PopupStateStore } from "../popup-state";
import { SettingsService } from "../settings/settings.service";
import { demoVaultItems } from "../vault-demo";
import { VaultItemIconComponent } from "./vault-item-icon.component";
import type { VaultItem } from "./vault-item.model";

const OVERLONG_DNS_LABEL = "a".repeat(64);
const OVERLONG_DNS_HOSTNAME = Array.from({ length: 4 }, () => "a".repeat(63)).join(".");

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("VaultItemIconComponent", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("builds the official US favicon URL from the first login URI", async () => {
    const { host } = await renderIcon(demoVaultItems[0]);

    expect(host.querySelector("img")?.getAttribute("src")).toBe(
      "https://icons.bitwarden.net/github.com/icon.png",
    );
  });

  it("uses only the canonical hostname when the login URI contains private URL parts", async () => {
    const item: VaultItem = {
      ...demoVaultItems[0],
      uris: [{
        id: "private-uri",
        uri: "https://vault-user:private-password@Example.COM:8443/private/path?token=secret#account",
        matchType: "default",
      }],
    };

    const { host } = await renderIcon(item);
    const faviconUrl = host.querySelector("img")?.getAttribute("src");

    expect(faviconUrl).toBe("https://icons.bitwarden.net/example.com/icon.png");
    expect(faviconUrl).not.toContain("vault-user");
    expect(faviconUrl).not.toContain("private-password");
    expect(faviconUrl).not.toContain("8443");
    expect(faviconUrl).not.toContain("private/path");
    expect(faviconUrl).not.toContain("token");
    expect(faviconUrl).not.toContain("account");
  });

  it.each([
    ["a terminal DNS root dot", "https://GitHub.COM.", "github.com"],
    ["an internationalized domain", "https://例え.テスト", "xn--r8jz45g.xn--zckzah"],
    ["a canonicalized IPv4 address", "https://127.1", "127.0.0.1"],
    ["a canonicalized IPv6 address", "https://[2001:0db8:0:0:0:0:0:1]", "[2001:db8::1]"],
  ])("builds a favicon for %s", async (_label, uri, canonicalHostname) => {
    const item: VaultItem = {
      ...demoVaultItems[0],
      uris: [{ id: "canonical-uri", uri, matchType: "default" }],
    };

    const { host } = await renderIcon(item);

    expect(host.querySelector("img")?.getAttribute("src")).toBe(
      `https://icons.bitwarden.net/${canonicalHostname}/icon.png`,
    );
  });

  it("uses the active session icons URL before the selected server environment", async () => {
    const store = new PopupStateStore();
    store.setServerUrl("https://vault.bitwarden.eu");
    store.setActiveSession(fakeSession("https://vault.internal.example/icons"));

    const { host } = await renderIcon(demoVaultItems[0], store);

    expect(host.querySelector("img")?.getAttribute("src")).toBe(
      "https://vault.internal.example/icons/github.com/icon.png",
    );
  });

  it("falls back to the selected server environment when the active session has no icons URL", async () => {
    const store = new PopupStateStore();
    store.setServerUrl("https://vault.bitwarden.eu");
    store.setActiveSession(fakeSession(null));

    const { host } = await renderIcon(demoVaultItems[0], store);

    expect(host.querySelector("img")?.getAttribute("src")).toBe(
      "https://icons.bitwarden.eu/github.com/icon.png",
    );
  });

  it("derives a self-hosted icons URL from the selected server environment", async () => {
    const store = new PopupStateStore();
    store.setServerUrl("https://vault.example.test");

    const { host } = await renderIcon(demoVaultItems[0], store);

    expect(host.querySelector("img")?.getAttribute("src")).toBe(
      "https://vault.example.test/icons/github.com/icon.png",
    );
  });

  it.each([
    ["a non-HTTP URI", ["ftp://github.com"]],
    ["an onion host", ["https://service.onion"]],
    ["an onion host with a terminal DNS root dot", ["https://service.onion."]],
    ["an I2P host", ["https://service.i2p"]],
    ["an I2P host with a terminal DNS root dot", ["https://service.i2p."]],
    ["a malformed URI", ["not a url"]],
    ["a missing URI value", [""]],
    ["a non-website host", ["https://localhost"]],
    ["a hostname with an empty DNS label", ["https://example..com"]],
    ["a hostname with a leading label hyphen", ["https://-bad.com"]],
    ["a hostname with a trailing label hyphen", ["https://bad-.com"]],
    ["a hostname with invalid DNS label characters", ["https://bad_name.com"]],
    ["a hostname with an overlong DNS label", [`https://${OVERLONG_DNS_LABEL}.com`]],
    ["an overlong DNS hostname", [`https://${OVERLONG_DNS_HOSTNAME}`]],
    ["an invalid first URI followed by a valid URI", ["not a url", "https://github.com"]],
  ])("does not build a favicon for %s", async (_label, uris) => {
    const item: VaultItem = {
      ...demoVaultItems[0],
      uris: uris.map((uri, index) => ({ id: String(index), uri, matchType: "default" })),
    };

    const { host } = await renderIcon(item);

    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector(".bwi-globe")).not.toBeNull();
  });

  it("does not build a favicon when the login has no URI entries", async () => {
    const { host } = await renderIcon({ ...demoVaultItems[0], uris: [] });

    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector(".bwi-globe")).not.toBeNull();
  });

  it("keeps the official fallback in a stable slot until load and restores it after error", async () => {
    const { fixture, host } = await renderIcon(demoVaultItems[0]);
    const slot = host.querySelector<HTMLElement>(".vault-item-icon-slot");
    const image = host.querySelector<HTMLImageElement>("img");

    expect(slot?.style.width).toBe("28px");
    expect(slot?.style.height).toBe("28px");
    expect(image?.style.width).toBe("24px");
    expect(image?.style.height).toBe("24px");
    expect(image?.classList).toContain("is-pending");
    expect(host.querySelector(".bwi-globe")).not.toBeNull();

    image!.dispatchEvent(new Event("load"));
    fixture.detectChanges();

    expect(host.querySelector("img")?.classList).not.toContain("is-pending");
    expect(host.querySelector(".bwi-globe")).toBeNull();
    expect(slot?.style.width).toBe("28px");
    expect(slot?.style.height).toBe("28px");

    image!.dispatchEvent(new Event("error"));
    fixture.detectChanges();

    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector(".bwi-globe")).not.toBeNull();
    expect(slot?.style.width).toBe("28px");
    expect(slot?.style.height).toBe("28px");
  });

  it("keeps the fallback glyph when favicons are disabled", async () => {
    const settings = new SettingsService();
    settings.setShowFavicons(false);

    const { host } = await renderIcon(demoVaultItems[0], new PopupStateStore(), settings);

    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector(".bwi-globe")).not.toBeNull();
  });

  it.each([
    ["login", "bwi-globe"],
    ["card", "bwi-credit-card"],
    ["identity", "bwi-id-card"],
    ["secure-note", "bwi-sticky-note"],
  ] as const)("renders the retained %s fallback icon", async (type, iconClass) => {
    const item = demoVaultItems.find((candidate) => candidate.type === type)!;
    const settings = new SettingsService();
    settings.setShowFavicons(false);

    const { host } = await renderIcon(item, new PopupStateStore(), settings);

    expect(host.querySelector(`.${iconClass}`)).not.toBeNull();
  });
});

async function renderIcon(
  item: VaultItem,
  store = new PopupStateStore(),
  settings = new SettingsService(),
) {
  await TestBed.configureTestingModule({
    imports: [VaultItemIconComponent],
    providers: [
      { provide: PopupStateStore, useValue: store },
      { provide: SettingsService, useValue: settings },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(VaultItemIconComponent);
  fixture.componentRef.setInput("item", item);
  fixture.detectChanges();

  return { fixture, host: fixture.nativeElement as HTMLElement };
}

function fakeSession(iconsUrl: string | null): AuthSession {
  return {
    environment: {
      ...buildSelfHostedEnvironmentFromServerUrl("https://session.example.test"),
      iconsUrl,
    },
    token: {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      tokenType: "Bearer",
      expiresIn: 3600,
    },
  };
}
