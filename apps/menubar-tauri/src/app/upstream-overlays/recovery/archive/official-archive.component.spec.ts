import "zone.js";
import "@angular/compiler";

import { BrowserTestingModule, platformBrowserTesting } from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { beforeEach, describe, expect, it } from "vitest";

import { OfficialI18nService } from "../../../official-ui/official-i18n.service";
import { demoVaultItems } from "../../../vault-demo";
import { toRecoveryPopupCipherView } from "../../../vault/popup-cipher-view.adapter";
import type { RecoveryPageCommand } from "../recovery-command";
import { OfficialArchiveComponent } from "./official-archive.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("OfficialArchiveComponent", () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [OfficialI18nService, { provide: I18nService, useExisting: OfficialI18nService }],
    });
  });

  it("retains the official Archive hierarchy and excludes deferred branches", async () => {
    const fixture = await createArchive();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector("popup-page > popup-header")).not.toBeNull();
    expect(host.querySelector("bit-section-header")?.textContent).toContain("归档中的项目");
    expect(host.querySelector("bit-section-header [slot='end']")?.textContent).toContain("4");
    expect(host.querySelectorAll("bit-item-group > bit-item")).toHaveLength(4);
    expect(host.querySelector("bit-item [data-testid='item-name']")?.textContent).toContain("GitHub");
    expect(host.querySelector("bit-item bw-vault-item-icon")).not.toBeNull();
    expect(host.querySelector("bit-item [slot='secondary']")?.textContent).toContain("ops@example.com");

    const text = host.textContent ?? "";
    expect(text).not.toMatch(/重启高级版|订阅|分配集合|附件|通行密钥|SSH/);
    expect(host.querySelector(".bwi-business, .bwi-paperclip, [href*='premium'], [href*='assign-collections']")).toBeNull();
    expect(fixture.componentInstance.items.every((item) => !("fields" in item) && !("uri" in item)))
      .toBe(true);
  });

  it("emits the exact retained projection and Archive command from the official menu", async () => {
    const fixture = await createArchive();
    const view = fixture.componentInstance.items[0]!;
    const commands: unknown[] = [];
    fixture.componentInstance.command.subscribe((command) => commands.push(command));
    const host = fixture.nativeElement as HTMLElement;
    const trigger = host.querySelector<HTMLButtonElement>("[aria-label='归档选项 GitHub']")!;

    host.querySelector<HTMLButtonElement>("[data-testid='archive-view-github']")!.click();
    trigger.click();
    fixture.detectChanges();
    clickMenuAction("编辑");
    trigger.click();
    fixture.detectChanges();
    clickMenuAction("克隆");
    trigger.click();
    fixture.detectChanges();
    clickMenuAction("取消归档");
    trigger.click();
    fixture.detectChanges();
    clickMenuAction("删除");

    expect(commands).toEqual([
      { command: "view", location: "archive", item: view, trigger: undefined },
      { command: "edit", location: "archive", item: view, trigger: undefined },
      { command: "clone", location: "archive", item: view, trigger: undefined },
      { command: "unarchive", location: "archive", item: view, trigger },
      { command: "soft-delete", location: "archive", item: view, trigger },
    ]);
  });

  it("renders the retained Archive empty state", async () => {
    const fixture = await createArchive([]);
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector("bit-no-items")).not.toBeNull();
    expect(host.textContent).toContain("归档中没有项目");
  });

  it("emits the real Archive More trigger and stable focus key", async () => {
    const fixture = await createArchive();
    const commands: RecoveryPageCommand[] = [];
    fixture.componentInstance.command.subscribe((value) => commands.push(value));
    const host = fixture.nativeElement as HTMLElement;
    const trigger = host.querySelector<HTMLButtonElement>("[aria-label='归档选项 GitHub']")!;
    expect(trigger.dataset["popupFocusKey"]).toBe("archive-item:github");
    trigger.click();
    fixture.detectChanges();
    clickMenuAction("删除");
    expect(commands.at(-1)).toEqual({
      command: "soft-delete", location: "archive",
      item: fixture.componentInstance.items[0], trigger,
    });
  });
});

async function createArchive(items = demoVaultItems.slice(0, 4)) {
  await TestBed.configureTestingModule({ imports: [OfficialArchiveComponent] }).compileComponents();
  const fixture = TestBed.createComponent(OfficialArchiveComponent);
  fixture.componentRef.setInput("items", items.map(toRecoveryPopupCipherView));
  fixture.detectChanges();
  return fixture;
}

function clickMenuAction(label: string): void {
  const pane = Array.from(document.body.querySelectorAll<HTMLElement>(".cdk-overlay-pane")).at(-1);
  const action = Array.from(pane?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? [])
    .find((button) => button.textContent?.trim() === label);
  expect(action).toBeDefined();
  action!.click();
}
