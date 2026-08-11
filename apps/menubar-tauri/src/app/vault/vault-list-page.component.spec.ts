import "zone.js";
import "@angular/compiler";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { OverlayContainer } from "@angular/cdk/overlay";
import { TestBed } from "@angular/core/testing";
import { provideNoopAnimations } from "@angular/platform-browser/animations";
import { By } from "@angular/platform-browser";
import { provideRouter, Router } from "@angular/router";
import { firstValueFrom, type Observable } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { NoResults, VaultOpen } from "@bitwarden/assets/svg";

import type { AuthSession } from "../../auth/auth-session-store";
import { PopupStateStore } from "../popup-state";
import { OfficialI18nService, translateOfficialMessage } from "../official-ui/official-i18n.service";
import { LocalCopyFeedbackService } from "../official-ui/local-copy-feedback.service";
import { NoItemsComponent } from "../official-ui/official-components";
import { officialCurrentAccountTestProviders } from "../official-ui/official-current-account.test-support";
import { SettingsService } from "../settings/settings.service";
import { VaultListItemsContainerComponent } from "../upstream-overlays/vault-main/vault-list-items-container.component";
import { demoFolders, demoVaultItems } from "../vault-demo";
import {
  VAULT_CIPHER_ACTION_PORT,
  VaultActionsService,
  type VaultCipherActionPort,
} from "./vault-actions.service";
import { VaultFacade } from "./vault.facade";
import { VaultListPageComponent } from "./vault-list-page.component";
import { VaultRepromptDialogComponent } from "./vault-reprompt-dialog.component";
import { VaultRepromptService } from "./vault-reprompt.service";
import { VaultSessionService } from "./vault-session.service";
import { AutoFillVaultContextService } from "../autofill/autofill-vault-context.service";
import { AutoFillFillActionService } from "../autofill/autofill-fill-action.service";
import { immutableAuthorizationMap } from "../autofill/autofill-fill-context.model";
import {
  applyVaultMainEvidenceState,
} from "./vault-main-evidence-preview";
import { VAULT_MAIN_EVIDENCE_STATE } from "./vault-main-evidence-state";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("VaultListPageComponent", () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        ...officialCurrentAccountTestProviders(),
      ],
    });
  });

  it("uses the native root header, peer hierarchy, and title-bar add control", async () => {
    const store = new PopupStateStore();
    store.setUnlocked("user@example.com");
    store.setItems(demoVaultItems, demoFolders);
    await TestBed.configureTestingModule({
      imports: [VaultListPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        VaultFacade,
        { provide: VaultActionsService, useValue: {} },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(VaultListPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector("bw-root-search")).not.toBeNull();
    expect(host.querySelector("app-vault-header")).toBeNull();
    expect(host.querySelector("app-vault-list-filters")).toBeNull();
    expect(host.querySelectorAll("[data-vault-node]")).toHaveLength(6);
    const actions = host.querySelector("popup-header > header .macos-page-heading__actions");
    expect(actions?.firstElementChild?.tagName).toBe("BW-RETAINED-NEW-ITEM-DROPDOWN");
    expect(
      actions?.querySelector("bw-retained-new-item-dropdown app-new-item-dropdown"),
    ).not.toBeNull();
    expect(actions?.lastElementChild?.tagName).toBe("BW-POPUP-HEADER-ACTIONS");
    expect(
      [...(actions?.querySelectorAll("bw-popup-header-actions .header-actions > *") ?? [])]
        .map((child) => child.tagName),
    ).toEqual(["APP-POP-OUT", "APP-CURRENT-ACCOUNT"]);
    expect(host.querySelector("popup-page > popup-header h1")?.textContent).toContain("密码库");
  });

  it("places live AutoFill suggestions above the retained vault hierarchy", async () => {
    const store = new PopupStateStore();
    store.setUnlocked("user@example.com");
    store.setItems(demoVaultItems, demoFolders, new Date("2026-08-11T00:00:00Z"), "account-a");
    const candidate = Object.freeze({
      cipherId: "github",
      displayName: "GitHub",
      username: "ops@example.com",
      group: "exact" as const,
      reason: "service_identifier",
      availableFields: Object.freeze(["username", "password"] as const),
      authorizations: immutableAuthorizationMap([
        ["username", { contextToken: "username-token", requiresMismatchConfirmation: false }],
        ["password", { contextToken: "password-token", requiresMismatchConfirmation: false }],
      ]),
    });
    const context = {
      snapshot: () => ({
        status: "ready" as const,
        epoch: 1,
        context: {
          bundleId: "com.example.Terminal",
          appName: "Terminal",
          fillContextToken: "00000000-0000-4000-8000-000000000005",
          focusedField: { kind: "password" as const, confidence: "high" as const },
          action: { mode: "form" as const, fields: ["username", "password"] as const },
        },
        session: {
          accountId: "account-a",
          generation: "00000000-0000-4000-8000-000000000004",
          vaultRevision: 7,
        },
        candidates: [candidate],
      }),
      subscribe: () => () => undefined,
      select: () => candidate,
      selected: () => null,
      invalidate: vi.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [VaultListPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        { provide: AutoFillVaultContextService, useValue: context },
        { provide: AutoFillFillActionService, useValue: { prepare: vi.fn(), execute: vi.fn(), cancel: vi.fn() } },
        { provide: VaultActionsService, useValue: {} },
        VaultFacade,
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(VaultListPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const suggestions = host.querySelector("[data-testid='vault-autofill-suggestions']");
    const hierarchy = host.querySelector("bw-vault-hierarchy");

    expect(suggestions).not.toBeNull();
    expect(suggestions?.compareDocumentPosition(hierarchy!) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(host.textContent).toContain("自动填充建议");
    expect(host.textContent).toContain("收藏夹");
    expect(host.textContent).toContain("所有项目");
  });

  it("keeps the title-bar add control available when the unlocked vault is empty", async () => {
    const store = new PopupStateStore();
    store.setUnlocked("user@example.com");
    store.setItems([], []);
    await TestBed.configureTestingModule({
      imports: [VaultListPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        VaultFacade,
        { provide: VaultActionsService, useValue: {} },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(VaultListPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector("popup-page")?.getAttribute("data-vault-state")).toBe("empty");
    expect(
      host.querySelector<HTMLButtonElement>(
        "popup-header bw-retained-new-item-dropdown app-new-item-dropdown button[bitbutton]",
      ),
    ).not.toBeNull();
  });

  it("does not archive a protected Login from the row menu before reprompt", async () => {
    const store = new PopupStateStore();
    const protectedLogin = { ...demoVaultItems[0], reprompt: true };
    store.setUnlocked("account-a@example.test");
    store.setActiveSession(fakeSession("account-a"));
    store.setItems([protectedLogin], demoFolders);
    const actions = {
      archiveItemWithOutcome: vi.fn(async () => ({
        committed: false,
        reason: "failure",
        status: "Unable to archive item.",
      })),
    };
    await TestBed.configureTestingModule({
      imports: [VaultListPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        { provide: VaultSessionService, useValue: { syncNow: vi.fn(async () => undefined) } },
        { provide: VaultActionsService, useValue: actions },
        { provide: VaultRepromptService, useValue: { verify: vi.fn(async () => true) } },
        VaultFacade,
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(VaultListPageComponent);
    fixture.detectChanges();
    const dialog = (fixture.nativeElement as HTMLElement).querySelector<HTMLDialogElement>(
      "bw-vault-reprompt-dialog dialog",
    )!;
    Object.defineProperty(dialog, "showModal", {
      configurable: true,
      value: vi.fn(() => dialog.setAttribute("open", "")),
    });

    await fixture.componentInstance.archiveItem(protectedLogin);

    expect(dialog.hasAttribute("open")).toBe(true);
    expect(actions.archiveItemWithOutcome).not.toHaveBeenCalled();
  });

  it.each([
    ["passes", true, false, true],
    ["fails", false, false, false],
    ["cancels", true, true, false],
  ] as const)("runs a protected archive only when reprompt %s", async (_outcome, verified, cancel, expectedCall) => {
    const store = new PopupStateStore();
    const protectedLogin = { ...demoVaultItems[0], reprompt: true };
    store.setUnlocked("account-a@example.test");
    store.setActiveSession(fakeSession("account-a"));
    store.setItems([protectedLogin], demoFolders);
    const actions = {
      archiveItemWithOutcome: vi.fn(async () => ({
        committed: false,
        reason: "failure",
        status: "Unable to archive item.",
      })),
    };
    await TestBed.configureTestingModule({
      imports: [VaultListPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        { provide: VaultSessionService, useValue: { syncNow: vi.fn(async () => undefined) } },
        { provide: VaultActionsService, useValue: actions },
        { provide: VaultRepromptService, useValue: { verify: vi.fn(async () => verified) } },
        VaultFacade,
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(VaultListPageComponent);
    fixture.detectChanges();
    const dialog = fixture.debugElement.query(By.directive(VaultRepromptDialogComponent))
      .componentInstance as VaultRepromptDialogComponent;

    await fixture.componentInstance.archiveItem(protectedLogin);
    if (cancel) {
      dialog.cancel();
    } else {
      dialog.masterPassword = "correct-password";
      await dialog.submit();
    }

    expect(actions.archiveItemWithOutcome).toHaveBeenCalledTimes(expectedCall ? 1 : 0);
  });

  it.each([
    ["lock", (store: PopupStateStore, _fixture: ReturnType<typeof TestBed.createComponent>) => store.setLocked()],
    ["account", (store: PopupStateStore, _fixture: ReturnType<typeof TestBed.createComponent>) => store.setActiveSession(fakeSession("account-b"))],
    ["item", (store: PopupStateStore, _fixture: ReturnType<typeof TestBed.createComponent>) => store.setItems([{ ...demoVaultItems[0], reprompt: true, name: "Synced replacement" }])],
    ["destroy", (_store: PopupStateStore, fixture: ReturnType<typeof TestBed.createComponent>) => fixture.destroy()],
  ] as const)("rejects a protected archive when %s changes before reprompt passes", async (_kind, invalidate) => {
    const store = new PopupStateStore();
    const protectedLogin = { ...demoVaultItems[0], reprompt: true };
    store.setUnlocked("account-a@example.test");
    store.setActiveSession(fakeSession("account-a"));
    store.setItems([protectedLogin], demoFolders);
    const actions = {
      archiveItemWithOutcome: vi.fn(async () => ({
        committed: false,
        reason: "failure",
        status: "Unable to archive item.",
      })),
    };
    await TestBed.configureTestingModule({
      imports: [VaultListPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        { provide: VaultSessionService, useValue: { syncNow: vi.fn(async () => undefined) } },
        { provide: VaultActionsService, useValue: actions },
        { provide: VaultRepromptService, useValue: { verify: vi.fn(async () => true) } },
        VaultFacade,
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(VaultListPageComponent);
    fixture.detectChanges();
    const dialog = fixture.debugElement.query(By.directive(VaultRepromptDialogComponent))
      .componentInstance as VaultRepromptDialogComponent;

    await fixture.componentInstance.archiveItem(protectedLogin);
    invalidate(store, fixture);
    dialog.masterPassword = "correct-password";
    await dialog.submit();

    expect(actions.archiveItemWithOutcome).not.toHaveBeenCalled();
  });

  it("renders an unavailable state with a working sync retry", async () => {
    const store = new PopupStateStore();
    const syncNow = vi.fn(async () => undefined);
    store.setUnlocked("user@example.com");
    store.failVaultSync(false);
    await TestBed.configureTestingModule({
      imports: [VaultListPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        { provide: VaultSessionService, useValue: { syncNow } },
        VaultFacade,
        { provide: VaultActionsService, useValue: {} },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(VaultListPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain("无法加载密码库，请重试。");
    expect(host.textContent).not.toContain("密码库为空");
    host.querySelector<HTMLButtonElement>('[data-testid="vault-sync-retry"]')!.click();
    await fixture.whenStable();
    expect(syncNow).toHaveBeenCalledOnce();
  });

  it("keeps the rendered unavailable Retry after a failed sync", async () => {
    const store = new PopupStateStore();
    store.setUnlocked("account-a@example.test");
    store.setActiveSession(fakeSession("account-a"));
    store.failVaultSync(false);
    const syncNow = vi.fn(async () => store.failVaultSync(false));
    await TestBed.configureTestingModule({
      imports: [VaultListPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        { provide: VaultSessionService, useValue: { syncNow } },
        { provide: VaultActionsService, useValue: {} },
        VaultFacade,
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(VaultListPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    host.querySelector<HTMLButtonElement>('[data-testid="vault-sync-retry"]')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(syncNow).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("无法加载密码库，请重试。");
    expect(host.querySelectorAll('[data-testid="vault-sync-retry"]')).toHaveLength(1);
  });

  it("keeps usable rows visible with a fixed stale sync callout", async () => {
    const store = new PopupStateStore();
    store.setUnlocked("user@example.com");
    store.setItems([demoVaultItems[0]], demoFolders);
    store.failVaultSync(true);
    await TestBed.configureTestingModule({
      imports: [VaultListPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        { provide: VaultSessionService, useValue: { syncNow: vi.fn(async () => undefined) } },
        VaultFacade,
        { provide: VaultActionsService, useValue: {} },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(VaultListPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain("GitHub");
    expect(host.textContent).toContain("无法同步，正在显示已保存的密码库数据。");
    expect(host.textContent).not.toContain("opaque private response");
    expect(host.querySelector('[data-testid="vault-sync-callout"].macos-alert-strip'))
      .not.toBeNull();
  });

  it("keeps the stale retry callout visible when search has no results", async () => {
    const store = new PopupStateStore();
    store.setUnlocked("user@example.com");
    store.setItems([demoVaultItems[0]], demoFolders);
    store.failVaultSync(true);
    await TestBed.configureTestingModule({
      imports: [VaultListPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        { provide: VaultSessionService, useValue: { syncNow: vi.fn(async () => undefined) } },
        VaultFacade,
        { provide: VaultActionsService, useValue: {} },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(VaultListPageComponent);
    fixture.componentInstance.setSearch("does-not-match");
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain("没有搜索到匹配的项目");
    expect(host.textContent).toContain("无法同步，正在显示已保存的密码库数据。");
    expect(host.querySelector('[data-testid="vault-sync-retry"]')).not.toBeNull();
  });

  it("renders the centered native header, search, hierarchy, and retained rows", async () => {
    const store = new PopupStateStore();
    store.setUnlocked("user@example.com");
    store.setItems(demoVaultItems, demoFolders);
    await TestBed.configureTestingModule({
      imports: [VaultListPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        VaultFacade,
        { provide: VaultActionsService, useValue: {} },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(VaultListPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector("popup-page > popup-header h1")?.textContent).toContain("密码库");
    expect(host.querySelector<HTMLInputElement>('[aria-label="搜索密码库"]')?.placeholder).toBe("搜索");
    expect(host.querySelector("app-vault-header")).toBeNull();
    expect(host.querySelector("app-vault-list-filters")).toBeNull();
    expect(host.querySelector('[aria-label="筛选密码库"]')).toBeNull();
    expect(host.querySelectorAll("[data-vault-node]")).toHaveLength(6);
    expect(host.querySelector('[data-vault-node="all-items"]')?.getAttribute("aria-expanded"))
      .toBe("true");
    expect(host.querySelector("bw-vault-hierarchy app-vault-list-items-container cdk-virtual-scroll-viewport"))
      .not.toBeNull();
    expect(host.querySelector("bw-vault-hierarchy")?.parentElement?.tagName)
      .not.toBe("VAULT-FADE-IN-OUT");
    expect(host.textContent).toContain("GitHub");
  });

  it("applies native search immediately while the initial vault is loading", async () => {
    const store = new PopupStateStore();
    store.setUnlocked("user@example.com");
    store.setSyncing(true);
    await TestBed.configureTestingModule({
      imports: [VaultListPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        VaultFacade,
        { provide: VaultActionsService, useValue: {} },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(VaultListPageComponent);
    const vault = TestBed.inject(VaultFacade);
    fixture.detectChanges();

    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      '[aria-label="搜索密码库"]',
    )!;
    input.value = "github";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    fixture.detectChanges();

    expect(vault.queryValue()).toBe("github");
  });

  it("shows focused search results and restores the hierarchy after clearing", async () => {
    const store = new PopupStateStore();
    store.setItems(demoVaultItems, demoFolders);
    await TestBed.configureTestingModule({
      imports: [VaultListPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        VaultFacade,
        { provide: VaultActionsService, useValue: {} },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(VaultListPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const input = host.querySelector<HTMLInputElement>('[aria-label="搜索密码库"]')!;

    input.value = "card";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    fixture.detectChanges();
    expect(host.querySelector("bw-vault-hierarchy")).toBeNull();
    expect(fixture.componentInstance.sections.flatMap((section) => section.items)
      .map((item) => item.name)).toEqual(["Travel card"]);

    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    fixture.detectChanges();
    expect(host.querySelector("bw-vault-hierarchy")).not.toBeNull();
  });

  it("places the root header in the above-scroll slot and marks the macOS surface", async () => {
    const store = new PopupStateStore();
    store.setItems(demoVaultItems, demoFolders);
    await TestBed.configureTestingModule({
      imports: [VaultListPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        VaultFacade,
        { provide: VaultActionsService, useValue: {} },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(VaultListPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const page = host.querySelector("popup-page");

    expect(host.querySelector("popup-page > main")).not.toBeNull();
    expect(host.querySelector('bw-root-search[slot="above-scroll-area"]')).not.toBeNull();
    expect(host.querySelector('popup-page > popup-header[slot="header"]')).not.toBeNull();
    expect(page?.classList).toContain("macos-page");
    expect(page?.classList).toContain("macos-page--vault-list");
    expect(page?.dataset.vaultState).toBe("ready");
    expect(host.querySelector("bw-vault-hierarchy")).not.toBeNull();
  });

  it("renders the title-bar New menu without legacy filter context", async () => {
    const store = new PopupStateStore();
    store.setUnlocked("user@example.com");
    store.setItems(demoVaultItems, demoFolders);
    store.setFilterFolderId("work");
    await TestBed.configureTestingModule({
      imports: [VaultListPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        VaultFacade,
        { provide: VaultActionsService, useValue: {} },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(VaultListPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const newAction = host.querySelector<HTMLButtonElement>(
      "popup-header bw-retained-new-item-dropdown app-new-item-dropdown button[bitbutton]",
    );
    expect(newAction).not.toBeNull();
    newAction!.click();
    fixture.detectChanges();
    const login = TestBed.inject(OverlayContainer).getContainerElement().querySelector<HTMLAnchorElement>(
      '.bit-menu-panel a[role="menuitem"]',
    );

    expect(login).not.toBeNull();
    expect(new URL(login!.href).searchParams.get("folderId")).toBeNull();
    expect(host.querySelector("app-current-account button")).not.toBeNull();
  });

  it("uses peer nodes instead of filters and opens a type child inline", async () => {
    const store = new PopupStateStore();
    store.setItems(demoVaultItems, demoFolders);
    await TestBed.configureTestingModule({
      imports: [VaultListPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        VaultFacade,
        { provide: VaultActionsService, useValue: {} },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(VaultListPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector("bit-chip-filter")).toBeNull();
    expect(host.querySelector('[role="toolbar"][aria-label="筛选"]')).toBeNull();
    host.querySelector<HTMLButtonElement>('[data-vault-node="types"]')!.click();
    fixture.detectChanges();
    host.querySelector<HTMLButtonElement>('[data-vault-child="type:card"]')!.click();
    fixture.detectChanges();

    const visibleItems = fixture.debugElement
      .queryAll(By.directive(VaultListItemsContainerComponent))
      .filter((element) =>
        (element.nativeElement as HTMLElement).closest("[aria-hidden='true']") === null
      )
      .flatMap((element) => element.componentInstance.section.items as readonly { name: string }[]);
    expect(visibleItems.map((item) => item.name)).toEqual([
      "GitHub",
      "Travel card",
      "Personal identity",
      "Recovery note",
      "Travel card",
    ]);
    expect(store.snapshot().filterFolderId).toBe("");
    expect(store.snapshot().filterType).toBe("");
  });

  it("keeps peer nodes open independently and exposes Archive and Trash under hidden items", async () => {
    const store = new PopupStateStore();
    store.setItems(demoVaultItems, demoFolders);
    store.setArchivedItems([{ ...demoVaultItems[0]!, id: "archived" }]);
    store.setDeletedItems([{ ...demoVaultItems[1]!, id: "deleted" }]);
    await TestBed.configureTestingModule({
      imports: [VaultListPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        VaultFacade,
        { provide: VaultActionsService, useValue: {} },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(VaultListPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLButtonElement>('[data-vault-node="hidden"]')!.click();
    fixture.detectChanges();

    expect(host.querySelectorAll('[data-vault-node][aria-expanded="true"]')).toHaveLength(2);
    expect(host.querySelector('[data-vault-child="archive"]')?.textContent).toContain("1");
    expect(host.querySelector('[data-vault-child="trash"]')?.textContent).toContain("1");
  });

  it("hides row quick copy-and-fill actions when the official appearance setting is disabled", async () => {
    const store = new PopupStateStore();
    const settings = new SettingsService();
    settings.setShowQuickCopyActions(false);
    store.setUnlocked("user@example.com");
    store.setItems([demoVaultItems[0]], demoFolders);
    await TestBed.configureTestingModule({
      imports: [VaultListPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        { provide: SettingsService, useValue: settings },
        VaultFacade,
        {
          provide: VaultActionsService,
          useValue: {
            copyField: async () => "Copied",
            fillField: async () => "Filled",
            launchItem: async () => "Open",
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(VaultListPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[aria-label="打开"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="更多"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="复制并填入用户名"]')).toBeNull();
    expect(host.querySelector('[aria-label="复制并填入密码"]')).toBeNull();
    expect(host.querySelector('[aria-label="复制并填入验证码"]')).toBeNull();
  });

  it("keeps at most one row overflow menu open", async () => {
    const store = new PopupStateStore();
    store.setItems(demoVaultItems.slice(0, 2), demoFolders);
    await TestBed.configureTestingModule({
      imports: [VaultListPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        VaultFacade,
        { provide: VaultActionsService, useValue: {} },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(VaultListPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const triggers = host.querySelectorAll<HTMLButtonElement>('[aria-label="更多"]');

    triggers[0]!.click();
    fixture.detectChanges();
    const firstOpenRowId = fixture.componentInstance.openMenuRowId;
    expect(firstOpenRowId).not.toBeNull();
    expect(document.querySelectorAll('[role="menu"][aria-label="更多"]')).toHaveLength(1);
    const nextTrigger = Array.from(
      host.querySelectorAll<HTMLButtonElement>('[aria-label="更多"]'),
    ).find((trigger) => trigger.getAttribute("aria-expanded") === "false")!;
    nextTrigger.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.openMenuRowId).not.toBe(firstOpenRowId);
    await new Promise((resolve) => setTimeout(resolve, 110));
    fixture.detectChanges();
    expect(document.querySelectorAll('[role="menu"][aria-label="更多"]')).toHaveLength(1);
    expect(
      Array.from(host.querySelectorAll<HTMLButtonElement>('[aria-label="更多"]'))
        .filter((trigger) => trigger.getAttribute("aria-expanded") === "true"),
    ).toHaveLength(1);
  });

  it.each([
    [59, false],
    [53, true],
  ] as const)("uses the official %spx virtual row pitch when compact mode is %s", async (expectedPitch, compactMode) => {
    const store = new PopupStateStore();
    store.setItems([{ ...demoVaultItems[0], favorite: false }], demoFolders);
    const settings = new SettingsService();
    settings.setCompactMode(compactMode);
    await TestBed.configureTestingModule({
      imports: [VaultListPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        { provide: SettingsService, useValue: settings },
        VaultFacade,
        { provide: VaultActionsService, useValue: {} },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(VaultListPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const container = fixture.debugElement.query(By.directive(VaultListItemsContainerComponent))
      .componentInstance as { readonly itemHeight$: Observable<number> };

    expect(await firstValueFrom(container.itemHeight$)).toBe(expectedPitch);
  });

  it("keeps a 229-item hierarchy bounded to the virtual viewport while scrolling", async () => {
    const store = new PopupStateStore();
    const items = Array.from({ length: 229 }, (_, index) => ({
      ...demoVaultItems[0],
      id: `large-${index}`,
      name: `Large item ${index}`,
      favorite: false,
    }));
    store.setItems(items, demoFolders);
    await TestBed.configureTestingModule({
      imports: [VaultListPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        VaultFacade,
        { provide: VaultActionsService, useValue: {} },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(VaultListPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
    fixture.detectChanges();
    const renderedRows = host.querySelectorAll("app-retained-vault-list-item").length;

    expect(renderedRows).toBeGreaterThan(0);
    expect(renderedRows).toBeLessThan(40);
    expect(host.querySelector("bw-vault-hierarchy cdk-virtual-scroll-viewport")).not.toBeNull();
    expect(host.querySelector("bw-vault-hierarchy .cdk-virtual-scroll-spacer")).not.toBeNull();
    expect(host.querySelector('[data-testid="vault-progressive-loading"]')).toBeNull();
  });

  it("keeps the same retained row element when equal cipher IDs are reprojected", async () => {
    const store = new PopupStateStore();
    store.setItems([{ ...demoVaultItems[0], favorite: false }], demoFolders);
    await TestBed.configureTestingModule({
      imports: [VaultListPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        VaultFacade,
        { provide: VaultActionsService, useValue: {} },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(VaultListPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const initialRow = host.querySelector("app-retained-vault-list-item");
    const container = fixture.debugElement.query(By.directive(VaultListItemsContainerComponent))
      .componentInstance as {
        trackByCipher(index: number, cipher: { readonly id: string }): string;
      };

    fixture.detectChanges();

    expect(container.trackByCipher(0, { id: "github" })).toBe("github");
    expect(host.querySelector("app-retained-vault-list-item")).toBe(initialRow);
  });

  it("preserves the store-owned peer disclosure after route reconstruction", async () => {
    const store = new PopupStateStore();
    store.setItems([demoVaultItems[0]], demoFolders);
    await TestBed.configureTestingModule({
      imports: [VaultListPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        VaultFacade,
        { provide: VaultActionsService, useValue: {} },
      ],
    }).compileComponents();
    const first = TestBed.createComponent(VaultListPageComponent);
    first.detectChanges();
    await first.whenStable();
    first.detectChanges();
    const firstHost = first.nativeElement as HTMLElement;
    firstHost.querySelector<HTMLButtonElement>('[data-vault-node="favorites"]')!.click();
    first.detectChanges();
    expect(firstHost.querySelector('[data-vault-node="favorites"]')?.getAttribute("aria-expanded"))
      .toBe("true");
    expect(firstHost.querySelector('[data-vault-node="all-items"]')?.getAttribute("aria-expanded"))
      .toBe("true");
    first.destroy();

    const second = TestBed.createComponent(VaultListPageComponent);
    second.detectChanges();
    await second.whenStable();
    second.detectChanges();
    const secondHost = second.nativeElement as HTMLElement;
    expect(secondHost.querySelector('[data-vault-node="all-items"]')?.getAttribute("aria-expanded"))
      .toBe("true");
    expect(secondHost.querySelector('[data-vault-node="favorites"]')?.getAttribute("aria-expanded"))
      .toBe("true");
  });

  it.each([
    ["menu-open", true, false],
    ["no-results", false, true],
    ["search-results", false, false],
  ] as const)("initializes the fixed %s evidence interaction", async (evidenceState, hasMenu, hasNoResults) => {
    const store = new PopupStateStore();
    applyVaultMainEvidenceState(store, evidenceState);
    await TestBed.configureTestingModule({
      imports: [VaultListPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        { provide: VAULT_MAIN_EVIDENCE_STATE, useValue: evidenceState },
        VaultFacade,
        { provide: VaultActionsService, useValue: {} },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(VaultListPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(fixture.componentInstance.openMenuRowId).toBeNull();
    if (hasMenu) {
      const mailRow = Array.from(
        host.querySelectorAll<HTMLElement>("app-retained-vault-list-item"),
      ).find((row) => row.textContent?.includes("Example Mail"));
      mailRow?.querySelector<HTMLButtonElement>('button[aria-label="更多"]')?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(document.querySelectorAll('[role="menu"][aria-label="更多"]')).toHaveLength(1);
      expect(
        host.querySelector('[aria-label="更多"][aria-expanded="true"]'),
      ).not.toBeNull();
    } else {
      expect(document.querySelector('[role="menu"][aria-label="更多"]')).toBeNull();
    }
    expect(host.textContent?.includes("没有搜索到匹配的项目")).toBe(hasNoResults);
    if (evidenceState === "search-results") {
      expect(host.textContent).toContain("搜索结果");
      expect(host.textContent).toContain("Example Calendar");
      expect(host.textContent).not.toContain("Example Mail");
    }
  });

  it.each([
    ["compact", true, "light"],
    ["light", false, "light"],
    ["dark", false, "dark"],
  ] as const)("applies the fixed %s appearance fixture", async (evidenceState, compactMode, theme) => {
    const store = new PopupStateStore();
    const settings = new SettingsService();
    applyVaultMainEvidenceState(store, evidenceState);
    await TestBed.configureTestingModule({
      imports: [VaultListPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        { provide: SettingsService, useValue: settings },
        { provide: VAULT_MAIN_EVIDENCE_STATE, useValue: evidenceState },
        VaultFacade,
        { provide: VaultActionsService, useValue: {} },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(VaultListPageComponent);
    fixture.detectChanges();

    expect(settings.snapshot()).toMatchObject({ compactMode, theme });
  });

  it("clears row menu ownership when search hides the open row", async () => {
    const store = new PopupStateStore();
    store.setItems(demoVaultItems, demoFolders);
    await TestBed.configureTestingModule({
      imports: [VaultListPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        VaultFacade,
        { provide: VaultActionsService, useValue: {} },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(VaultListPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const githubRow = Array.from(host.querySelectorAll<HTMLElement>("bit-item"))
      .find((row) => row.textContent?.includes("GitHub"))!;
    githubRow.querySelector<HTMLButtonElement>('[aria-label="更多"]')!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.openMenuRowId).not.toBeNull();

    const search = host.querySelector<HTMLInputElement>('[aria-label="搜索密码库"]')!;
    search.value = "card";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.openMenuRowId).toBeNull();
    await fixture.whenStable();
    fixture.detectChanges();
    search.value = "";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(document.querySelector('[role="menu"][aria-label="更多"]')).toBeNull();
  });

  it("renders the official empty vault state with a new login action", async () => {
    const store = new PopupStateStore();
    store.setUnlocked("user@example.com");
    store.setItems([], []);
    await TestBed.configureTestingModule({
      imports: [VaultListPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        VaultFacade,
        {
          provide: VaultActionsService,
          useValue: {
            copyField: async () => "Copied",
            fillField: async () => "Filled",
            launchItem: async () => "Open",
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(VaultListPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const noItems = fixture.debugElement.query(By.directive(NoItemsComponent)).componentInstance as NoItemsComponent;
    expect(host.querySelector("vault-fade-in-out > .tw-flex.tw-h-full.tw-justify-center")).not.toBeNull();
    expect(noItems.icon()).toBe(VaultOpen);
    expect(host.textContent).toContain("您的密码库是空的");
    expect(host.textContent).toContain("密码库不仅保护您的密码。在这里还可以安全地存储登录、ID、支付卡和笔记。");
    const newLogin = host.querySelector<HTMLAnchorElement>('a[href*="add-cipher"]');
    expect(newLogin?.textContent).toContain("新增登录");
    const newLoginUrl = new URL(newLogin!.href);
    expect(newLoginUrl.searchParams.get("type")).toBe("1");
    expect(newLoginUrl.searchParams.has("prefillNameAndURIFromTab")).toBe(false);
    expect(host.textContent).not.toContain("自动填充建议");
    expect(host.textContent).not.toContain("所有项目");
  });

  it("renders the pinned no-results illustration, layout, copy, and filtered count", async () => {
    const store = new PopupStateStore();
    store.setUnlocked("user@example.com");
    store.setItems(demoVaultItems, demoFolders);
    await TestBed.configureTestingModule({
      imports: [VaultListPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        VaultFacade,
        { provide: VaultActionsService, useValue: {} },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(VaultListPageComponent);
    fixture.componentInstance.setSearch("does-not-match");
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const noItems = fixture.debugElement.query(By.directive(NoItemsComponent)).componentInstance as NoItemsComponent;
    expect(host.querySelector(".tw-flex.tw-flex-col.tw-justify-center.tw-h-auto.tw-pt-12 > bit-no-items")).not.toBeNull();
    expect(noItems.icon()).toBe(NoResults);
    expect(host.textContent).toContain("没有搜索到匹配的项目");
    expect(host.textContent).toContain("清除筛选或尝试其他搜索词");
    expect(fixture.componentInstance.sections[0]?.count).toBe(0);
  });

  it("does not expose deferred at-risk password reports when local login risks exist", async () => {
    const store = new PopupStateStore();
    store.setUnlocked("user@example.com");
    store.setItems([
      {
        ...demoVaultItems[0],
        id: "weak-login",
        name: "Weak Login",
        fields: demoVaultItems[0].fields.map((field) => field.id === "password" ? { ...field, value: "password" } : field),
      },
      {
        ...demoVaultItems[0],
        id: "reused-a",
        name: "Reused A",
        fields: demoVaultItems[0].fields.map((field) => field.id === "password" ? { ...field, value: "same-secure-password" } : field),
      },
      {
        ...demoVaultItems[0],
        id: "reused-b",
        name: "Reused B",
        fields: demoVaultItems[0].fields.map((field) => field.id === "password" ? { ...field, value: "same-secure-password" } : field),
      },
    ]);
    await TestBed.configureTestingModule({
      imports: [VaultListPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        VaultFacade,
        {
          provide: VaultActionsService,
          useValue: {
            copyField: async () => "Copied",
            fillField: async () => "Filled",
            launchItem: async () => "Open",
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(VaultListPageComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).not.toContain("存在风险的密码");
    expect(host.querySelector('a[href="/at-risk-passwords"]')).toBeNull();
  });

  it("renders the official loading skeleton during initial vault sync", async () => {
    const store = new PopupStateStore();
    store.setUnlocked("user@example.com");
    store.setSyncing(true);
    await TestBed.configureTestingModule({
      imports: [VaultListPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        VaultFacade,
        {
          provide: VaultActionsService,
          useValue: {
            copyField: async () => "Copied",
            fillField: async () => "Filled",
            launchItem: async () => "Open",
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(VaultListPageComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector("vault-fade-in-out-skeleton vault-loading-skeleton")).not.toBeNull();
    expect(host.querySelectorAll("vault-loading-skeleton bit-skeleton-group")).toHaveLength(15);
    expect(host.textContent).not.toContain("密码库为空");
  });

  it("runs row more menu state actions through the vault page", async () => {
    const store = new PopupStateStore();
    store.setUnlocked("account-a@example.test");
    store.setActiveSession(fakeSession("account-a"));
    store.setItems([demoVaultItems[0]], demoFolders);
    const cipherActions: VaultCipherActionPort = {
      updateCipherPartial: vi.fn(async () => undefined),
      softDeleteCipher: vi.fn(async () => undefined),
      archiveCipher: vi.fn(async () => undefined),
      unarchiveCipher: vi.fn(async () => undefined),
      restoreCipher: vi.fn(async () => undefined),
      deleteCipher: vi.fn(async () => undefined),
    };
    await TestBed.configureTestingModule({
      imports: [VaultListPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        { provide: VAULT_CIPHER_ACTION_PORT, useValue: cipherActions },
        VaultFacade,
        VaultActionsService,
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(VaultListPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    (host.querySelector('[aria-label="更多"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menu"][aria-label="更多"] [role="menuitem"]'))
      .find((button) => button.textContent?.includes("归档"))
      ?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.snapshot().items).toEqual([]);
    expect(cipherActions.archiveCipher).toHaveBeenCalledWith(
      store.snapshot().activeSession,
      "github",
    );
    expect(store.snapshot().archivedItems.map((item) => item.id)).toEqual(["github"]);
    expect(store.snapshot().statusMessage).toBe(translateOfficialMessage("i18nArchivedItem"));
  });

  it("relays every rendered retained row action with the exact item and field", async () => {
    const store = new PopupStateStore();
    const item = { ...demoVaultItems[0] };
    const username = item.fields.find((field) => field.id === "username")!;
    store.setUnlocked("account-a@example.test");
    store.setActiveSession(fakeSession("account-a"));
    store.setItems([item], demoFolders);
    const actions = {
      copyField: vi.fn(async () => "Copied Username"),
      fillField: vi.fn(async () => "Filled Username"),
      launchItem: vi.fn(async () => "Opened URL"),
      toggleFavoriteWithOutcome: vi.fn(async () => ({
        committed: false,
        reason: "failure",
        status: "Unable to update favorite.",
      })),
      archiveItemWithOutcome: vi.fn(async () => ({
        committed: false,
        reason: "failure",
        status: "Unable to archive item.",
      })),
      deleteItemWithOutcome: vi.fn(async () => ({
        committed: false,
        reason: "failure",
        status: "Unable to delete item.",
      })),
    };
    await TestBed.configureTestingModule({
      imports: [VaultListPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        { provide: VaultActionsService, useValue: actions },
        { provide: VaultSessionService, useValue: { syncNow: vi.fn(async () => undefined) } },
        VaultFacade,
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(VaultListPageComponent);
    TestBed.inject(SettingsService).setShowQuickCopyActions(true);
    const router = TestBed.inject(Router);
    const navigateByUrl = vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);
    const navigate = vi.spyOn(router, "navigate").mockResolvedValue(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const row = host.querySelector<HTMLElement>("app-retained-vault-list-item")!;
    const overlay = TestBed.inject(OverlayContainer).getContainerElement();
    const copyFeedback = TestBed.inject(LocalCopyFeedbackService);
    copyFeedback.start();

    const clickMenuAction = async (label: string) => {
      row.querySelector<HTMLButtonElement>('[aria-label="更多"]')!.click();
      fixture.detectChanges();
      const action = Array.from(overlay.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
        .find((button) => button.textContent?.trim() === label);
      expect(action, label).toBeDefined();
      action!.click();
      await fixture.whenStable();
      fixture.detectChanges();
    };

    await clickMenuAction("查看");
    await clickMenuAction("编辑");
    await clickMenuAction("克隆");
    const fillButton = row.querySelector<HTMLButtonElement>('[aria-label="复制并填入用户名"]')!;
    fillButton.click();
    row.querySelector<HTMLButtonElement>('[aria-label="打开"]')!.click();
    await fixture.whenStable();
    await clickMenuAction("取消收藏");
    await clickMenuAction("归档");
    await clickMenuAction("删除");

    expect(navigateByUrl).toHaveBeenCalledWith(`/view-cipher/${item.id}`);
    expect(navigate).toHaveBeenNthCalledWith(1, ["/edit-cipher"], {
      queryParams: { cipherId: item.id, type: "1" },
    });
    expect(navigate).toHaveBeenNthCalledWith(2, ["/clone-cipher"], {
      queryParams: { cipherId: item.id, type: "1" },
    });
    expect(actions.fillField).toHaveBeenCalledWith(username);
    expect(fillButton.classList).toContain("is-copy-confirmed");
    expect(actions.copyField).not.toHaveBeenCalled();
    expect(actions.launchItem).toHaveBeenCalledWith(item);
    expect(actions.toggleFavoriteWithOutcome).toHaveBeenCalledWith(item, expect.any(Function));
    expect(actions.archiveItemWithOutcome).toHaveBeenCalledWith(item, expect.any(Function));
    expect(actions.deleteItemWithOutcome).toHaveBeenCalledWith(item, expect.any(Function));
    expect(actions.toggleFavoriteWithOutcome.mock.calls[0]?.[1]()).toBe(true);
    copyFeedback.destroy();
  });
});

function fakeSession(accessToken: string): AuthSession {
  return {
    environment: {
      apiUrl: "https://api.example.test",
      identityUrl: "https://identity.example.test",
      iconsUrl: null,
      webVaultUrl: "https://vault.example.test",
      sendUrl: "https://send.example.test",
    },
    token: {
      accessToken,
      refreshToken: `${accessToken}-refresh`,
      tokenType: "Bearer",
      expiresIn: 3600,
    },
  };
}
