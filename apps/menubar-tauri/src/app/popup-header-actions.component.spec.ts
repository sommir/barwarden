import "zone.js";
import "@angular/compiler";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { Location } from "@angular/common";
import { OverlayContainer } from "@angular/cdk/overlay";
import { TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { ActivatedRoute, provideRouter, Router } from "@angular/router";
import { describe, expect, it, vi } from "vitest";
import { BehaviorSubject, firstValueFrom } from "rxjs";

import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AvatarService } from "@bitwarden/common/auth/abstractions/avatar.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import type { AccountSessionPort } from "../auth/account-session-port";
import type { AuthSession } from "../auth/auth-session-store";
import { buildBitwardenEnvironment } from "../bitwarden-api/bitwarden-api";

import { AuthFacade } from "./auth/auth.facade";
import { OfficialAccountSwitcherAdapter } from "./auth/official-account-switcher.adapter";
import { PopupStateStore } from "./popup-state";
import { AvatarComponent } from "./official-ui/official-components";
import { OfficialI18nService } from "./official-ui/official-i18n.service";
import { PopupHeaderActionsComponent } from "./popup-header-actions.component";
import { RetainedFolderDialogService } from "./vault/retained-new-item-dropdown.component";

const officialPopOutProviders = [
  OfficialI18nService,
  { provide: I18nService, useExisting: OfficialI18nService },
  { provide: PlatformUtilsService, useValue: { isFirefox: () => false } },
  {
    provide: AccountService,
    useValue: {
      activeAccount$: new BehaviorSubject({
        id: "account-id",
        email: "user@example.com",
        name: "user@example.com",
        emailVerified: true,
        creationDate: undefined,
      }).asObservable(),
    },
  },
  {
    provide: AvatarService,
    useValue: { avatarColor$: new BehaviorSubject("#175DDC").asObservable() },
  },
  {
    provide: AuthService,
    useValue: {
      activeAccountStatus$: new BehaviorSubject(AuthenticationStatus.Unlocked).asObservable(),
    },
  },
];

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("PopupHeaderActionsComponent", () => {
  it("renders the official New menu with retained personal item types and folder context", async () => {
    const store = new PopupStateStore();
    store.setUnlocked("user@example.com");
    store.setFilterFolderId("work");

    await TestBed.configureTestingModule({
      imports: [PopupHeaderActionsComponent],
      providers: [provideRouter([]), { provide: PopupStateStore, useValue: store }, ...officialPopOutProviders],
    }).compileComponents();

    const fixture = TestBed.createComponent(PopupHeaderActionsComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector("app-new-item-dropdown")).not.toBeNull();
    expect(host.querySelector("app-new-item-dropdown bit-menu")).not.toBeNull();
    expect([...host.querySelector(".header-actions")!.children].map((child) => child.tagName))
      .toEqual(["BW-RETAINED-NEW-ITEM-DROPDOWN", "APP-POP-OUT", "APP-CURRENT-ACCOUNT"]);

    const newAction = host.querySelector<HTMLButtonElement>(
      "app-new-item-dropdown button[bitbutton]",
    )!;
    expect(newAction.textContent).toContain("新增");
    expect(newAction.tagName).toBe("BUTTON");
    expect(newAction.querySelector(".bwi-plus")).not.toBeNull();

    newAction.click();
    fixture.detectChanges();

    const menu = document.querySelector<HTMLElement>('.bit-menu-panel [role="menu"]')!;
    const menuItems = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(menuItems.map((item) => item.textContent?.trim())).toEqual([
      "登录",
      "支付卡",
      "身份",
      "笔记",
      "文件夹",
    ]);
    expect(menuItems.slice(0, 4).map((item) => item.querySelector("i")?.className)).toEqual([
      "bwi bwi-globe",
      "bwi bwi-credit-card",
      "bwi bwi-id-card",
      "bwi bwi-sticky-note",
    ]);
    expect(menu.textContent).not.toContain("SSH");

    const cipherLinks = menuItems.slice(0, 4) as HTMLAnchorElement[];
    expect(cipherLinks.map((link) => {
      const query = new URL(link.href).searchParams;
      return {
        keys: [...query.keys()].sort(),
        type: query.get("type"),
        folderId: query.get("folderId"),
        organizationId: query.get("organizationId"),
        collectionId: query.get("collectionId"),
        prefill: query.get("prefillNameAndURIFromTab"),
      };
    })).toEqual([
      { keys: ["folderId", "type"], type: "1", folderId: "work", organizationId: null, collectionId: null, prefill: null },
      { keys: ["folderId", "type"], type: "3", folderId: "work", organizationId: null, collectionId: null, prefill: null },
      { keys: ["folderId", "type"], type: "4", folderId: "work", organizationId: null, collectionId: null, prefill: null },
      { keys: ["folderId", "type"], type: "2", folderId: "work", organizationId: null, collectionId: null, prefill: null },
    ]);
  });

  it("opens the retained folder dialog from the official New menu", async () => {
    const store = new PopupStateStore();
    store.setUnlocked("user@example.com");

    await TestBed.configureTestingModule({
      imports: [PopupHeaderActionsComponent],
      providers: [provideRouter([]), { provide: PopupStateStore, useValue: store }, ...officialPopOutProviders],
    }).compileComponents();

    const fixture = TestBed.createComponent(PopupHeaderActionsComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const overlay = TestBed.inject(OverlayContainer).getContainerElement();
    expect(host.querySelector("bw-vault-folder-dialog dialog[open]")).toBeNull();

    const trigger = host.querySelector<HTMLButtonElement>(
      "app-new-item-dropdown button[bitbutton]",
    )!;
    trigger.click();
    fixture.detectChanges();
    const folderAction = [...overlay.querySelectorAll<HTMLButtonElement>('.bit-menu-panel [role="menuitem"]')]
      .find((item) => item.textContent?.includes("文件夹"));
    expect(folderAction).toBeDefined();
    folderAction!.click();
    fixture.detectChanges();

    expect(host.querySelector("bw-vault-folder-dialog dialog[open]")).not.toBeNull();
  });

  it("fails explicitly when the retained folder dialog host has not bound its dialog", () => {
    expect(() => new RetainedFolderDialogService().openFolderDialog()).toThrow(
      "The retained folder dialog is not bound.",
    );
  });

  it("can hide the Vault-only New action for Settings headers", async () => {
    const store = new PopupStateStore();
    store.setUnlocked("user@example.com");

    await TestBed.configureTestingModule({
      imports: [PopupHeaderActionsComponent],
      providers: [provideRouter([]), { provide: PopupStateStore, useValue: store }, ...officialPopOutProviders],
    }).compileComponents();

    const fixture = TestBed.createComponent(PopupHeaderActionsComponent);
    fixture.componentInstance.showNew = false;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector("app-new-item-dropdown")).toBeNull();
    expect(host.textContent).not.toContain("新增");
    expect(fixture.debugElement.query(By.directive(AvatarComponent))).not.toBeNull();
    expect(host.querySelector("app-current-account button")?.textContent).toContain("user@example.com");
  });

  it("renders the pinned official PopOutComponent selector and translated label", async () => {
    const store = new PopupStateStore();
    store.setUnlocked("user@example.com");
    await TestBed.configureTestingModule({
      imports: [PopupHeaderActionsComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        ...officialPopOutProviders,
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(PopupHeaderActionsComponent);
    Object.defineProperty(TestBed.inject(Router), "url", { value: "/tabs/settings" });
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const popOut = host.querySelector("app-pop-out button") as HTMLButtonElement | null;
    expect(popOut).not.toBeNull();
    expect(popOut.getAttribute("biticonbutton")).toBe("bwi-popout");
    expect(popOut.getAttribute("aria-label")).toBe("在新窗口中打开");
    expect(popOut.tabIndex).toBe(0);
    expect(popOut.disabled).toBe(false);
  });

  it("removes a pending header tooltip when the popup window loses focus", async () => {
    const store = new PopupStateStore();
    store.setUnlocked("user@example.com");
    await TestBed.configureTestingModule({
      imports: [PopupHeaderActionsComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        ...officialPopOutProviders,
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(PopupHeaderActionsComponent);
    fixture.detectChanges();

    const popOut = fixture.nativeElement.querySelector(
      "app-pop-out button",
    ) as HTMLButtonElement;
    const overlay = TestBed.inject(OverlayContainer).getContainerElement();
    popOut.dispatchEvent(new Event("mouseenter"));
    fixture.detectChanges();

    expect(overlay.querySelector('[role="tooltip"]')?.textContent?.trim())
      .toBe("在新窗口中打开");

    window.dispatchEvent(new Event("blur"));
    fixture.detectChanges();

    expect(overlay.querySelector('[role="tooltip"]')).toBeNull();
  });

  it("uses the official current account button behavior", async () => {
    const store = new PopupStateStore();
    store.setUnlocked("user@example.com");
    const location = { back: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [PopupHeaderActionsComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        { provide: Location, useValue: location },
        ...officialPopOutProviders,
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(PopupHeaderActionsComponent);
    const router = TestBed.inject(Router);
    const navigations: unknown[] = [];
    router.navigate = async (commands) => {
      navigations.push(commands);
      return true;
    };
    Object.defineProperty(router, "url", { value: "/tabs/vault", configurable: true });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(fixture.debugElement.query(By.directive(AvatarComponent))).not.toBeNull();
    expect(host.querySelector("app-current-account")?.getAttribute("data-popup-focus-key"))
      .toBe("account-switcher");
    const accountButton = host.querySelector("app-current-account button") as HTMLButtonElement;
    expect(accountButton).not.toBeNull();
    expect(accountButton.querySelector("svg text")?.textContent?.trim()).toBe("US");
    expect(accountButton.textContent).toContain("user@example.com");
    expect(accountButton.tabIndex).toBe(0);
    accountButton.focus();
    expect(document.activeElement).toBe(accountButton);
    accountButton!.click();
    await fixture.whenStable();

    expect(navigations).toEqual([["/account-switcher"]]);

    Object.defineProperty(TestBed.inject(ActivatedRoute).snapshot, "data", {
      configurable: true,
      value: { state: "account-switcher" },
    });
    accountButton!.click();

    expect(location.back).toHaveBeenCalledTimes(1);
  });

  it("refreshes the direct official header after a real successful account persistence", async () => {
    const store = new PopupStateStore();
    store.setUnlocked("previous@example.com");
    let accounts = [{
      id: "previous-account",
      email: "previous@example.com",
      serverUrl: "https://vault.bitwarden.com",
      status: "unlocked" as const,
      isActive: true,
    }];
    const accountStore: AccountSessionPort = {
      list: async () => accounts,
      saveAccount: async ({ email, serverUrl }) => {
        const saved = {
          id: "saved-account",
          email,
          serverUrl,
          status: "unlocked" as const,
          isActive: true,
        };
        accounts = [saved, ...accounts.map((account) => ({ ...account, isActive: false }))];
        return saved;
      },
      setActive: async () => accounts[0],
      setStatus: async () => undefined,
      readSession: async () => null,
      replaceSession: async () => false,
      remove: async () => null,
      lockAll: async () => undefined,
    };
    const facade = new AuthFacade(
      store,
      { login: async () => loginSession() },
      { sync: async () => emptySyncResult() },
      null,
      undefined,
      accountStore,
    );
    const adapter = new OfficialAccountSwitcherAdapter(
      facade,
      { navigateByUrl: vi.fn(async () => true) } as never,
    );
    await adapter.refresh();
    await expect(firstValueFrom(adapter.activeAccount$)).resolves.toMatchObject({
      email: "previous@example.com",
    });

    await facade.login({
      email: "saved@example.com",
      masterPassword: "master-password",
      serverUrl: "https://vault.bitwarden.eu",
    });
    await vi.waitFor(async () => {
      await expect(firstValueFrom(adapter.activeAccount$)).resolves.toMatchObject({
        email: "saved@example.com",
      });
    });

    await TestBed.configureTestingModule({
      imports: [PopupHeaderActionsComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        { provide: PlatformUtilsService, useValue: { isFirefox: () => false } },
        { provide: AccountService, useValue: adapter.accountService },
        { provide: AvatarService, useValue: adapter.avatarService },
        { provide: AuthService, useValue: adapter.authService },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(PopupHeaderActionsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector("app-current-account button")?.textContent)
      .toContain("saved@example.com");
  });
});

function loginSession(): AuthSession {
  return {
    environment: buildBitwardenEnvironment(),
    token: {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      tokenType: "Bearer",
      expiresIn: 3600,
    },
  };
}

function emptySyncResult() {
  return {
    cipherCount: 0,
    encryptedCipherCount: 0,
    folderCount: 0,
    items: [],
    archivedItems: [],
    deletedItems: [],
    folders: [],
    organizations: [],
    collections: [],
    sends: [],
    sendCount: 0,
  };
}
