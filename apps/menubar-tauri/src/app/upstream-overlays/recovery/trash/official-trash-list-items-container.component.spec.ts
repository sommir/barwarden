import "zone.js";
import "@angular/compiler";

import { BrowserTestingModule, platformBrowserTesting } from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { OfficialI18nService } from "../../../official-ui/official-i18n.service";
import { demoVaultItems } from "../../../vault-demo";
import { toRecoveryPopupCipherView } from "../../../vault/popup-cipher-view.adapter";
import { OfficialTrashListItemsContainerComponent } from "./official-trash-list-items-container.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("OfficialTrashListItemsContainerComponent", () => {
  beforeEach(() => TestBed.resetTestingModule());

  it("retains the official Trash section, count, row, icon, subtitle, and menu hierarchy", async () => {
    const fixture = await createList();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector("bit-section-header")?.textContent).toContain("回收站中的项目");
    expect(host.querySelector("bit-section-header [slot='end']")?.textContent).toContain("4");
    expect(host.querySelectorAll("bit-item-group > bit-item")).toHaveLength(4);
    expect(host.querySelector("bit-item bw-vault-item-icon")).not.toBeNull();
    expect(host.querySelector("bit-item [slot='secondary']")?.textContent).toContain("ops@example.com");
    expect(host.querySelector(".bwi-business, .bwi-paperclip")).toBeNull();

    host.querySelector<HTMLButtonElement>("[aria-label='回收站选项 GitHub']")!.click();
    fixture.detectChanges();
    expect(menuLabels()).toEqual(["恢复", "永久删除"]);
  });

  it("derives restore permission locally and emits exact Trash commands", async () => {
    const fixture = await createList();
    const item = fixture.componentInstance.items[0]!;
    const commands: unknown[] = [];
    fixture.componentInstance.command.subscribe((command) => commands.push(command));
    const host = fixture.nativeElement as HTMLElement;

    host.querySelector<HTMLButtonElement>("[data-testid='trash-view-github']")!.click();
    host.querySelector<HTMLButtonElement>("[aria-label='回收站选项 GitHub']")!.click();
    fixture.detectChanges();
    clickMenuAction("恢复");
    host.querySelector<HTMLButtonElement>("[aria-label='回收站选项 GitHub']")!.click();
    fixture.detectChanges();
    clickMenuAction("永久删除");

    expect(commands).toEqual([
      { command: "view", location: "trash", item },
      { command: "restore", location: "trash", item },
      { command: "permanent-delete", location: "trash", item },
    ]);
  });
});

async function createList() {
  await TestBed.configureTestingModule({
    imports: [OfficialTrashListItemsContainerComponent],
    providers: [OfficialI18nService, { provide: I18nService, useExisting: OfficialI18nService }],
  }).compileComponents();
  const fixture = TestBed.createComponent(OfficialTrashListItemsContainerComponent);
  fixture.componentRef.setInput("headerText", "回收站中的项目");
  fixture.componentRef.setInput("items", demoVaultItems.slice(0, 4).map(toRecoveryPopupCipherView));
  fixture.detectChanges();
  return fixture;
}

function menuLabels(): string[] {
  const pane = Array.from(document.body.querySelectorAll<HTMLElement>(".cdk-overlay-pane")).at(-1);
  return Array.from(pane?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? [])
    .map((item) => item.textContent?.trim() ?? "");
}

function clickMenuAction(label: string): void {
  const pane = Array.from(document.body.querySelectorAll<HTMLElement>(".cdk-overlay-pane")).at(-1);
  const action = Array.from(pane?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? [])
    .find((button) => button.textContent?.trim() === label);
  expect(action).toBeDefined();
  action!.click();
}
