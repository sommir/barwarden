import "zone.js";
import "@angular/compiler";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NEVER } from "rxjs";

import { ACCOUNT_SESSION_PORT } from "../../auth/account-session-port";
import { AUTH_TOKEN_REFRESH_PORT } from "../../auth/auth-token-refresh.service";
import { PopupStateStore } from "../popup-state";
import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { VAULT_SYNC_PORT } from "../auth/vault-sync.shared";
import { VaultSessionService } from "../vault/vault-session.service";
import { VaultSettingsPageComponent } from "./vault-settings-page.component";
import { PopupRouterCacheService } from "../platform/popup-router-cache.service";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("VaultSettingsPageComponent", () => {
  afterEach(() => {
    document.documentElement.style.removeProperty("font-size");
    document.head.querySelectorAll('style[data-test-owner="vault-settings-preferences"]')
      .forEach((node) => node.remove());
  });

  it("returns directly to the top-level Settings page instead of replaying recovery history", async () => {
    const navigateByUrl = vi.fn(async () => true);
    const back = vi.fn(async () => true);

    await TestBed.configureTestingModule({
      imports: [VaultSettingsPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        { provide: PopupStateStore, useValue: new PopupStateStore() },
        { provide: VaultSessionService, useValue: { syncNow: async () => undefined } },
        { provide: Router, useValue: { events: NEVER, navigateByUrl, url: "/vault-settings" } },
        { provide: PopupRouterCacheService, useValue: { back } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(VaultSettingsPageComponent);

    await fixture.componentInstance.back();

    expect(back).toHaveBeenCalledOnce();
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it("renders vault setting rows", async () => {
    const store = new PopupStateStore();
    store.setItems([], [], new Date("2026-07-09T10:00:00Z"));

    await TestBed.configureTestingModule({
      imports: [VaultSettingsPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        { provide: PopupStateStore, useValue: store },
        { provide: VaultSessionService, useValue: { syncNow: async () => undefined } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(VaultSettingsPageComponent);
    fixture.detectChanges(false);

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain("文件夹");
    expect(host.textContent).not.toContain("导入");
    expect(host.querySelector('a[href="/import"]')).toBeNull();
    expect(host.textContent).not.toContain("导出");
    expect(host.querySelector('a[href="/export"]')).toBeNull();
    expect(host.textContent).toContain("归档");
    expect(host.textContent).toContain("回收站");
    expect(host.textContent).toContain("立即同步");
  });

  it("renders the real Vault subtree as one divider-backed preference group", async () => {
    await TestBed.configureTestingModule({
      imports: [VaultSettingsPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        { provide: PopupStateStore, useValue: new PopupStateStore() },
        { provide: VaultSessionService, useValue: { syncNow: async () => undefined } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(VaultSettingsPageComponent);
    fixture.detectChanges(false);
    installPreferenceCss("vault-settings-preferences");

    const host = fixture.nativeElement as HTMLElement;
    expect(host.matches(".macos-page--settings-detail")).toBe(true);
    const group = host.querySelector<HTMLElement>(
      '[data-settings-detail="vault-settings"].macos-preference-group',
    );
    expect(group).not.toBeNull();
    const rows = Array.from(
      group!.querySelectorAll<HTMLButtonElement>("button.macos-preference-row"),
    );
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.dataset["popupFocusKey"] ?? null)).toEqual([
      "settings:folders",
      "settings:archive",
      "settings:trash",
      null,
    ]);
    for (const row of rows) {
      const style = getComputedStyle(row);
      expect(Number.parseFloat(style.minHeight)).toBeGreaterThanOrEqual(44);
      expect(style.boxShadow).toBe("none");
      expect(row.querySelector(".tw-text-wrap.tw-break-words")).not.toBeNull();
    }
    const itemOwners = Array.from(group!.querySelectorAll<HTMLElement>(":scope > bit-item"));
    expect(itemOwners).toHaveLength(4);
    expect(itemOwners.slice(0, -1).map((item) => getComputedStyle(item).borderBottomWidth))
      .toEqual(["1px", "1px", "1px"]);
    expect(getComputedStyle(itemOwners.at(-1)!).borderBottomWidth).toBe("0px");
    document.documentElement.style.fontSize = "200%";
    const wrappedContent = rows[0]!.querySelector<HTMLElement>(".tw-text-wrap.tw-break-words")!;
    wrappedContent.append(` ${wrappedContent.textContent} ${wrappedContent.textContent}`);
    expect(getComputedStyle(rows[0]!).height).toBe("auto");
    expect(getComputedStyle(rows[0]!).overflow).toBe("visible");
    expect(getComputedStyle(wrappedContent).whiteSpace).not.toBe("nowrap");

    rows[0]!.dataset["testFocusVisible"] = "true";
    expect(getComputedStyle(rows[0]!).outlineWidth).toBe("2px");
    expect(getComputedStyle(rows[0]!).outlineStyle).toBe("solid");
    expect(host.querySelectorAll('[aria-busy="true"] [role="progressbar"]')).toHaveLength(0);
  });

  it("shows syncing state while sync is running", async () => {
    let resolveSync = () => undefined;
    const syncNow = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSync = resolve;
        }),
    );

    await TestBed.configureTestingModule({
      imports: [VaultSettingsPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        { provide: PopupStateStore, useValue: new PopupStateStore() },
        { provide: VaultSessionService, useValue: { syncNow } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(VaultSettingsPageComponent);
    fixture.detectChanges(false);

    const syncButton = Array.from(fixture.nativeElement.querySelectorAll("button")).find((button) =>
      (button as HTMLButtonElement).textContent?.includes("立即同步"),
    ) as HTMLButtonElement | undefined;

    syncButton?.click();
    syncButton?.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain("同步中");
    expect(syncNow).toHaveBeenCalledTimes(1);

    resolveSync();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(syncButton?.disabled).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain("同步中");
  });

  it("announces sync pending without allowing a duplicate", async () => {
    let resolveSync!: () => void;
    const syncNow = vi.fn(() => new Promise<void>((resolve) => { resolveSync = resolve; }));
    await TestBed.configureTestingModule({
      imports: [VaultSettingsPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        { provide: PopupStateStore, useValue: new PopupStateStore() },
        { provide: VaultSessionService, useValue: { syncNow } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(VaultSettingsPageComponent);
    fixture.detectChanges(false);
    const button = fixture.nativeElement.querySelector<HTMLButtonElement>(
      "[data-testid='vault-sync-row']",
    );
    expect(button).not.toBeNull();
    button!.click();
    button!.click();
    fixture.detectChanges();
    expect(button!.getAttribute("aria-busy")).toBe("true");
    expect(button!.disabled).toBe(true);
    expect(syncNow).toHaveBeenCalledOnce();
    const navigationRows = Array.from(
      fixture.nativeElement.querySelectorAll<HTMLButtonElement>("button"),
    );
    expect(navigationRows.find((row) => row.textContent?.includes("文件夹"))?.dataset["popupFocusKey"])
      .toBe("settings:folders");
    expect(navigationRows.find((row) => row.textContent?.includes("归档"))?.dataset["popupFocusKey"])
      .toBe("settings:archive");
    expect(navigationRows.find((row) => row.textContent?.includes("回收站"))?.dataset["popupFocusKey"])
      .toBe("settings:trash");
    expect(fixture.nativeElement.querySelector('[data-settings-detail="vault-settings"]'))
      .not.toBeNull();
    resolveSync();
    await fixture.whenStable();
  });

  it("clears a previous sanitized sync failure before retrying", async () => {
    const syncNow = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("private response"))
      .mockResolvedValueOnce(undefined);
    await TestBed.configureTestingModule({
      imports: [VaultSettingsPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        { provide: PopupStateStore, useValue: new PopupStateStore() },
        { provide: VaultSessionService, useValue: { syncNow } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(VaultSettingsPageComponent);
    fixture.detectChanges(false);

    await fixture.componentInstance.syncNow();
    expect(fixture.componentInstance.syncError).toBe("无法同步密码库。请重试。");

    await fixture.componentInstance.syncNow();
    fixture.changeDetectorRef.detectChanges();

    expect(fixture.componentInstance.syncError).toBe("");
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it("shows a sanitized manual sync failure", async () => {
    await TestBed.configureTestingModule({
      imports: [VaultSettingsPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        { provide: PopupStateStore, useValue: new PopupStateStore() },
        {
          provide: VaultSessionService,
          useValue: { syncNow: async () => { throw new Error("private server response"); } },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(VaultSettingsPageComponent);
    fixture.detectChanges(false);

    await fixture.componentInstance.syncNow();
    fixture.changeDetectorRef.detectChanges();

    expect(fixture.componentInstance.syncError).toBe("无法同步密码库。请重试。");
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain("无法同步密码库");
    expect(fixture.nativeElement.textContent).not.toContain("private server response");
  });

  it("injects the real root VaultSessionService for manual sync settings", async () => {
    const store = new PopupStateStore();
    store.setActiveSession({
      environment: {
        apiUrl: "https://api.bitwarden.com",
        identityUrl: "https://identity.bitwarden.com",
        iconsUrl: "https://icons.bitwarden.net",
        webVaultUrl: "https://vault.bitwarden.com",
        sendUrl: "https://send.bitwarden.com",
      },
      token: {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        tokenType: "Bearer",
        expiresIn: 3600,
      },
    });
    store.setUnlocked("user@example.com");

    await TestBed.configureTestingModule({
      imports: [VaultSettingsPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        { provide: PopupStateStore, useValue: store },
        { provide: VAULT_SYNC_PORT, useValue: { sync: vi.fn(async () => emptySyncResult()) } },
        { provide: ACCOUNT_SESSION_PORT, useValue: null },
        { provide: AUTH_TOKEN_REFRESH_PORT, useValue: null },
      ],
    }).compileComponents();

    const service = TestBed.inject(VaultSessionService);
    await TestBed.inject(OfficialI18nService).setLocale("en-US");
    const fixture = TestBed.createComponent(VaultSettingsPageComponent);

    await expect(service.syncNow()).resolves.toBeUndefined();
    await expect(fixture.componentInstance.syncNow()).resolves.toBeUndefined();
    expect(store.snapshot().statusMessage).toBe("Synced 0 items and 0 sends");
  });
});

function installPreferenceCss(owner: string): void {
  const style = document.createElement("style");
  style.dataset["testOwner"] = owner;
  style.textContent = ["macos-tokens.css", "macos-motion.css", "global.css"]
    .map((file) => readFileSync(resolve(
      process.cwd(),
      "apps/menubar-tauri/src/styles",
      file,
    ), "utf8"))
    .join("\n")
    .replace(/^@import[^;]+;\s*/gm, "");
  document.head.append(style);
  const rootStyle = getComputedStyle(document.documentElement);
  style.textContent = style.textContent.replace(/var\((--[\w-]+)\)/g, (reference, name) =>
    resolveCustomProperty(rootStyle.getPropertyValue(name).trim(), rootStyle, new Set([name]))
      || reference,
  ).replace(/:focus-visible/g, '[data-test-focus-visible="true"]');
}

function resolveCustomProperty(
  value: string,
  rootStyle: CSSStyleDeclaration,
  seen: Set<string>,
): string {
  return value.replace(/var\((--[\w-]+)\)/g, (reference, name) => {
    if (seen.has(name)) return reference;
    const next = rootStyle.getPropertyValue(name).trim();
    return next
      ? resolveCustomProperty(next, rootStyle, new Set([...seen, name]))
      : reference;
  });
}

function emptySyncResult() {
  return {
    cipherCount: 0,
    encryptedCipherCount: 0,
    folderCount: 0,
    sendCount: 0,
    items: [],
    archivedItems: [],
    deletedItems: [],
    folders: [],
    organizations: [],
    collections: [],
    sends: [],
  };
}
