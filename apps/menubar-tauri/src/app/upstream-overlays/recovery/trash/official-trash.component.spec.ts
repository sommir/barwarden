import "zone.js";
import "@angular/compiler";

import { BrowserTestingModule, platformBrowserTesting } from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { beforeEach, describe, expect, it } from "vitest";

import { OfficialI18nService } from "../../../official-ui/official-i18n.service";
import { demoVaultItems } from "../../../vault-demo";
import { toRecoveryPopupCipherView } from "../../../vault/popup-cipher-view.adapter";
import { OfficialTrashComponent } from "./official-trash.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("OfficialTrashComponent", () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [OfficialI18nService, { provide: I18nService, useExisting: OfficialI18nService }],
    });
  });

  it("retains the official Trash header, warning, list container, and explicit exclusions", async () => {
    const fixture = await createTrash();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector("popup-page > popup-header")).not.toBeNull();
    expect(host.querySelector('.macos-alert-strip[data-kind="warning"]')).not.toBeNull();
    expect(host.textContent).toContain("回收站中超过 30 天的项目将被自动删除");
    expect(host.textContent).not.toContain("直到你恢复或永久删除它们");
    expect(host.querySelector("bw-official-trash-list-items-container bit-section")).not.toBeNull();
    expect(host.textContent).not.toMatch(/分配集合|附件|通行密钥|SSH/);
    expect(host.querySelector(".bwi-business, .bwi-paperclip, [href*='assign-collections']")).toBeNull();
  });

  it("relays one exact command from the retained list", async () => {
    const fixture = await createTrash();
    const item = fixture.componentInstance.items[0]!;
    const commands: unknown[] = [];
    fixture.componentInstance.command.subscribe((command) => commands.push(command));

    const list = (fixture.nativeElement as HTMLElement)
      .querySelector("bw-official-trash-list-items-container")!;
    list.querySelector<HTMLButtonElement>("[data-testid='trash-view-github']")!.click();
    expect(commands).toEqual([{ command: "view", location: "trash", item }]);
  });

  it("renders the official Trash empty state without a warning", async () => {
    const fixture = await createTrash([]);
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector("bit-callout")).toBeNull();
    expect(host.querySelector("bit-no-items")).not.toBeNull();
    expect(host.textContent).toContain("回收站中没有项目");
  });
});

async function createTrash(items = demoVaultItems.slice(0, 4)) {
  await TestBed.configureTestingModule({ imports: [OfficialTrashComponent] }).compileComponents();
  const fixture = TestBed.createComponent(OfficialTrashComponent);
  fixture.componentRef.setInput("items", items.map(toRecoveryPopupCipherView));
  fixture.detectChanges();
  return fixture;
}
