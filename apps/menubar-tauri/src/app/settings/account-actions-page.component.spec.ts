import "zone.js";
import "@angular/compiler";

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { Location } from "@angular/common";
import { TestBed } from "@angular/core/testing";
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { provideRouter } from "@angular/router";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AvatarService } from "@bitwarden/common/auth/abstractions/avatar.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { DialogService } from "@bitwarden/components";
import { BehaviorSubject } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import type { StoredAccount } from "../../auth/account-session-store";
import { OfficialI18nService } from "../official-ui/official-i18n.service";

const overlayRoot = join(
  process.cwd(),
  "apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching",
);
const componentPath = join(overlayRoot, "official-account-switcher.component.ts");
const componentTemplatePath = join(overlayRoot, "official-account-switcher.component.html");
const accountTemplatePath = join(overlayRoot, "official-account.component.html");
const currentAccountImport =
  "@bitwarden/official-auth-popup/account-switching/current-account.component";

const activeAccount: StoredAccount = {
  id: "active-account",
  email: "active@example.com",
  serverUrl: "https://vault.active.example.com",
  status: "unlocked",
  isActive: true,
};

const unlockedAccount: StoredAccount = {
  id: "unlocked-account",
  email: "unlocked@example.com",
  serverUrl: "https://vault.unlocked.example.com",
  status: "unlocked",
  isActive: false,
};

const lockedAccount: StoredAccount = {
  id: "locked-account",
  email: "locked@example.com",
  serverUrl: "https://vault.locked.example.com",
  status: "locked",
  isActive: false,
};

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const result = Array.from(host.querySelectorAll("button")).find((candidate) =>
    candidate.textContent?.replace(/\s+/g, " ").includes(label),
  ) as HTMLButtonElement | undefined;
  if (!result) {
    throw new Error(`Missing button: ${label}`);
  }
  return result;
}

async function setup(
  accounts: readonly StoredAccount[] = [activeAccount, unlockedAccount, lockedAccount],
  confirmed = true,
  error: string | null = null,
  adapterOverrides: Record<string, unknown> = {},
) {
  expect(existsSync(componentPath), "official account switcher runtime").toBe(true);
  const [{ OfficialAccountSwitcherComponent }, { OfficialAccountSwitcherAdapter }] =
    await Promise.all([
      import("../upstream-overlays/auth/account-switching/official-account-switcher.component"),
      import("../auth/official-account-switcher.adapter"),
    ]);
  const accountsSubject = new BehaviorSubject(accounts);
  const activeAccountSubject = new BehaviorSubject(
    accounts.find((account) => account.isActive) ?? null,
  );
  const loadingSubject = new BehaviorSubject(false);
  const adapter = {
    accounts$: accountsSubject.asObservable(),
    activeAccount$: activeAccountSubject.asObservable(),
    activeAuthorization$: new BehaviorSubject<"unlocked">("unlocked").asObservable(),
    loading$: loadingSubject.asObservable(),
    error$: new BehaviorSubject<string | null>(error).asObservable(),
    refresh: vi.fn(async () => undefined),
    select: vi.fn(async () => undefined),
    add: vi.fn(async () => undefined),
    lock: vi.fn(async () => undefined),
    lockAll: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined),
    ...adapterOverrides,
  };
  const dialogService = { openSimpleDialog: vi.fn(async () => confirmed) };
  const accountService = {
    activeAccount$: new BehaviorSubject({
      id: activeAccount.id,
      email: activeAccount.email,
      name: activeAccount.email,
      emailVerified: true,
      creationDate: undefined,
    }).asObservable(),
  };
  const avatarService = {
    avatarColor$: new BehaviorSubject("#175DDC").asObservable(),
  };
  const authService = {
    activeAccountStatus$: new BehaviorSubject(AuthenticationStatus.Unlocked).asObservable(),
  };

  await TestBed.configureTestingModule({
    imports: [OfficialAccountSwitcherComponent],
    providers: [
      provideRouter([]),
      OfficialI18nService,
      { provide: I18nService, useExisting: OfficialI18nService },
      { provide: OfficialAccountSwitcherAdapter, useValue: adapter },
      { provide: DialogService, useValue: dialogService },
      { provide: AccountService, useValue: accountService },
      { provide: AvatarService, useValue: avatarService },
      { provide: AuthService, useValue: authService },
      { provide: PlatformUtilsService, useValue: { isFirefox: () => false } },
      { provide: Location, useValue: { back: vi.fn() } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(OfficialAccountSwitcherComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { adapter, dialogService, fixture, loadingSubject };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("official account hierarchy", () => {
  it("retires the local account page and runs direct CurrentAccountComponent plus guarded overlays", () => {
    const retiredPath = join(
      process.cwd(),
      "apps/menubar-tauri/src/app/settings/account-actions-page.component.ts",
    );
    const headerPath = join(
      process.cwd(),
      "apps/menubar-tauri/src/app/popup-header-actions.component.ts",
    );
    const routesPath = join(process.cwd(), "apps/menubar-tauri/src/app/app.routes.ts");

    expect(existsSync(retiredPath), "local account visual page must be retired").toBe(false);
    expect(existsSync(componentPath), "official account switcher overlay").toBe(true);
    expect(existsSync(componentTemplatePath), "official account switcher template").toBe(true);
    expect(existsSync(accountTemplatePath), "official account row template").toBe(true);
    const header = readFileSync(headerPath, "utf8");
    const routes = readFileSync(routesPath, "utf8");
    expect(header).toContain(`from "${currentAccountImport}"`);
    expect(header).toContain("CurrentAccountComponent");
    expect(header).not.toContain("accountClicked");
    expect(header).not.toContain("bit-avatar");
    expect(routes).toContain("OfficialAccountSwitcherComponent");
    expect(routes).not.toContain("AccountActionsPageComponent");
  });

  it("renders current, unlocked, and locked accounts with active marker and server identity", async () => {
    const { fixture } = await setup();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector("app-current-account bit-avatar")).not.toBeNull();
    expect(host.textContent).toContain("账户操作");
    expect(host.textContent).toContain("可用账户");
    expect(host.textContent).toContain("已激活");
    expect(host.textContent).toContain("已解锁");
    expect(host.textContent).toContain("已锁定");
    expect(host.textContent).toContain("vault.active.example.com");
    expect(host.textContent).toContain("vault.unlocked.example.com");
    expect(host.querySelector(".bwi-check-circle")).toBeNull();
    expect(host.querySelector(".bwi-unlock")).not.toBeNull();
    expect(host.querySelector(".bwi-lock")).not.toBeNull();
  });

  it("uses account.isActive for the localized active-row accessible name and styling", async () => {
    const { fixture } = await setup();
    const activeRow = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll("auth-account"),
    ).find((row) => row.textContent?.includes(activeAccount.email));
    const activeButton = activeRow?.querySelector<HTMLButtonElement>("button") ?? null;
    expect(activeButton).not.toBeNull();
    const accessibleText = activeButton?.textContent?.replace(/\s+/g, " ") ?? "";
    const activeStatus = Array.from(activeButton?.querySelectorAll("span") ?? [])
      .find((element) => element.textContent?.includes("已激活"));

    expect(accessibleText).toContain("当前账户");
    expect(accessibleText).not.toContain("切换到账户");
    expect(activeStatus?.classList.contains("tw-font-medium")).toBe(true);
    expect(activeStatus?.classList.contains("tw-text-success")).toBe(true);
    expect(activeStatus?.parentElement?.hasAttribute("aria-hidden")).toBe(false);
  });

  it("adds and switches accounts through the bounded adapter", async () => {
    const { adapter, fixture } = await setup();
    const host = fixture.nativeElement as HTMLElement;

    button(host, "添加账户").click();
    button(host, unlockedAccount.email).click();
    await fixture.whenStable();

    expect(adapter.add).toHaveBeenCalledTimes(1);
    expect(adapter.select).toHaveBeenCalledWith(unlockedAccount.id);
  });

  it("does not let an older row completion clear a newer adapter loading state", async () => {
    const oldSelection = deferred<void>();
    const { fixture, loadingSubject } = await setup(
      undefined,
      true,
      null,
      { select: vi.fn(() => oldSelection.promise) },
    );
    const component = fixture.componentInstance;

    button(fixture.nativeElement as HTMLElement, unlockedAccount.email).click();
    loadingSubject.next(true);
    oldSelection.resolve();
    await fixture.whenStable();

    expect(component.loading).toBe(true);
    loadingSubject.next(false);
    expect(component.loading).toBe(false);
  });

  it("shows the official five-account limit and removes the add action", async () => {
    const accounts = Array.from({ length: 5 }, (_, index) => ({
      ...activeAccount,
      id: `account-${index}`,
      email: `account-${index}@example.com`,
      isActive: index === 0,
    }));
    const { fixture } = await setup(accounts);
    const host = fixture.nativeElement as HTMLElement;

    expect(host.textContent).toContain("已达到账户数量上限");
    expect(host.textContent).not.toContain("添加账户");
  });

  it("locks one account and all accounts through the bounded adapter", async () => {
    const { adapter, fixture } = await setup();
    const host = fixture.nativeElement as HTMLElement;

    button(host, "立即锁定").click();
    button(host, "锁定全部").click();
    await fixture.whenStable();

    expect(adapter.lock).toHaveBeenCalledWith(activeAccount.id);
    expect(adapter.lockAll).toHaveBeenCalledTimes(1);
  });

  it("requires official logout confirmation and honors cancellation", async () => {
    const { adapter, dialogService, fixture } = await setup(undefined, false);
    const host = fixture.nativeElement as HTMLElement;

    button(host, "注销").click();
    await fixture.whenStable();

    expect(dialogService.openSimpleDialog).toHaveBeenCalledWith({
      title: { key: "logOut" },
      content: { key: "logOutConfirmation" },
      type: "info",
    });
    expect(adapter.logout).not.toHaveBeenCalled();
  });

  it("logs out only after confirmation", async () => {
    const { adapter, fixture } = await setup();

    button(fixture.nativeElement as HTMLElement, "注销").click();
    await fixture.whenStable();

    expect(adapter.logout).toHaveBeenCalledWith(activeAccount.id);
  });

  it("renders fixed operation feedback without private failure content", async () => {
    const { fixture } = await setup(
      undefined,
      true,
      "无法完成账户操作。请重试。",
    );

    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("无法完成账户操作。请重试。");
    expect(text).not.toContain("private.example.com");
  });
});
