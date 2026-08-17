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
import { OfficialFoldersComponent } from "./official-folders.component";

const runtime = "apps/menubar-tauri/src/app/upstream-overlays/recovery/folders/official-folders.component.ts";
const template = "apps/menubar-tauri/src/app/upstream-overlays/recovery/folders/official-folders.component.html";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("OfficialFoldersComponent", () => {
  it("retains the official folders list DOM and exposes only narrow folder actions", () => {
    expect(existsSync(join(process.cwd(), runtime))).toBe(true);
    expect(existsSync(join(process.cwd(), template))).toBe(true);

    const source = readFileSync(join(process.cwd(), runtime), "utf8");
    const html = readFileSync(join(process.cwd(), template), "utf8");
    expect(source).toContain("readonly folders");
    expect(source).toContain("addFolder");
    expect(source).toContain("editFolder");
    expect(html).toContain("<popup-page>");
    expect(html).toContain("<popup-header");
    expect(html).toContain("<bit-item-group>");
    expect(html).toContain("<bit-no-items");
    expect(html).not.toContain("detail-card");
  });

  it("renders the official row and empty-state DOM while emitting the exact selected FolderView", async () => {
    await TestBed.configureTestingModule({
      imports: [OfficialFoldersComponent],
      providers: [OfficialI18nService, { provide: I18nService, useExisting: OfficialI18nService }],
    }).compileComponents();
    const fixture = TestBed.createComponent(OfficialFoldersComponent);
    const folders = [FolderView.fromJSON({ id: "work", name: "Work" } as Parameters<typeof FolderView.fromJSON>[0])];
    const edits: FolderView[] = [];
    let added = 0;
    fixture.componentInstance.editFolder.subscribe((folder) => edits.push(folder));
    fixture.componentInstance.addFolder.subscribe(() => added += 1);
    fixture.componentRef.setInput("folders", folders);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector("[data-testid='new-folder-button']")?.getAttribute("data-popup-focus-key"))
      .toBe("folders:new");
    expect(host.querySelector("[data-testid='edit-folder-work']")?.getAttribute("data-popup-focus-key"))
      .toBe("folder:work");
    expect(host.querySelector("popup-header")).not.toBeNull();
    expect(host.querySelector("bit-item-group bit-item bit-item-content")).not.toBeNull();
    host.querySelector<HTMLButtonElement>("[data-testid='edit-folder-work']")!.click();
    expect(edits).toEqual([folders[0]]);
    expect(edits[0]).toBe(folders[0]);

    fixture.componentRef.setInput("folders", []);
    fixture.detectChanges();
    expect(host.querySelector("[data-testid='empty-new-folder-button']")?.getAttribute("data-popup-focus-key"))
      .toBe("folders:new");
    expect(host.querySelector("bit-no-items")).not.toBeNull();
    host.querySelector<HTMLButtonElement>("[data-testid='empty-new-folder-button']")!.click();
    expect(added).toBe(1);
  });
});
