import "zone.js";
import "@angular/compiler";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { Router, provideRouter } from "@angular/router";
import { describe, expect, it, vi } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { POP_OUT_HOST, type PopOutHost } from "../popup-header-actions.component";
import { PopupStateStore } from "../popup-state";
import { demoFolders, demoVaultItems } from "../vault-demo";
import { FoldersPageComponent } from "./folders-page.component";
import { PopupRouterCacheService } from "../platform/popup-router-cache.service";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("FoldersPageComponent", () => {
  it("renders synced folders with the pinned official item hierarchy", async () => {
    const store = new PopupStateStore();
    store.setItems(demoVaultItems, demoFolders);
    const fixture = await setup(store);
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector("bw-official-folders")).not.toBeNull();
    expect(host.querySelector("popup-header > header h1")?.textContent).toContain("文件夹");
    expect(host.querySelector("[data-testid='new-folder-button']")?.textContent).toContain("新增");
    expect(host.querySelector("bit-item-group")).not.toBeNull();
    expect(host.querySelectorAll("bit-item")).toHaveLength(2);
    expect(host.textContent).toContain("Work");
    expect(host.textContent).toContain("Personal");
    expect(host.textContent).not.toContain("个项目");
    expect(host.querySelector('[aria-label="编辑文件夹 Work"]')).not.toBeNull();
    expect(host.querySelector(".detail-card.folder-edit-card")).toBeNull();
    expect(host.querySelector("bw-official-folders")?.classList).toContain("macos-page");
    expect(host.querySelector("bw-official-folders")?.classList).toContain("macos-page--vault-recovery");
  });

  it("opens the source-aligned add and edit dialog from page actions", async () => {
    const store = new PopupStateStore();
    store.setItems(demoVaultItems, demoFolders);
    const fixture = await setup(store);
    const host = fixture.nativeElement as HTMLElement;

    host.querySelector<HTMLButtonElement>("[data-testid='new-folder-button']")!.click();
    fixture.detectChanges();

    expect(host.querySelector("bw-vault-folder-dialog .app-bottom-sheet[open]")).not.toBeNull();
    expect(host.querySelector("bw-official-add-edit-folder-dialog form[bit-dialog]")).not.toBeNull();
    expect(host.textContent).toContain("新增文件夹");
    expect(host.querySelector<HTMLInputElement>("#folderName")).not.toBeNull();

    host.querySelector<HTMLButtonElement>("[data-testid='edit-folder-work']")!.click();
    fixture.detectChanges();

    expect(host.textContent).toContain("编辑文件夹");
    expect(host.querySelector<HTMLInputElement>("#folderName")?.value).toBe("Work");
    expect(host.querySelector<HTMLButtonElement>("[aria-label='删除文件夹']")).not.toBeNull();
  });

  it("reacts to committed folder changes without a manual change-detection trigger", async () => {
    const store = new PopupStateStore();
    store.setItems(demoVaultItems, demoFolders);
    const fixture = await setup(store);
    const host = fixture.nativeElement as HTMLElement;

    store.saveFolder({ id: "work", name: "Engineering" });
    await fixture.whenStable();

    expect(host.textContent).toContain("Engineering");
    expect(host.textContent).not.toContain("Work");
  });

  it("renders the official no-folders empty state", async () => {
    const fixture = await setup(new PopupStateStore());
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector("bit-no-items")).not.toBeNull();
    expect(host.textContent).toContain("没有文件夹");
    expect(host.textContent).toContain("创建文件夹以整理密码库项目");
    expect(host.querySelector("[data-testid='empty-new-folder-button']")).not.toBeNull();
  });

  it("delegates the pinned pop-out header action to the Tauri host adapter", async () => {
    const popOutHost: PopOutHost = { popOut: vi.fn(async () => undefined) };
    const fixture = await setup(new PopupStateStore(), popOutHost);
    const button = (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>("[aria-label='弹出到新窗口']");

    expect(button).not.toBeNull();
    button!.click();
    await fixture.whenStable();

    expect(popOutHost.popOut).toHaveBeenCalledWith("/");
  });

  it("keeps the folder header back action in the popup navigation owner", async () => {
    const fixture = await setup(new PopupStateStore());
    const back = vi.spyOn(TestBed.inject(PopupRouterCacheService), "back").mockResolvedValue(true);
    const backButton = (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>("[aria-label='返回']");

    expect(backButton).not.toBeNull();
    backButton!.click();
    await fixture.whenStable();

    expect(back).toHaveBeenCalledOnce();
  });
});

async function setup(store: PopupStateStore, popOutHost?: PopOutHost) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [FoldersPageComponent],
    providers: [
      provideRouter([]),
      { provide: PopupStateStore, useValue: store },
      OfficialI18nService,
      { provide: I18nService, useExisting: OfficialI18nService },
      ...(popOutHost ? [{ provide: POP_OUT_HOST, useValue: popOutHost }] : []),
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(FoldersPageComponent);
  fixture.detectChanges();
  return fixture;
}
