import "zone.js";
import "@angular/compiler";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NEVER } from "rxjs";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { PopupStateStore } from "../popup-state";
import { demoVaultItems } from "../vault-demo";
import { ArchivePageComponent } from "./archive-page.component";
import { TrashPageComponent } from "./trash-page.component";
import { VaultActionsService } from "./vault-actions.service";
import { VaultRepromptService } from "./vault-reprompt.service";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("Archive and Trash pages", () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    });
  });
  it("delegates Archive and Trash DOM to the retained official overlays", () => {
    const archiveSource = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/app/vault/archive-page.component.ts"),
      "utf8",
    );
    const trashSource = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/app/vault/trash-page.component.ts"),
      "utf8",
    );

    expect(archiveSource).toContain("<bw-official-archive");
    expect(archiveSource).not.toContain("<bit-item-group>");
    expect(archiveSource).not.toContain("@for (item of items");
    expect(trashSource).toContain("<bw-official-trash");
    expect(trashSource).not.toContain("<bit-item-group>");
    expect(trashSource).not.toContain("@for (item of items");
  });
  it("does not restore a protected Login before reprompt", async () => {
    const store = new PopupStateStore();
    const protectedLogin = {
      ...demoVaultItems[0],
      id: "deleted-protected",
      reprompt: true,
    };
    unlock(store);
    store.setDeletedItems([protectedLogin]);
    const actions = { restoreDeletedItemWithOutcome: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [TrashPageComponent],
      providers: [
        provideRouter([]),
        { provide: Router, useValue: routeRouter("/trash") },
        { provide: PopupStateStore, useValue: store },
        { provide: VaultActionsService, useValue: actions },
        { provide: VaultRepromptService, useValue: { verify: vi.fn(async () => true) } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TrashPageComponent);
    fixture.detectChanges();
    const dialog = (fixture.nativeElement as HTMLElement).querySelector<HTMLDialogElement>(
      "bw-vault-reprompt-dialog dialog",
    )!;
    Object.defineProperty(dialog, "showModal", {
      configurable: true,
      value: vi.fn(() => dialog.setAttribute("open", "")),
    });

    await fixture.componentInstance.restore(protectedLogin.id);

    expect(dialog.hasAttribute("open")).toBe(true);
    expect(actions.restoreDeletedItemWithOutcome).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation before permanently deleting a Login", async () => {
    const store = new PopupStateStore();
    const deletedItem = { ...demoVaultItems[0], id: "deleted-confirm" };
    unlock(store);
    store.setDeletedItems([deletedItem]);
    const actions = { permanentlyDeleteItemWithOutcome: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [TrashPageComponent],
      providers: [
        provideRouter([]),
        { provide: Router, useValue: routeRouter("/trash") },
        { provide: PopupStateStore, useValue: store },
        { provide: VaultActionsService, useValue: actions },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TrashPageComponent);
    fixture.detectChanges();
    const confirmation = (fixture.nativeElement as HTMLElement).querySelector<HTMLDialogElement>(
      '[data-testid="permanent-delete-confirmation"]',
    )!;
    Object.defineProperty(confirmation, "showModal", {
      configurable: true,
      value: vi.fn(() => confirmation.setAttribute("open", "")),
    });

    await fixture.componentInstance.deleteForever(deletedItem.id);

    expect(confirmation.hasAttribute("open")).toBe(true);
    expect(actions.permanentlyDeleteItemWithOutcome).not.toHaveBeenCalled();
  });
  it("hides deferred SSH records without mutating archive or trash storage", async () => {
    const store = new PopupStateStore();
    const ssh = demoVaultItems.find((item) => item.type === "ssh-key")!;
    store.setArchivedItems([{ ...ssh, id: "archived-ssh", name: "Archived SSH" }]);
    store.setDeletedItems([{ ...ssh, id: "deleted-ssh", name: "Deleted SSH" }]);
    await TestBed.configureTestingModule({
      imports: [ArchivePageComponent, TrashPageComponent],
      providers: [provideRouter([]), { provide: PopupStateStore, useValue: store }],
    }).compileComponents();

    const archive = TestBed.createComponent(ArchivePageComponent);
    const trash = TestBed.createComponent(TrashPageComponent);
    archive.detectChanges();
    trash.detectChanges();

    expect(archive.nativeElement.textContent).not.toContain("Archived SSH");
    expect(trash.nativeElement.textContent).not.toContain("Deleted SSH");
    expect(store.snapshot().archivedItems).toHaveLength(1);
    expect(store.snapshot().deletedItems).toHaveLength(1);
  });

  it("renders archived synced items in an official-style list", async () => {
    const store = new PopupStateStore();
    store.setArchivedItems([{ ...demoVaultItems[0], id: "archived-1", name: "Archived login" }]);

    await TestBed.configureTestingModule({
      imports: [ArchivePageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ArchivePageComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector("popup-header > header h1")?.textContent).toContain("归档");
    expect(host.textContent).toContain("归档中的项目");
    expect(host.textContent).toContain("Archived login");
    expect(host.querySelector("bit-section")).not.toBeNull();
    expect(host.querySelector("bit-section-header")).not.toBeNull();
    expect(host.querySelector("bit-item-group")).not.toBeNull();
    expect(host.querySelector("bit-item button[bit-item-content]")).not.toBeNull();
    expect(host.querySelector("[aria-label='归档选项 Archived login']")).not.toBeNull();
    expect(host.querySelector("[aria-label='弹出到新窗口']")).not.toBeNull();
    expect(host.querySelector("bw-vault-status-list")).toBeNull();
    expect(host.querySelector(".vault-status-row")).toBeNull();
    expect(host.querySelector("bw-official-archive")?.classList).toContain("macos-page");
    expect(host.querySelector("bw-official-archive")?.classList).toContain("macos-page--vault-recovery");
  });

  it("unarchives items from the Archive page", async () => {
    const store = new PopupStateStore();
    const archivedItem = { ...demoVaultItems[0], id: "archived-1", name: "Archived login" };
    unlock(store);
    store.setArchivedItems([archivedItem]);
    const actions = {
      unarchiveItemWithOutcome: vi.fn(async () => {
        store.restoreArchivedVaultItem(archivedItem.id);
        return committed(archivedItem, "Item unarchived");
      }),
    };

    await TestBed.configureTestingModule({
      imports: [ArchivePageComponent],
      providers: [
        provideRouter([]),
        { provide: Router, useValue: routeRouter("/archive") },
        { provide: PopupStateStore, useValue: store },
        { provide: VaultActionsService, useValue: actions },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ArchivePageComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLButtonElement>("[aria-label='归档选项 Archived login']")!.click();
    clickMenuAction("取消归档");
    await fixture.whenStable();
    fixture.detectChanges();

    expect(actions.unarchiveItemWithOutcome).toHaveBeenCalledWith(archivedItem, expect.any(Function));
    expect(store.snapshot().items.map((item) => item.id)).toEqual(["archived-1"]);
    expect(store.snapshot().archivedItems).toEqual([]);
    expect(store.snapshot().statusMessage).toBe("Item unarchived");
  });

  it("moves archived items to Trash from the Archive page", async () => {
    const store = new PopupStateStore();
    const archivedItem = { ...demoVaultItems[0], id: "archived-1", name: "Archived login" };
    unlock(store);
    store.setArchivedItems([archivedItem]);
    const actions = {
      deleteArchivedItemWithOutcome: vi.fn(async () => {
        store.moveArchivedVaultItemToTrash(archivedItem.id);
        return committed(archivedItem, "Moved item to trash");
      }),
    };

    await TestBed.configureTestingModule({
      imports: [ArchivePageComponent],
      providers: [
        provideRouter([]),
        { provide: Router, useValue: routeRouter("/archive") },
        { provide: PopupStateStore, useValue: store },
        { provide: VaultActionsService, useValue: actions },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ArchivePageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const confirmation = host.querySelector<HTMLDialogElement>(
      '[data-testid="archive-delete-confirmation"]',
    )!;
    Object.defineProperty(confirmation, "showModal", {
      configurable: true,
      value: vi.fn(() => confirmation.setAttribute("open", "")),
    });

    host.querySelector<HTMLButtonElement>("[aria-label='归档选项 Archived login']")!.click();
    clickMenuAction("删除");
    await fixture.whenStable();
    fixture.detectChanges();

    expect(confirmation.hasAttribute("open")).toBe(true);
    expect(actions.deleteArchivedItemWithOutcome).not.toHaveBeenCalled();

    confirmation.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(actions.deleteArchivedItemWithOutcome).toHaveBeenCalledWith(archivedItem, expect.any(Function));
    expect(store.snapshot().deletedItems.map((item) => item.id)).toEqual(["archived-1"]);
    expect(store.snapshot().archivedItems).toEqual([]);
    expect(store.snapshot().statusMessage).toBe("Moved item to trash");
  });

  it("renders deleted synced items in an official-style Trash list", async () => {
    const store = new PopupStateStore();
    store.setDeletedItems([{ ...demoVaultItems[0], id: "deleted-1", name: "Deleted login" }]);

    await TestBed.configureTestingModule({
      imports: [TrashPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TrashPageComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector("popup-header > header h1")?.textContent).toContain("回收站");
    expect(host.textContent).toContain("回收站中的项目");
    expect(host.textContent).toContain("Deleted login");
    expect(host.textContent).toContain("回收站中超过 30 天的项目将被自动删除");
    expect(host.querySelector("bw-macos-alert-strip .macos-alert-strip")).not.toBeNull();
    expect(host.querySelector("bit-section")).not.toBeNull();
    expect(host.querySelector("bit-section-header")).not.toBeNull();
    expect(host.querySelector("bit-item-group")).not.toBeNull();
    expect(host.querySelector("bit-item button[bit-item-content]")).not.toBeNull();
    expect(host.querySelector("[aria-label='回收站选项 Deleted login']")).not.toBeNull();
    expect(host.querySelector("[aria-label='弹出到新窗口']")).not.toBeNull();
    expect(host.querySelector("bw-vault-status-list")).toBeNull();
    expect(host.querySelector(".trash-warning")).toBeNull();
  });

  it("opens archive and trash actions through the pinned overflow menus", async () => {
    const store = new PopupStateStore();
    store.setArchivedItems([{ ...demoVaultItems[0], id: "archived-menu", name: "Archived login" }]);
    store.setDeletedItems([{ ...demoVaultItems[1], id: "deleted-menu", name: "Deleted card" }]);
    await TestBed.configureTestingModule({
      imports: [ArchivePageComponent, TrashPageComponent],
      providers: [provideRouter([]), { provide: PopupStateStore, useValue: store }],
    }).compileComponents();

    const archive = TestBed.createComponent(ArchivePageComponent);
    archive.detectChanges();
    const archiveHost = archive.nativeElement as HTMLElement;
    archiveHost.querySelector<HTMLButtonElement>("[aria-label='归档选项 Archived login']")!.click();
    archive.detectChanges();
    expect(menuLabels()).toEqual(["编辑", "克隆", "取消归档", "删除"]);
    archive.destroy();

    const trash = TestBed.createComponent(TrashPageComponent);
    trash.detectChanges();
    const trashHost = trash.nativeElement as HTMLElement;
    trashHost.querySelector<HTMLButtonElement>("[aria-label='回收站选项 Deleted card']")!.click();
    trash.detectChanges();
    expect(menuLabels()).toEqual(["恢复", "永久删除"]);
  });

  it("restores and permanently deletes trashed items from the Trash page", async () => {
    const store = new PopupStateStore();
    const deletedItem = { ...demoVaultItems[0], id: "deleted-1", name: "Deleted login" };
    const discardItem = { ...demoVaultItems[1], id: "deleted-2", name: "Discard login" };
    unlock(store);
    store.setDeletedItems([deletedItem, discardItem]);
    const actions = {
      restoreDeletedItemWithOutcome: vi.fn(async () => {
        store.restoreDeletedVaultItem(deletedItem.id);
        return committed(deletedItem, "Item restored");
      }),
      permanentlyDeleteItemWithOutcome: vi.fn(async () => {
        store.permanentlyDeleteVaultItem(discardItem.id);
        return committed(discardItem, "Item permanently deleted");
      }),
    };

    await TestBed.configureTestingModule({
      imports: [TrashPageComponent],
      providers: [
        provideRouter([]),
        { provide: Router, useValue: routeRouter("/trash") },
        { provide: PopupStateStore, useValue: store },
        { provide: VaultActionsService, useValue: actions },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TrashPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLButtonElement>("[aria-label='回收站选项 Deleted login']")!.click();
    clickMenuAction("恢复");
    await fixture.whenStable();
    fixture.detectChanges();

    expect(actions.restoreDeletedItemWithOutcome).toHaveBeenCalledWith(deletedItem, expect.any(Function));
    expect(store.snapshot().items.map((item) => item.id)).toEqual(["deleted-1"]);
    expect(store.snapshot().deletedItems.map((item) => item.id)).toEqual(["deleted-2"]);
    expect(store.snapshot().statusMessage).toBe("Item restored");

    host.querySelector<HTMLButtonElement>("[aria-label='回收站选项 Discard login']")!.click();
    clickMenuAction("永久删除");
    await fixture.whenStable();
    fixture.detectChanges();

    const confirmation = host.querySelector<HTMLDialogElement>(
      '[data-testid="permanent-delete-confirmation"]',
    )!;
    confirmation.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(actions.permanentlyDeleteItemWithOutcome).toHaveBeenCalledWith(discardItem, expect.any(Function));
    expect(store.snapshot().deletedItems).toEqual([]);
    expect(store.snapshot().statusMessage).toBe("Item permanently deleted");
  });

  it("keeps a failed permanent-delete Sheet open and permits retry", async () => {
    const store = new PopupStateStore();
    const item = { ...demoVaultItems[0], id: "deleted-retry", name: "Retry login" };
    unlock(store);
    store.setDeletedItems([item]);
    const actions = {
      permanentlyDeleteItemWithOutcome: vi.fn()
        .mockResolvedValueOnce({ committed: false, reason: "failure", status: "无法永久删除项目，请重试。" })
        .mockResolvedValueOnce(committed(item, "Item permanently deleted")),
    };
    await TestBed.configureTestingModule({
      imports: [TrashPageComponent],
      providers: [provideRouter([]), { provide: Router, useValue: routeRouter("/trash") },
        { provide: PopupStateStore, useValue: store },
        { provide: VaultActionsService, useValue: actions }],
    }).compileComponents();
    const fixture = TestBed.createComponent(TrashPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLButtonElement>("[aria-label='回收站选项 Retry login']")!.click();
    clickMenuAction("永久删除");
    await fixture.whenStable();
    fixture.detectChanges();
    const sheet = host.querySelector<HTMLDialogElement>("[data-testid='permanent-delete-confirmation']")!;
    const submit = sheet.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    const cancel = sheet.querySelector<HTMLButtonElement>("[data-testid='permanent-delete-cancel']")!;
    expect(document.activeElement).toBe(cancel);
    submit.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(sheet.open).toBe(true);
    expect(sheet.closest("bw-app-bottom-sheet")?.getAttribute("aria-busy")).toBe("false");
    expect(sheet.querySelectorAll("[role='alert']")).toHaveLength(1);
    expect(sheet.textContent).toContain("无法永久删除项目，请重试。");
    submit.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(sheet.open).toBe(false);
    expect(actions.permanentlyDeleteItemWithOutcome).toHaveBeenCalledTimes(2);
  });

  it("closes an English Archive confirmation silently for a stale typed outcome", async () => {
    const i18n = new OfficialI18nService();
    await i18n.setLocale("en-US");
    const store = new PopupStateStore();
    const item = { ...demoVaultItems[0], id: "archive-stale-en", name: "Stale archive" };
    unlock(store);
    store.setArchivedItems([item]);
    const actions = {
      deleteArchivedItemWithOutcome: vi.fn(async () => ({
        committed: false as const,
        reason: "stale" as const,
        status: i18n.t("i18nVaultChangedActionNotApplied"),
      })),
    };
    await TestBed.configureTestingModule({
      imports: [ArchivePageComponent],
      providers: [provideRouter([]), { provide: Router, useValue: routeRouter("/archive") },
        { provide: OfficialI18nService, useValue: i18n },
        { provide: I18nService, useValue: i18n },
        { provide: PopupStateStore, useValue: store },
        { provide: VaultActionsService, useValue: actions }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ArchivePageComponent);
    fixture.detectChanges();
    const sheet = (fixture.nativeElement as HTMLElement).querySelector<HTMLDialogElement>(
      "[data-testid='archive-delete-confirmation']",
    )!;
    Object.defineProperty(sheet, "showModal", {
      configurable: true,
      value: vi.fn(() => sheet.setAttribute("open", "")),
    });

    await fixture.componentInstance.requestDelete(item.id);
    fixture.detectChanges();
    sheet.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(actions.deleteArchivedItemWithOutcome).toHaveBeenCalledOnce();
    expect(sheet.open).toBe(false);
    expect(sheet.querySelector("[role='alert']")).toBeNull();
  });

  it("closes a Chinese Trash confirmation silently for a stale typed outcome", async () => {
    const i18n = new OfficialI18nService();
    await i18n.setLocale("zh-CN");
    const store = new PopupStateStore();
    const item = { ...demoVaultItems[0], id: "trash-stale-zh", name: "Stale trash" };
    unlock(store);
    store.setDeletedItems([item]);
    const actions = {
      permanentlyDeleteItemWithOutcome: vi.fn(async () => ({
        committed: false as const,
        reason: "stale" as const,
        status: i18n.t("i18nVaultChangedActionNotApplied"),
      })),
    };
    await TestBed.configureTestingModule({
      imports: [TrashPageComponent],
      providers: [provideRouter([]), { provide: Router, useValue: routeRouter("/trash") },
        { provide: OfficialI18nService, useValue: i18n },
        { provide: I18nService, useValue: i18n },
        { provide: PopupStateStore, useValue: store },
        { provide: VaultActionsService, useValue: actions }],
    }).compileComponents();
    const fixture = TestBed.createComponent(TrashPageComponent);
    fixture.detectChanges();
    const sheet = (fixture.nativeElement as HTMLElement).querySelector<HTMLDialogElement>(
      "[data-testid='permanent-delete-confirmation']",
    )!;
    Object.defineProperty(sheet, "showModal", {
      configurable: true,
      value: vi.fn(() => sheet.setAttribute("open", "")),
    });

    await fixture.componentInstance.deleteForever(item.id);
    fixture.detectChanges();
    sheet.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(actions.permanentlyDeleteItemWithOutcome).toHaveBeenCalledOnce();
    expect(sheet.open).toBe(false);
    expect(sheet.querySelector("[role='alert']")).toBeNull();
  });

  it("blocks every Sheet dismissal path while a permanent delete is busy and enables retry after failure", async () => {
    const store = new PopupStateStore();
    const item = { ...demoVaultItems[0], id: "deleted-busy", name: "Busy login" };
    const completion = deferred<{
      committed: false;
      reason: "failure";
      status: string;
    }>();
    unlock(store);
    store.setDeletedItems([item]);
    const actions = {
      permanentlyDeleteItemWithOutcome: vi.fn(() => completion.promise),
    };
    await TestBed.configureTestingModule({
      imports: [TrashPageComponent],
      providers: [provideRouter([]), { provide: Router, useValue: routeRouter("/trash") },
        { provide: PopupStateStore, useValue: store },
        { provide: VaultActionsService, useValue: actions }],
    }).compileComponents();
    const fixture = TestBed.createComponent(TrashPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const sheet = host.querySelector<HTMLDialogElement>("[data-testid='permanent-delete-confirmation']")!;
    Object.defineProperty(sheet, "showModal", {
      configurable: true,
      value: vi.fn(() => sheet.setAttribute("open", "")),
    });
    await fixture.componentInstance.deleteForever(item.id);
    fixture.detectChanges();
    const submit = sheet.querySelector<HTMLButtonElement>('button[type="submit"]')!;

    submit.click();
    await vi.waitFor(() => expect(actions.permanentlyDeleteItemWithOutcome).toHaveBeenCalledOnce());
    fixture.detectChanges();
    submit.click();
    sheet.dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true }));
    sheet.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    sheet.querySelector<HTMLButtonElement>("button:has(.bwi-close)")!.click();
    fixture.detectChanges();

    expect(sheet.open).toBe(true);
    expect(actions.permanentlyDeleteItemWithOutcome).toHaveBeenCalledOnce();

    completion.resolve({ committed: false, reason: "failure", status: "Retry permanent delete." });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(sheet.open).toBe(true);
    expect(sheet.closest("bw-app-bottom-sheet")?.getAttribute("aria-busy")).toBe("false");
    expect(sheet.querySelectorAll("[role='alert']")).toHaveLength(1);
    expect(submit.disabled).toBe(false);
    submit.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(actions.permanentlyDeleteItemWithOutcome).toHaveBeenCalledTimes(2);
    const cancel = sheet.querySelector<HTMLButtonElement>("[data-testid='permanent-delete-cancel']")!;
    expect(cancel.disabled).toBe(false);
    cancel.click();
    fixture.detectChanges();
    expect(sheet.open).toBe(false);
  });

  it("ignores a late failed completion after destroying a busy Archive confirmation", async () => {
    const store = new PopupStateStore();
    const item = { ...demoVaultItems[0], id: "archive-destroy", name: "Destroyed archive" };
    const completion = deferred<{
      committed: false;
      reason: "failure";
      status: string;
    }>();
    unlock(store);
    store.setArchivedItems([item]);
    const actions = { deleteArchivedItemWithOutcome: vi.fn(() => completion.promise) };
    await TestBed.configureTestingModule({
      imports: [ArchivePageComponent],
      providers: [provideRouter([]), { provide: Router, useValue: routeRouter("/archive") },
        { provide: PopupStateStore, useValue: store },
        { provide: VaultActionsService, useValue: actions }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ArchivePageComponent);
    fixture.detectChanges();
    const sheet = (fixture.nativeElement as HTMLElement).querySelector<HTMLDialogElement>(
      "[data-testid='archive-delete-confirmation']",
    )!;
    Object.defineProperty(sheet, "showModal", {
      configurable: true,
      value: vi.fn(() => sheet.setAttribute("open", "")),
    });
    await fixture.componentInstance.requestDelete(item.id);
    fixture.detectChanges();
    sheet.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await vi.waitFor(() => expect(actions.deleteArchivedItemWithOutcome).toHaveBeenCalledOnce());

    fixture.destroy();
    completion.resolve({ committed: false, reason: "failure", status: "Late failure" });
    await Promise.resolve();
    await Promise.resolve();

    expect(sheet.open).toBe(false);
    expect(sheet.querySelector("[role='alert']")).toBeNull();
  });

  it("renders official empty states for Archive and Trash", async () => {
    await TestBed.configureTestingModule({
      imports: [ArchivePageComponent, TrashPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: new PopupStateStore() },
      ],
    }).compileComponents();

    const archiveFixture = TestBed.createComponent(ArchivePageComponent);
    archiveFixture.detectChanges();
    expect((archiveFixture.nativeElement as HTMLElement).textContent).toContain("归档中没有项目");
    expect((archiveFixture.nativeElement as HTMLElement).querySelector("bw-official-archive")?.classList)
      .toContain("macos-page--vault-recovery");

    const trashFixture = TestBed.createComponent(TrashPageComponent);
    trashFixture.detectChanges();
    expect((trashFixture.nativeElement as HTMLElement).textContent).toContain("回收站中没有项目");
    expect((trashFixture.nativeElement as HTMLElement).querySelector("bw-official-trash")?.classList)
      .toContain("macos-page--vault-recovery");
  });
});

function menuLabels(): string[] {
  const panes = Array.from(document.body.querySelectorAll<HTMLElement>(".cdk-overlay-pane"));
  const activePane = panes.at(-1);
  return Array.from(activePane?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? [])
    .map((item) => item.textContent?.trim() ?? "");
}

function clickMenuAction(label: string): void {
  const panes = Array.from(document.body.querySelectorAll<HTMLElement>(".cdk-overlay-pane"));
  const activePane = panes.at(-1);
  const action = Array.from(activePane?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? [])
    .find((button) => button.textContent?.trim() === label);
  expect(action, `Expected the open menu to contain ${label}`).toBeDefined();
  action!.click();
}

function unlock(store: PopupStateStore): void {
  store.setUnlocked("person@example.test");
  store.setActiveSession({} as never);
}

function routeRouter(url: string) {
  return {
    url,
    events: NEVER,
    navigate: vi.fn(async () => true),
    navigateByUrl: vi.fn(async () => true),
  };
}

function committed(item: (typeof demoVaultItems)[number], status: string) {
  return { committed: true as const, status, result: { kind: "removed" as const, item } };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
