import "zone.js";
import "@angular/compiler";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { By } from "@angular/platform-browser";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it, vi } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import type { AuthSession } from "../../auth/auth-session-store";
import { buildBitwardenEnvironment } from "../../bitwarden-api/bitwarden-api";
import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { PopupStateStore } from "../popup-state";
import { OfficialAddEditFolderDialogComponent } from "../upstream-overlays/recovery/folders/official-add-edit-folder-dialog.component";
import { VaultFolderDialogComponent } from "./vault-folder-dialog.component";
import { VaultFolderService } from "./vault-folder.service";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("VaultFolderDialogComponent", () => {
  it("closes the native host when the official dialog close button is used", async () => {
    const store = new PopupStateStore();
    const fixture = await setup(store, { create: vi.fn(), update: vi.fn(), delete: vi.fn() });
    const host = fixture.nativeElement as HTMLElement;
    fixture.componentInstance.openFor();
    fixture.detectChanges(false);

    const closeButton = host.querySelector<HTMLButtonElement>("dialog .bwi-close")?.closest("button");
    expect(closeButton).not.toBeNull();
    closeButton!.click();
    fixture.detectChanges(false);

    expect(host.querySelector("dialog[open]")).toBeNull();
    expect(fixture.componentInstance.isOpen).toBe(false);
  });

  it("does not use a local folder mutation fallback when no active session exists", async () => {
    const store = new PopupStateStore();
    store.saveFolder({ id: "work", name: "Work" });
    const folderService = {
      create: vi.fn(async () => ({
        committed: false as const,
        reason: "failure" as const,
        status: "无法保存文件夹，请重试。",
      })),
      update: vi.fn(),
      delete: vi.fn(),
    };
    const fixture = await setup(store, folderService);

    fixture.componentInstance.openFor();
    fixture.componentInstance.folderName = "Finance";
    await fixture.componentInstance.save();

    expect(folderService.create).toHaveBeenCalledWith(null, "Finance", ownershipGuardMatcher());
    expect(store.snapshot().folders).toEqual([{ id: "work", name: "Work" }]);
    expect(fixture.componentInstance.errorMessage()).toBe("无法保存文件夹，请重试。");
  });

  it("emits the current server-created folder result", async () => {
    const store = unlockedStore();
    const folderService = {
      create: vi.fn(async () => ({
        committed: true as const,
        folder: { id: "server-projects", name: "Projects" },
        status: "",
      })),
      update: vi.fn(),
      delete: vi.fn(),
    };
    const fixture = await setup(store, folderService);
    const created: Array<{ id: string; name: string }> = [];
    fixture.componentInstance.folderCreated.subscribe((folder) => created.push(folder));

    fixture.componentInstance.openFor();
    fixture.componentInstance.folderName = "Projects";
    await fixture.componentInstance.save();

    expect(created).toEqual([{ id: "server-projects", name: "Projects" }]);
  });

  it("keeps the official dialog open when a server save fails", async () => {
    const store = unlockedStore();
    const folderService = {
      create: vi.fn(async () => ({
        committed: false as const,
        reason: "failure" as const,
        status: "无法保存文件夹，请重试。",
      })),
      update: vi.fn(),
      delete: vi.fn(),
    };
    const fixture = await setup(store, folderService);
    fixture.componentInstance.openFor();
    fixture.detectChanges(false);

    fixture.componentInstance.folderName = "Finance";
    await fixture.componentInstance.save();
    await fixture.whenStable();
    fixture.detectChanges(false);
    await Promise.resolve();
    fixture.detectChanges(false);

    const host = fixture.nativeElement as HTMLElement;
    expect(folderService.create).toHaveBeenCalledWith(
      store.snapshot().activeSession,
      "Finance",
      ownershipGuardMatcher(),
    );
    expect(host.querySelector("dialog[open]")).not.toBeNull();
    expect(fixture.componentInstance.errorMessage()).toBe("无法保存文件夹，请重试。");
    expect(host.querySelector("[role='alert']")?.textContent).toContain("无法保存文件夹");
    expect(host.textContent).not.toContain("private server body");
  });

  it("requires confirmation before deleting an existing folder", async () => {
    const store = unlockedStore();
    store.saveFolder({ id: "work", name: "Work" });
    const folderService = {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(async () => ({ committed: true as const, status: "" })),
    };
    const fixture = await setup(store, folderService);
    const host = fixture.nativeElement as HTMLElement;
    fixture.componentInstance.openFor({ id: "work", name: "Work" });
    fixture.detectChanges(false);

    fixture.componentInstance.requestDelete();
    fixture.detectChanges(false);

    expect(folderService.delete).not.toHaveBeenCalled();
    expect(host.querySelector("[data-testid='delete-folder-confirmation'][open]")).not.toBeNull();
    expect(host.textContent).toContain("永久删除文件夹？");

    await fixture.componentInstance.confirmDelete();
    fixture.detectChanges(false);

    expect(folderService.delete).toHaveBeenCalledWith(
      store.snapshot().activeSession,
      "work",
      ownershipGuardMatcher(),
    );
    expect(host.querySelector("dialog[open]")).toBeNull();
  });

  it("returns focus to the delete action when an edit deletion is cancelled with Escape", async () => {
    const store = unlockedStore();
    const folder = store.saveFolder({ id: "work", name: "Work" });
    const fixture = await setup(store, { create: vi.fn(), update: vi.fn(), delete: vi.fn() });
    const host = fixture.nativeElement as HTMLElement;
    fixture.componentInstance.openFor(folder);
    fixture.detectChanges(false);
    await Promise.resolve();

    const deleteFolder = Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.getAttribute("aria-label") === "删除文件夹");
    expect(deleteFolder).toBeDefined();
    deleteFolder!.focus();
    deleteFolder!.click();
    fixture.detectChanges(false);

    const confirmation = host.querySelector<HTMLDialogElement>("[data-testid='delete-folder-confirmation']");
    expect(confirmation?.open).toBe(true);
    confirmation!.dispatchEvent(new Event("cancel", { cancelable: true }));
    await Promise.resolve();
    fixture.detectChanges(false);
    await Promise.resolve();

    expect(host.querySelector<HTMLDialogElement>("[data-testid='folder-dialog']")?.open).toBe(true);
    expect(document.activeElement).toBe(deleteFolder);
  });

  it("focuses Cancel in delete confirmation and returns to the invoking Delete button", async () => {
    const store = unlockedStore();
    const folder = store.saveFolder({ id: "work", name: "Work" });
    const fixture = await setup(store, { create: vi.fn(), update: vi.fn(), delete: vi.fn() });
    const host = fixture.nativeElement as HTMLElement;
    const opener = document.createElement("button");
    document.body.append(opener);
    fixture.componentInstance.openFor(folder, opener);
    fixture.detectChanges(false);
    await Promise.resolve();

    const deleteButton = Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.getAttribute("aria-label") === "删除文件夹")!;
    deleteButton.focus();
    deleteButton.click();
    fixture.detectChanges(false);
    await Promise.resolve();

    const cancel = host.querySelector<HTMLButtonElement>("[data-testid='delete-folder-cancel']")!;
    expect(document.activeElement).toBe(cancel);
    cancel.click();
    fixture.detectChanges(false);
    await Promise.resolve();
    expect(document.activeElement).toBe(deleteButton);
    opener.remove();
  });

  it.each([
    {
      timing: "before the edit Sheet close settles",
      settleEditBeforeDeleteDismissal: false,
      deleteDismissal: "cancel" as const,
      editDismissal: "escape" as const,
    },
    {
      timing: "after the edit Sheet close settles",
      settleEditBeforeDeleteDismissal: true,
      deleteDismissal: "escape" as const,
      editDismissal: "cancel" as const,
    },
  ])("preserves the outer opener across the nested delete focus stack $timing", async ({
    settleEditBeforeDeleteDismissal,
    deleteDismissal,
    editDismissal,
  }) => {
    const store = unlockedStore();
    const folder = store.saveFolder({ id: "work", name: "Work" });
    const fixture = await setup(store, { create: vi.fn(), update: vi.fn(), delete: vi.fn() });
    const host = fixture.nativeElement as HTMLElement;
    const opener = document.createElement("button");
    const nextOpener = document.createElement("button");
    document.body.append(opener, nextOpener);
    const nativeGetComputedStyle = window.getComputedStyle.bind(window);
    const transitionStyles = vi.spyOn(window, "getComputedStyle").mockImplementation((element) =>
      element instanceof HTMLDialogElement
        ? {
            transitionProperty: "transform",
            transitionDuration: "200ms",
            transitionDelay: "0s",
          } as CSSStyleDeclaration
        : nativeGetComputedStyle(element));

    try {
      opener.focus();
      fixture.componentInstance.openFor(folder, opener);
      fixture.detectChanges(false);
      await Promise.resolve();

      const folderSheet = host.querySelector<HTMLDialogElement>("[data-testid='folder-dialog']")!;
      const deleteSheet = host.querySelector<HTMLDialogElement>("[data-testid='delete-folder-confirmation']")!;
      const deleteButton = Array.from(folderSheet.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.getAttribute("aria-label") === "删除文件夹")!;
      deleteButton.focus();
      deleteButton.click();
      fixture.detectChanges(false);
      await Promise.resolve();

      const deleteCancel = deleteSheet.querySelector<HTMLButtonElement>(
        "[data-testid='delete-folder-cancel']",
      )!;
      expect(document.activeElement).toBe(deleteCancel);
      if (settleEditBeforeDeleteDismissal) {
        dispatchTransformTransitionEnd(folderSheet);
      }

      if (deleteDismissal === "escape") {
        deleteSheet.dispatchEvent(new Event("cancel", { cancelable: true }));
      } else {
        deleteCancel.click();
      }
      fixture.detectChanges(false);
      await Promise.resolve();
      if (deleteSheet.open) {
        dispatchTransformTransitionEnd(deleteSheet);
      }
      await Promise.resolve();

      expect(folderSheet.open).toBe(true);
      expect(document.activeElement).toBe(deleteButton);
      if (editDismissal === "escape") {
        folderSheet.dispatchEvent(new Event("cancel", { cancelable: true }));
      } else {
        const editCancel = Array.from(folderSheet.querySelectorAll<HTMLButtonElement>("button"))
          .find((button) => button.textContent?.trim() === "取消")!;
        editCancel.click();
      }
      fixture.detectChanges(false);
      if (folderSheet.open) {
        dispatchTransformTransitionEnd(folderSheet);
      }
      await Promise.resolve();

      expect(document.activeElement).toBe(opener);

      nextOpener.focus();
      fixture.componentInstance.openFor(folder, nextOpener);
      fixture.detectChanges(false);
      await Promise.resolve();
      fixture.componentInstance.close();
      if (folderSheet.open) {
        dispatchTransformTransitionEnd(folderSheet);
      }
      await Promise.resolve();
      expect(document.activeElement).toBe(nextOpener);
    } finally {
      transitionStyles.mockRestore();
      opener.remove();
      nextOpener.remove();
    }
  });

  it.each(["save", "delete"] as const)(
    "restores the outer opener after a successful terminal %s",
    async (operation) => {
      const store = unlockedStore();
      const folder = operation === "delete"
        ? store.saveFolder({ id: "work", name: "Work" })
        : undefined;
      const folderService = {
        create: vi.fn(async () => ({
          committed: true as const,
          folder: { id: "server-projects", name: "Projects" },
          status: "",
        })),
        update: vi.fn(),
        delete: vi.fn(async () => ({ committed: true as const, status: "" })),
      };
      const fixture = await setup(store, folderService);
      const host = fixture.nativeElement as HTMLElement;
      const opener = document.createElement("button");
      document.body.append(opener);

      try {
        opener.focus();
        fixture.componentInstance.openFor(folder, opener);
        fixture.detectChanges(false);
        await Promise.resolve();

        if (operation === "save") {
          fixture.componentInstance.folderName = "Projects";
          await fixture.componentInstance.save();
        } else {
          const deleteButton = Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
            .find((button) => button.getAttribute("aria-label") === "删除文件夹")!;
          deleteButton.focus();
          deleteButton.click();
          fixture.detectChanges(false);
          await Promise.resolve();
          host.querySelector<HTMLFormElement>("[data-testid='delete-folder-confirmation'] form")!
            .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
          await fixture.whenStable();
        }
        fixture.detectChanges(false);
        await nextTask();

        expect(document.activeElement).toBe(opener);
      } finally {
        opener.remove();
      }
    },
  );

  it("returns to the edit dialog with a fixed error when deletion fails", async () => {
    const store = unlockedStore();
    store.saveFolder({ id: "work", name: "Work" });
    const folderService = {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(async () => ({
        committed: false as const,
        reason: "failure" as const,
        status: "无法删除文件夹，请重试。",
      })),
    };
    const fixture = await setup(store, folderService);
    const host = fixture.nativeElement as HTMLElement;
    fixture.componentInstance.openFor({ id: "work", name: "Work" });
    fixture.componentInstance.requestDelete();

    await fixture.componentInstance.confirmDelete();
    await fixture.whenStable();
    fixture.detectChanges(false);

    expect(host.querySelector("[data-testid='delete-folder-confirmation'][open]")).toBeNull();
    expect(host.querySelector("dialog[open]")).not.toBeNull();
    expect(host.querySelector("[role='alert']")?.textContent).toContain("无法删除文件夹");
    expect(host.textContent).not.toContain("private delete response");
    expect(store.snapshot().folders).toEqual([{ id: "work", name: "Work" }]);
  });

  it("does not mutate another account when a server completion becomes stale", async () => {
    const store = unlockedStore();
    const completion = deferred<void>();
    const folderService = {
      create: vi.fn(async () => {
        await completion.promise;
        return { committed: true as const, folder: { id: "server-folder", name: "Finance" }, status: "" };
      }),
      update: vi.fn(),
      delete: vi.fn(),
    };
    const fixture = await setup(store, folderService);
    const created: Array<{ id: string; name: string }> = [];
    fixture.componentInstance.folderCreated.subscribe((folder) => created.push(folder));
    fixture.componentInstance.openFor();
    fixture.componentInstance.folderName = "Finance";
    const save = fixture.componentInstance.save();

    store.setActiveSession(session("other-token"));
    completion.resolve();
    await save;
    fixture.detectChanges(false);

    expect(store.snapshot().folders).toEqual([]);
    expect(fixture.componentInstance.isOpen).toBe(false);
    expect(created).toEqual([]);
  });

  it("does not commit a pending create after the folder route is destroyed", async () => {
    const store = unlockedStore();
    const completion = deferred<{ committed: true; folder: { id: string; name: string }; status: string }>();
    const folderService = {
      create: vi.fn(() => completion.promise),
      update: vi.fn(),
      delete: vi.fn(),
    };
    const fixture = await setup(store, folderService);
    fixture.componentInstance.openFor();
    fixture.componentInstance.folderName = "Finance";
    const save = fixture.componentInstance.save();
    const ownership = folderService.create.mock.calls[0][2] as { isCurrent(): boolean };

    fixture.destroy();
    expect(ownership.isCurrent()).toBe(false);
    completion.resolve({ committed: true, folder: { id: "server-finance", name: "Finance" }, status: "" });
    await save;

    expect(store.snapshot().folders).toEqual([]);
  });

  it("does not commit a pending update after the folder route is destroyed", async () => {
    const store = unlockedStore();
    const source = store.saveFolder({ id: "work", name: "Work" });
    const completion = deferred<{ committed: true; folder: { id: string; name: string }; status: string }>();
    const folderService = {
      create: vi.fn(),
      update: vi.fn(() => completion.promise),
      delete: vi.fn(),
    };
    const fixture = await setup(store, folderService);
    fixture.componentInstance.openFor(source);
    fixture.componentInstance.folderName = "Engineering";
    const save = fixture.componentInstance.save();
    const ownership = folderService.update.mock.calls[0][3] as { isCurrent(): boolean };

    fixture.destroy();
    expect(ownership.isCurrent()).toBe(false);
    completion.resolve({ committed: true, folder: { id: "work", name: "Engineering" }, status: "" });
    await save;

    expect(store.snapshot().folders).toEqual([{ id: "work", name: "Work" }]);
  });

  it("does not commit a pending delete after the folder route is destroyed", async () => {
    const store = unlockedStore();
    const source = store.saveFolder({ id: "work", name: "Work" });
    const completion = deferred<{ committed: true; status: string }>();
    const folderService = {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(() => completion.promise),
    };
    const fixture = await setup(store, folderService);
    fixture.componentInstance.openFor(source);
    fixture.componentInstance.requestDelete();
    const deletion = fixture.componentInstance.confirmDelete();
    const ownership = folderService.delete.mock.calls[0][2] as { isCurrent(): boolean };

    fixture.destroy();
    expect(ownership.isCurrent()).toBe(false);
    completion.resolve({ committed: true, status: "" });
    await deletion;

    expect(store.snapshot().folders).toEqual([{ id: "work", name: "Work" }]);
  });

  it("returns a duplicate outcome without starting a second create request", async () => {
    const store = unlockedStore();
    const completion = deferred<{ committed: true; folder: { id: string; name: string }; status: string }>();
    const folderService = {
      create: vi.fn(() => completion.promise),
      update: vi.fn(),
      delete: vi.fn(),
    };
    const fixture = await setup(store, folderService);
    fixture.componentInstance.openFor();
    fixture.componentInstance.folderName = "Finance";
    const first = fixture.componentInstance.save();

    await expect(fixture.componentInstance.save()).resolves.toEqual({
      committed: false,
      reason: "duplicate",
      status: "",
    });
    expect(folderService.create).toHaveBeenCalledTimes(1);

    completion.resolve({ committed: true, folder: { id: "server-finance", name: "Finance" }, status: "" });
    await first;
  });

  it("returns a typed duplicate outcome from the production submit path", async () => {
    const store = unlockedStore();
    const completion = deferred<{ committed: true; folder: { id: string; name: string }; status: string }>();
    const folderService = {
      create: vi.fn(() => completion.promise),
      update: vi.fn(),
      delete: vi.fn(),
    };
    const fixture = await setup(store, folderService);
    fixture.componentInstance.openFor();
    const submission = { mode: "add" as const, folderId: "", name: "Finance" };

    const first = fixture.componentInstance.submit(submission);
    const duplicate = fixture.componentInstance.submit(submission);

    await expect(duplicate).resolves.toEqual({
      committed: false,
      reason: "duplicate",
      status: "",
    });
    expect(folderService.create).toHaveBeenCalledTimes(1);

    completion.resolve({ committed: true, folder: { id: "server-finance", name: "Finance" }, status: "" });
    await first;
  });

  it("keeps a typed folder name through parent change detection", async () => {
    const store = unlockedStore();
    const source = store.saveFolder({ id: "work", name: "Work" });
    const fixture = await setup(store, { create: vi.fn(), update: vi.fn(), delete: vi.fn() });
    const host = fixture.nativeElement as HTMLElement;
    fixture.componentInstance.openFor(source);
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges(false);
    const projectedFolder = fixture.componentInstance.officialFolder;
    const officialDialog = fixture.debugElement.query(By.directive(OfficialAddEditFolderDialogComponent))
      .componentInstance as OfficialAddEditFolderDialogComponent;
    const input = host.querySelector<HTMLInputElement>("#folderName")!;
    expect(fixture.componentInstance.editingFolderId).toBe("work");
    expect(officialDialog.mode).toBe("edit");
    expect(officialDialog.folder).toBe(projectedFolder);

    input.value = "Engineering";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(officialDialog.name).toBe("Engineering");
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges(false);

    expect(fixture.componentInstance.officialFolder).toBe(projectedFolder);
    expect(officialDialog.folder).toBe(projectedFolder);
    expect(officialDialog.name).toBe("Engineering");
    expect(host.querySelector<HTMLInputElement>("#folderName")?.value).toBe("Engineering");
  });

  it("initializes the retained edit form before a fast user can type into the opened dialog", async () => {
    const store = unlockedStore();
    const source = store.saveFolder({ id: "work", name: "Work" });
    const fixture = await setup(store, { create: vi.fn(), update: vi.fn(), delete: vi.fn() });
    const host = fixture.nativeElement as HTMLElement;

    fixture.componentInstance.openFor(source);
    const input = host.querySelector<HTMLInputElement>("#folderName")!;
    input.value = "Engineering";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    fixture.detectChanges(false);

    expect(input.value).toBe("Engineering");
  });

  it("allows a current failure to retry and commit the exact server folder", async () => {
    const store = unlockedStore();
    const folderService = {
      create: vi.fn()
        .mockResolvedValueOnce({
          committed: false as const,
          reason: "failure" as const,
          status: "无法保存文件夹，请重试。",
        })
        .mockResolvedValueOnce({
          committed: true as const,
          folder: { id: "server-finance", name: "Finance" },
          status: "",
        }),
      update: vi.fn(),
      delete: vi.fn(),
    };
    const fixture = await setup(store, folderService);
    fixture.componentInstance.openFor();
    fixture.componentInstance.folderName = "Finance";

    await fixture.componentInstance.save();
    expect(fixture.componentInstance.isOpen).toBe(true);
    expect(fixture.componentInstance.errorMessage()).toBe("无法保存文件夹，请重试。");

    await fixture.componentInstance.save();

    expect(folderService.create).toHaveBeenCalledTimes(2);
    expect(store.snapshot().folders).toEqual([{ id: "server-finance", name: "Finance" }]);
    expect(fixture.componentInstance.isOpen).toBe(false);
  });

  it("cancels delete confirmation without transport or closing the edit dialog", async () => {
    const store = unlockedStore();
    const source = store.saveFolder({ id: "work", name: "Work" });
    const folderService = { create: vi.fn(), update: vi.fn(), delete: vi.fn() };
    const fixture = await setup(store, folderService);
    const host = fixture.nativeElement as HTMLElement;
    fixture.componentInstance.openFor(source);
    fixture.componentInstance.requestDelete();
    fixture.detectChanges(false);
    const cancelEvent = new Event("cancel", { cancelable: true });

    fixture.componentInstance.cancelDelete(cancelEvent);
    fixture.detectChanges(false);

    expect(cancelEvent.defaultPrevented).toBe(true);
    expect(folderService.delete).not.toHaveBeenCalled();
    expect(host.querySelector("[data-testid='delete-folder-confirmation'][open]")).toBeNull();
    expect(host.querySelector("dialog[open]")).not.toBeNull();
    expect(fixture.componentInstance.isOpen).toBe(true);
  });

  it("does not let an old save completion touch a genuinely pending reopened save", async () => {
    const store = unlockedStore();
    const oldCompletion = deferred<{ committed: false; reason: "failure"; status: string }>();
    const newCompletion = deferred<{ committed: true; folder: { id: string; name: string }; status: string }>();
    const folderService = {
      create: vi.fn()
        .mockImplementationOnce(() => oldCompletion.promise)
        .mockImplementationOnce(() => newCompletion.promise),
      update: vi.fn(),
      delete: vi.fn(),
    };
    const fixture = await setup(store, folderService);
    fixture.componentInstance.openFor();
    fixture.componentInstance.folderName = "Old";
    const oldSave = fixture.componentInstance.save();
    const oldOwnership = folderService.create.mock.calls[0][2] as { isCurrent(): boolean };

    fixture.componentInstance.close();
    fixture.componentInstance.openFor();
    fixture.componentInstance.folderName = "Current";
    const newSave = fixture.componentInstance.save();
    const newOwnership = folderService.create.mock.calls[1][2] as { isCurrent(): boolean };
    expect(oldOwnership.isCurrent()).toBe(false);
    expect(newOwnership.isCurrent()).toBe(true);

    oldCompletion.resolve({ committed: false, reason: "failure", status: "old failure" });
    await oldSave;

    expect(fixture.componentInstance.isOpen).toBe(true);
    expect(fixture.componentInstance.isSaving).toBe(true);
    expect(fixture.componentInstance.folderName).toBe("Current");
    expect(fixture.componentInstance.errorMessage()).toBe("");

    newCompletion.resolve({ committed: true, folder: { id: "server-current", name: "Current" }, status: "" });
    await newSave;
    expect(folderService.create).toHaveBeenCalledTimes(2);
    expect(store.snapshot().folders).toEqual([{ id: "server-current", name: "Current" }]);
  });

  it("closes stale delete confirmation when its same-id source is replaced before confirmation", async () => {
    const store = unlockedStore();
    const source = store.saveFolder({ id: "work", name: "Work" });
    const folderService = { create: vi.fn(), update: vi.fn(), delete: vi.fn() };
    const fixture = await setup(store, folderService);
    const host = fixture.nativeElement as HTMLElement;
    fixture.componentInstance.openFor(source);
    fixture.componentInstance.requestDelete();
    store.setItems([], [{ id: "work", name: "Refreshed work" }]);

    await fixture.componentInstance.confirmDelete();
    fixture.detectChanges(false);

    expect(folderService.delete).not.toHaveBeenCalled();
    expect(store.snapshot().folders).toEqual([{ id: "work", name: "Refreshed work" }]);
    expect(host.querySelector("dialog[open]")).toBeNull();
    expect(fixture.componentInstance.isOpen).toBe(false);
  });

  it("closes silently without local deletion when a pending delete source is replaced", async () => {
    const store = unlockedStore();
    const source = store.saveFolder({ id: "work", name: "Work" });
    const completion = deferred<{ committed: true; status: string }>();
    const folderService = {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(() => completion.promise),
    };
    const fixture = await setup(store, folderService);
    const host = fixture.nativeElement as HTMLElement;
    fixture.componentInstance.openFor(source);
    fixture.componentInstance.requestDelete();
    const pendingDelete = fixture.componentInstance.confirmDelete();

    store.setItems([], [{ id: "work", name: "Refreshed work" }]);
    completion.resolve({ committed: true, status: "" });
    await pendingDelete;
    fixture.detectChanges(false);

    expect(folderService.delete).toHaveBeenCalledTimes(1);
    expect(store.snapshot().folders).toEqual([{ id: "work", name: "Refreshed work" }]);
    expect(host.querySelector("dialog[open]")).toBeNull();
    expect(fixture.componentInstance.errorMessage()).toBe("");
    expect(fixture.componentInstance.isOpen).toBe(false);
  });

  it("does not let an old delete completion touch a genuinely pending reopened delete", async () => {
    const store = unlockedStore();
    const first = store.saveFolder({ id: "first", name: "First" });
    const second = store.saveFolder({ id: "second", name: "Second" });
    const oldCompletion = deferred<{ committed: false; reason: "failure"; status: string }>();
    const newCompletion = deferred<{ committed: true; status: string }>();
    const folderService = {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
        .mockImplementationOnce(() => oldCompletion.promise)
        .mockImplementationOnce(() => newCompletion.promise),
    };
    const fixture = await setup(store, folderService);
    fixture.componentInstance.openFor(first);
    fixture.componentInstance.requestDelete();
    const oldDelete = fixture.componentInstance.confirmDelete();

    fixture.componentInstance.close();
    fixture.componentInstance.openFor(second);
    fixture.componentInstance.requestDelete();
    const newDelete = fixture.componentInstance.confirmDelete();
    oldCompletion.resolve({ committed: false, reason: "failure", status: "old delete failure" });
    await oldDelete;

    expect(fixture.componentInstance.isOpen).toBe(true);
    expect(fixture.componentInstance.isSaving).toBe(true);
    expect(fixture.componentInstance.editingFolderId).toBe("second");
    expect(fixture.componentInstance.errorMessage()).toBe("");

    newCompletion.resolve({ committed: true, status: "" });
    await newDelete;

    expect(folderService.delete).toHaveBeenCalledTimes(2);
    expect(store.snapshot().folders).toEqual([{ id: "first", name: "First" }]);
    expect(fixture.componentInstance.isOpen).toBe(false);
  });

  it("does not replace a same-id folder that was refreshed during an edit operation", async () => {
    const store = unlockedStore();
    const source = store.saveFolder({ id: "work", name: "Work" });
    const completion = deferred<{ committed: true; folder: { id: string; name: string }; status: string }>();
    const folderService = {
      create: vi.fn(),
      update: vi.fn(() => completion.promise),
      delete: vi.fn(),
    };
    const fixture = await setup(store, folderService);
    fixture.componentInstance.openFor(source);
    fixture.componentInstance.folderName = "Engineering";
    const save = fixture.componentInstance.save();

    store.setItems([], [{ id: "work", name: "Refreshed work" }]);
    completion.resolve({ committed: true, folder: { id: "work", name: "Engineering" }, status: "" });
    await save;

    expect(store.snapshot().folders).toEqual([{ id: "work", name: "Refreshed work" }]);
    expect(fixture.componentInstance.isOpen).toBe(false);
  });
});

async function setup(
  store: PopupStateStore,
  folderService: Pick<VaultFolderService, "create" | "update" | "delete">,
) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [VaultFolderDialogComponent],
    providers: [
      { provide: PopupStateStore, useValue: store },
      { provide: VaultFolderService, useValue: folderService },
      OfficialI18nService,
      { provide: I18nService, useExisting: OfficialI18nService },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(VaultFolderDialogComponent);
  fixture.detectChanges(false);
  return fixture;
}

function unlockedStore(): PopupStateStore {
  const store = new PopupStateStore();
  store.setActiveSession(session("access-token"));
  store.setUnlocked("user@example.com");
  return store;
}

function session(accessToken: string): AuthSession {
  return {
    environment: buildBitwardenEnvironment(),
    token: {
      accessToken,
      refreshToken: "refresh-token",
      tokenType: "Bearer",
      expiresIn: 3600,
    },
    crypto: {
      userKeyB64: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ==",
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function ownershipGuardMatcher() {
  return expect.objectContaining({ isCurrent: expect.any(Function) });
}

function dispatchTransformTransitionEnd(dialog: HTMLDialogElement): void {
  dialog.dispatchEvent(new TransitionEvent("transitionend", {
    propertyName: "transform",
  }));
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve));
}
