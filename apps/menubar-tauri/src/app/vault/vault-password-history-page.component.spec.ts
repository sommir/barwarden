import "zone.js";
import "@angular/compiler";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { Location } from "@angular/common";
import { By } from "@angular/platform-browser";
import { TestBed } from "@angular/core/testing";
import { ActivatedRoute, provideRouter, Router } from "@angular/router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import type { VaultItem } from "../vault-demo";
import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { LocalCopyFeedbackService } from "../official-ui/local-copy-feedback.service";
import { POP_OUT_HOST } from "../popup-header-actions.component";
import { PopupStateStore } from "../popup-state";
import { SettingsService } from "../settings/settings.service";
import { demoVaultItems } from "../vault-demo";
import { VAULT_ACTION_HOST } from "./vault-actions.service";
import { VaultFacade } from "./vault.facade";
import { VaultPasswordHistoryPageComponent } from "./vault-password-history-page.component";
import { VaultRepromptService } from "./vault-reprompt.service";
import { VaultRepromptDialogComponent } from "./vault-reprompt-dialog.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("VaultPasswordHistoryPageComponent", () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  const historyItem: VaultItem = {
    ...demoVaultItems[0],
    passwordHistory: [
      { password: "old-secret-1", lastUsedDate: "2026-07-11T08:09:10.000Z" },
      { password: "old-secret-2", lastUsedDate: "2026-07-10T08:09:10.000Z" },
    ],
  };
  const emptyHistoryItem: VaultItem = { ...demoVaultItems[0], passwordHistory: [] };
  const expectedMediumDate = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date("2026-07-11T08:09:10.000Z"));

  async function setupHistory(input: {
    cipherId: string | null;
    item: VaultItem | null | Promise<VaultItem | null>;
  }) {
    TestBed.resetTestingModule();
    let facadeItem = input.item;

    const actionHost = {
      showPopup: vi.fn(async () => undefined),
      hidePopup: vi.fn(async () => undefined),
      copyText: vi.fn(async () => undefined),
      pasteText: vi.fn(async () => undefined),
      openUrl: vi.fn(async () => undefined),
      secureGet: vi.fn(async () => null),
      secureSet: vi.fn(async () => undefined),
      secureDelete: vi.fn(async () => undefined),
    };
    const location = { back: vi.fn() };
    const popOut = { popOut: vi.fn(async () => undefined) };
    const settings = new SettingsService();
    settings.setClipboardClearSeconds(60);

    await TestBed.configureTestingModule({
      imports: [VaultPasswordHistoryPageComponent],
      providers: [
        provideRouter([]),
        { provide: Location, useValue: location },
        { provide: PopupStateStore, useValue: new PopupStateStore() },
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        { provide: SettingsService, useValue: settings },
        { provide: VAULT_ACTION_HOST, useValue: actionHost },
        { provide: POP_OUT_HOST, useValue: popOut },
        { provide: VaultRepromptService, useValue: { verify: vi.fn().mockResolvedValue(true) } },
        {
          provide: VaultFacade,
          useValue: {
            itemById: vi.fn(() => facadeItem),
          } satisfies Pick<VaultFacade, "itemById">,
        },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: { get: (key: string) => (key === "cipherId" ? input.cipherId : null) },
            },
          },
        },
      ],
    }).compileComponents();

    const router = TestBed.inject(Router);
    vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);
    const fixture = TestBed.createComponent(VaultPasswordHistoryPageComponent);
    fixture.detectChanges(false);

    return {
      fixture,
      location,
      actionHost,
      router,
      store: TestBed.inject(PopupStateStore),
      replaceFacadeItem(item: VaultItem | null | Promise<VaultItem | null>): void {
        facadeItem = item;
      },
    };
  }

  it("keeps the popup page loading until the selected cipher resolves", async () => {
    const item = deferred<VaultItem | null>();
    const { fixture } = await setupHistory({ cipherId: "cipher-1", item: item.promise });
    const host = fixture.nativeElement as HTMLElement;
    expect(
      host.querySelector('[data-testid="popup-layout-scroll-region"].tw-invisible'),
    ).not.toBeNull();
    expect(host.querySelector("popup-page main > span:not(.tw-invisible)")).not.toBeNull();
    expect(
      host.querySelector("popup-page main bit-icon[aria-label='正在加载']"),
    ).not.toBeNull();
    expect(host.querySelector(".password-history-loading")).toBeNull();
    item.resolve(historyItem);
    await item.promise;
    await Promise.resolve();
    await settle(fixture);
    expect(host.querySelector("popup-page main > span.tw-invisible")).not.toBeNull();
  });

  it.each([null, "missing"])("returns through Location.back when %s resolves and popup history exists", async (cipherId) => {
    vi.spyOn(window.history, "state", "get").mockReturnValue({ navigationId: 2 });
    const { fixture, location } = await setupHistory({ cipherId, item: null });
    await settle(fixture);
    expect(location.back).toHaveBeenCalledOnce();
  });

  it.each([null, "missing"])(
    "navigates to /tabs/vault without back-navigation when %s resolves with no popup history",
    async (cipherId) => {
      vi.spyOn(window.history, "state", "get").mockReturnValue(undefined);
      vi.spyOn(window.history, "length", "get").mockReturnValue(1);

      const { fixture, location, router } = await setupHistory({ cipherId, item: null });
      await settle(fixture);

      expect(location.back).not.toHaveBeenCalled();
      expect(router.navigateByUrl).toHaveBeenCalledWith("/tabs/vault", { replaceUrl: true });
    },
  );

  it("renders the official empty state without generic attachment UI", async () => {
    const { fixture } = await setupHistory({ cipherId: "cipher-1", item: emptyHistoryItem });
    await settle(fixture);
    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain("列表中没有密码");
    expect(host.querySelector(".tw-absolute[class~='tw-top-1/2'][class~='tw-left-1/2']")).not.toBeNull();
    expect(host.querySelector(".password-history-empty")).toBeNull();
    expect(host.querySelector(".attachment-actions")).toBeNull();
    expect(host.querySelector(".detail-summary-card")).toBeNull();
  });

  it("renders retained official color-password rows and copies with the configured timeout", async () => {
    await new OfficialI18nService().setLocale("zh-CN");
    const { fixture, actionHost, store } = await setupHistory({ cipherId: "cipher-1", item: historyItem });
    await settle(fixture);
    const host = fixture.nativeElement as HTMLElement;
    const colorPasswords = host.querySelectorAll("bw-official-password-history-view bit-color-password");
    expect(colorPasswords).toHaveLength(2);
    expect(host.querySelector("bw-official-password-history-view bit-item bit-color-password")).not.toBeNull();
    expect(host.querySelector("[appCopyClick]")).toBeNull();
    expect(host.textContent).toContain("old-secret-1");
    expect(host.textContent).toContain("old-secret-2");
    expect(host.querySelector("[data-testid^='history-reveal-']")).toBeNull();
    const copyButton = host.querySelector<HTMLButtonElement>("[data-testid='history-copy-0']")!;
    const copyFeedback = TestBed.inject(LocalCopyFeedbackService);
    copyFeedback.start();
    copyButton.focus();
    copyButton.click();
    await fixture.whenStable();
    expect(actionHost.copyText).toHaveBeenCalledWith("old-secret-1", 60);
    expect(globalThis.location.pathname + globalThis.location.search).not.toContain("old-secret-1");
    expect(store.snapshot().statusMessage).toBe("已复制密码历史记录");
    expect(copyButton.getAttribute("aria-label")).toBe("已复制");
    expect(copyButton.querySelector(".bwi-check")).not.toBeNull();
    expect(document.activeElement).toBe(copyButton);
    const date = host.querySelector<HTMLElement>("[data-testid='history-date-0']");
    expect(date?.tagName).toBe("DIV");
    expect(date?.classList.contains("tw-text-sm")).toBe(true);
    expect(date?.textContent?.trim()).toBe(expectedMediumDate);
    copyFeedback.destroy();
  });

  it("reports clipboard failure without removing the official history rows", async () => {
    const { fixture, actionHost, store } = await setupHistory({ cipherId: "cipher-1", item: historyItem });
    await settle(fixture);
    const host = fixture.nativeElement as HTMLElement;
    actionHost.copyText.mockRejectedValueOnce(new Error("private clipboard failure"));

    expect(host.querySelector("bit-item bit-item-action")).not.toBeNull();
    host.querySelector<HTMLButtonElement>("[data-testid='history-copy-0']")!.click();
    await fixture.whenStable();

    expect(store.snapshot().statusMessage).toBe("无法复制字段。");
    expect(host.querySelectorAll("bit-item")).toHaveLength(2);
  });

  it("does not copy an entry from a same-id item projection replaced after load", async () => {
    const { fixture, actionHost } = await setupHistory({ cipherId: "cipher-1", item: historyItem });
    await settle(fixture);
    fixture.componentInstance.item = { ...historyItem };

    await fixture.componentInstance.copyPasswordHistory({
      cipherId: historyItem.id,
      password: historyItem.passwordHistory![0]!.password,
      lastUsedDate: new Date(historyItem.passwordHistory![0]!.lastUsedDate),
    });

    expect(actionHost.copyText).not.toHaveBeenCalled();
  });

  it("keeps a reprompt-owned history copy in the route until verification continues it", async () => {
    const { fixture, actionHost } = await setupHistory({
      cipherId: "cipher-1",
      item: { ...historyItem, reprompt: true },
    });
    await settle(fixture);
    const dialog = fixture.debugElement.query(By.directive(VaultRepromptDialogComponent))
      ?.componentInstance as VaultRepromptDialogComponent | undefined;
    expect(dialog).toBeDefined();

    let continuation: (() => void | Promise<void>) | undefined;
    const openFor = vi.spyOn(dialog!, "openFor").mockImplementation((_itemId, next) => {
      continuation = next;
    });
    fixture.nativeElement.querySelector<HTMLButtonElement>("[data-testid='history-copy-0']")!.click();
    await fixture.whenStable();

    expect(openFor).toHaveBeenCalledWith("github", expect.any(Function));
    expect(actionHost.copyText).not.toHaveBeenCalled();
    await continuation!();
    expect(actionHost.copyText).toHaveBeenCalledWith("old-secret-1", 60);
  });

  it("rejects a same-id facade replacement before a reprompt continuation without status or native copy", async () => {
    const sourceItem = { ...historyItem, reprompt: true };
    const { fixture, actionHost, replaceFacadeItem, store } = await setupHistory({
      cipherId: sourceItem.id,
      item: sourceItem,
    });
    await settle(fixture);
    const dialog = fixture.debugElement.query(By.directive(VaultRepromptDialogComponent))
      ?.componentInstance as VaultRepromptDialogComponent | undefined;
    let continuation: (() => void | Promise<void>) | undefined;
    vi.spyOn(dialog!, "openFor").mockImplementation((_itemId, next) => {
      continuation = next;
    });

    fixture.nativeElement.querySelector<HTMLButtonElement>("[data-testid='history-copy-0']")!.click();
    await fixture.whenStable();
    expect(actionHost.copyText).not.toHaveBeenCalled();
    expect(store.snapshot().statusMessage).toBe("");

    replaceFacadeItem({ ...sourceItem });
    await continuation!();

    expect(fixture.componentInstance.item).toBe(sourceItem);
    expect(actionHost.copyText).not.toHaveBeenCalled();
    expect(store.snapshot().statusMessage).toBe("");
  });

  it("prevents native dispatch when a same-id facade replacement occurs before dispatch", async () => {
    const { actionHost, fixture, replaceFacadeItem, store } = await setupHistory({
      cipherId: historyItem.id,
      item: historyItem,
    });
    await settle(fixture);

    fixture.nativeElement.querySelector<HTMLButtonElement>("[data-testid='history-copy-0']")!.click();
    replaceFacadeItem({ ...historyItem });
    await fixture.whenStable();

    expect(fixture.componentInstance.item).toBe(historyItem);
    expect(actionHost.copyText).not.toHaveBeenCalled();
    expect(store.snapshot().statusMessage).toBe("");
  });

  it("suppresses status when a same-id facade replacement occurs during a pending native copy", async () => {
    const copyCompletion = deferred<void>();
    const { actionHost, fixture, replaceFacadeItem, store } = await setupHistory({
      cipherId: historyItem.id,
      item: historyItem,
    });
    actionHost.copyText.mockReturnValue(copyCompletion.promise);
    await settle(fixture);

    fixture.nativeElement.querySelector<HTMLButtonElement>("[data-testid='history-copy-0']")!.click();
    await vi.waitFor(() => expect(actionHost.copyText).toHaveBeenCalledOnce());
    expect(store.snapshot().statusMessage).toBe("");

    replaceFacadeItem({ ...historyItem });
    copyCompletion.resolve(undefined);
    await copyCompletion.promise;
    await fixture.whenStable();

    expect(fixture.componentInstance.item).toBe(historyItem);
    expect(actionHost.copyText).toHaveBeenCalledTimes(1);
    expect(store.snapshot().statusMessage).toBe("");
  });

  it("treats a Promise-like action-time facade result as stale", async () => {
    const { fixture, actionHost, replaceFacadeItem, store } = await setupHistory({
      cipherId: historyItem.id,
      item: historyItem,
    });
    await settle(fixture);
    replaceFacadeItem(Promise.resolve(historyItem));

    fixture.nativeElement.querySelector<HTMLButtonElement>("[data-testid='history-copy-0']")!.click();
    await fixture.whenStable();

    expect(actionHost.copyText).not.toHaveBeenCalled();
    expect(store.snapshot().statusMessage).toBe("");
  });

  it("closes safely when the selected item is not a Login", async () => {
    vi.spyOn(window.history, "state", "get").mockReturnValue(undefined);
    vi.spyOn(window.history, "length", "get").mockReturnValue(1);
    const nonLoginItem = { ...demoVaultItems[1], type: "card" as const };

    const { fixture, router } = await setupHistory({ cipherId: nonLoginItem.id, item: nonLoginItem });
    await settle(fixture);

    expect(fixture.componentInstance.item).toBeNull();
    expect(router.navigateByUrl).toHaveBeenCalledWith("/tabs/vault", { replaceUrl: true });
  });

  it("falls back safely when an entry date is invalid", async () => {
    const { fixture } = await setupHistory({
      cipherId: "cipher-1",
      item: {
        ...historyItem,
        passwordHistory: [{ password: "old-secret-1", lastUsedDate: "not-a-date" }],
      },
    });
    await settle(fixture);
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector("[data-testid='history-date-0']")?.textContent?.trim()).toBe("日期不可用");
  });
});

async function settle(fixture: { whenStable(): Promise<unknown>; detectChanges(checkNoChanges?: boolean): void }) {
  await Promise.resolve();
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges(false);
  await Promise.resolve();
  fixture.detectChanges(false);
  await Promise.resolve();
  fixture.detectChanges(false);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}
