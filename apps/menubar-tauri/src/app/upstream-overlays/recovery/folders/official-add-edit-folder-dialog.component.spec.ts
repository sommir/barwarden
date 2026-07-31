import "zone.js";
import "@angular/compiler";

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { BrowserTestingModule, platformBrowserTesting } from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { FolderView } from "@bitwarden/common/vault/models/view/folder.view";
import { describe, expect, it } from "vitest";

import { OfficialI18nService } from "../../../official-ui/official-i18n.service";
import { OfficialAddEditFolderDialogComponent } from "./official-add-edit-folder-dialog.component";

const runtime = "apps/menubar-tauri/src/app/upstream-overlays/recovery/folders/official-add-edit-folder-dialog.component.ts";
const template = "apps/menubar-tauri/src/app/upstream-overlays/recovery/folders/official-add-edit-folder-dialog.component.html";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("OfficialAddEditFolderDialogComponent", () => {
  it("retains the official form with a fixed-error input and edit-only permanent delete action", () => {
    expect(existsSync(join(process.cwd(), runtime))).toBe(true);
    expect(existsSync(join(process.cwd(), template))).toBe(true);

    const source = readFileSync(join(process.cwd(), runtime), "utf8");
    const html = readFileSync(join(process.cwd(), template), "utf8");
    expect(source).toContain("OfficialFolderDialogSubmit");
    expect(source).toContain("errorMessage");
    expect(source).not.toMatch(/BitwardenApiClient|PopupStateStore|encryptString|TauriHostService/);
    expect(html).toContain('<form bit-dialog id="add-edit-folder"');
    expect(html).toContain("<bit-hint>");
    expect(html).toContain('buttonType="primary"');
    expect(html).toContain('buttonType="secondary"');
    expect(html).toContain('bitIconButton="bwi-trash"');
    expect(html).not.toContain("detail-card");
  });

  it("emits a narrow edit submit and keeps the trash action edit-only", async () => {
    await TestBed.configureTestingModule({
      imports: [OfficialAddEditFolderDialogComponent],
      providers: [OfficialI18nService, { provide: I18nService, useExisting: OfficialI18nService }],
    }).compileComponents();
    const fixture = TestBed.createComponent(OfficialAddEditFolderDialogComponent);
    const submitted: unknown[] = [];
    fixture.componentInstance.submitFolder.subscribe((request) => submitted.push(request));
    fixture.componentRef.setInput("mode", "edit");
    fixture.componentRef.setInput("folder", FolderView.fromJSON(
      { id: "work", name: "Work" } as Parameters<typeof FolderView.fromJSON>[0],
    ));
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const input = host.querySelector<HTMLInputElement>("#folderName")!;
    input.value = "Engineering";
    input.dispatchEvent(new Event("input"));
    host.querySelector<HTMLFormElement>("#add-edit-folder")!.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    expect(submitted).toEqual([{ mode: "edit", folderId: "work", name: "Engineering" }]);
    expect(host.querySelector("[aria-label='删除文件夹']")).not.toBeNull();

    fixture.componentRef.setInput("mode", "add");
    fixture.detectChanges();
    expect(host.querySelector("[aria-label='删除文件夹']")).toBeNull();
  });
});
