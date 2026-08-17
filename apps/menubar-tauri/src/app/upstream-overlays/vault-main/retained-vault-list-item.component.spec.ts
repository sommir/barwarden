import "zone.js";
import "@angular/compiler";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { OfficialI18nService } from "../../official-ui/official-i18n.service";
import { demoVaultItems } from "../../vault-demo";
import { toRetainedPopupCipherView } from "../../vault/popup-cipher-view.adapter";
import { RetainedVaultListItemComponent } from "./retained-vault-list-item.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("RetainedVaultListItemComponent", () => {
  it("uses the shared continuous Vault row visual contract", async () => {
    const fixture = await createLoginRow();
    const row = fixture.nativeElement.querySelector("bit-item") as HTMLElement;

    expect(row.classList).toContain("vault-list-row");
    expect(row.querySelector("[data-testid='vault-item-content']")?.classList)
      .toContain("tw-h-[52px]");
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    });
  });

  it("renders the official item structure and retained quick actions", async () => {
    const fixture = await createLoginRow();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector("bit-item [data-testid='vault-item-content']")).not.toBeNull();
    expect(host.querySelector("[data-testid='vault-item-content']")?.getAttribute("data-popup-focus-key"))
      .toBe("vault-item:github");
    expect(host.querySelector("[data-testid='item-name']")?.textContent).toContain("GitHub");
    expect(host.querySelector("[slot='secondary']")?.textContent).toContain("ops@example.com");
    expect(host.querySelector('[aria-label="打开"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="复制并填入用户名"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="复制并填入密码"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="复制并填入验证码"]')).not.toBeNull();
    expect(host.querySelector(".bwi-business")).toBeNull();
    expect(host.querySelector(".bwi-paperclip")).toBeNull();
  });

  it("marks credential actions with stable semantic field names", async () => {
    const fixture = await createLoginRow();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('[data-field="username"] .bwi-user')).not.toBeNull();
    expect(host.querySelector('[data-field="password"] .bwi-key')).not.toBeNull();
    expect(host.querySelector('[data-field="totp"] .bwi-clock')).not.toBeNull();
    expect([...host.querySelectorAll("[data-field]")].map((node) => node.getAttribute("data-field")))
      .toEqual(["username", "password", "totp"]);
  });

  it("keeps the official retained menu order without Fill or collection branches", async () => {
    const fixture = await createLoginRow();
    const host = fixture.nativeElement as HTMLElement;

    host.querySelector<HTMLButtonElement>('[aria-label="更多"]')!.click();
    fixture.detectChanges();
    const menu = document.querySelector<HTMLElement>('[role="menu"][aria-label="更多"]')!;
    const labels = Array.from(menu.querySelectorAll<HTMLElement>("[role='menuitem']"))
      .map((item) => item.textContent?.trim());

    expect(labels).toEqual(["查看", "取消收藏", "编辑", "克隆", "归档", "删除"]);
    expect(menu.textContent).not.toContain("填入");
    expect(menu.textContent).not.toContain("自动填充");
    expect(menu.querySelector("[href*='assign-collections']")).toBeNull();
    expect(menu.querySelector("[href*='edit-cipher']")).toBeNull();
    expect(menu.querySelector("[href*='clone-cipher']")).toBeNull();
    expect(Array.from(menu.querySelectorAll<HTMLButtonElement>("[role='menuitem']"))
      .find((item) => item.textContent?.trim() === "编辑"))
      .not.toBeNull();
    expect(Array.from(menu.querySelectorAll<HTMLButtonElement>("[role='menuitem']"))
      .find((item) => item.textContent?.trim() === "克隆"))
      .not.toBeNull();
  });

  it("fails closed for unsupported organization item mutations", async () => {
    const fixture = await createLoginRow({ organizationId: "organization-1" });
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('[aria-label="复制并填入用户名"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="复制并填入密码"]')).toBeNull();

    host.querySelector<HTMLButtonElement>('[aria-label="更多"]')!.click();
    fixture.detectChanges();
    const labels = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menu"][aria-label="更多"] [role="menuitem"]'),
    ).map((item) => item.textContent?.trim());

    expect(labels).toEqual(["查看", "取消收藏"]);
  });

  it("supports official menu keyboard cycling, Escape focus return, and natural Tab close", async () => {
    const fixture = await createLoginRow();
    const host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="更多"]')!;

    trigger.click();
    fixture.detectChanges();
    await new Promise((resolvePromise) => setTimeout(resolvePromise));
    expect(document.activeElement?.textContent).toContain("查看");

    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(document.activeElement?.textContent).toContain("删除");
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement?.textContent).toContain("查看");
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(document.activeElement?.textContent).toContain("查看");
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    fixture.detectChanges();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 110));
    expect(document.querySelector('[role="menu"][aria-label="更多"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    trigger.click();
    fixture.detectChanges();
    await new Promise((resolvePromise) => setTimeout(resolvePromise));
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    document.activeElement?.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 110));
    fixture.detectChanges();
    expect(document.querySelector('[role="menu"][aria-label="更多"]')).toBeNull();
    host.remove();
  });

  it("keeps the menu exit visible for 100ms and lets reopening interrupt it", async () => {
    const fixture = await createLoginRow();
    const host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="更多"]')!;

    trigger.click();
    fixture.detectChanges();
    trigger.click();
    fixture.detectChanges();
    expect(document.querySelector(".bit-menu-panel--closing [role='menu']")).not.toBeNull();

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    trigger.click();
    fixture.detectChanges();
    expect(document.querySelector(".bit-menu-panel--closing")).toBeNull();
    expect(document.querySelector('[role="menu"][aria-label="更多"]')).not.toBeNull();

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 110));
    expect(document.querySelector('[role="menu"][aria-label="更多"]')).not.toBeNull();
    trigger.click();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 110));
    expect(document.querySelector('[role="menu"][aria-label="更多"]')).toBeNull();
    host.remove();
  });

  it("keeps row selection immediate and reserves launch for the explicit action", async () => {
    const fixture = await createLoginRow();
    const host = fixture.nativeElement as HTMLElement;
    const content = host.querySelector<HTMLButtonElement>(
      '[data-testid="vault-item-content"]',
    )!;
    const viewed = vi.fn();
    const launched = vi.fn();
    fixture.componentInstance.view.subscribe(viewed);
    fixture.componentInstance.launch.subscribe(launched);

    // A real double-click dispatches two clicks before dblclick. None may be
    // delayed, cancelled, or reinterpreted as launch.
    content.click();
    content.click();
    content.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

    expect(viewed).toHaveBeenCalledTimes(2);
    expect(launched).not.toHaveBeenCalled();

    host.querySelector<HTMLButtonElement>('[aria-label="打开"]')!.click();
    expect(launched).toHaveBeenCalledOnce();
  });
});

async function createLoginRow(overrides: Partial<(typeof demoVaultItems)[number]> = {}) {
  await TestBed.configureTestingModule({
    imports: [RetainedVaultListItemComponent],
    providers: [provideRouter([])],
  }).compileComponents();
  const fixture = TestBed.createComponent(RetainedVaultListItemComponent);
  fixture.componentRef.setInput(
    "cipher",
    toRetainedPopupCipherView({ ...demoVaultItems[0], ...overrides }),
  );
  fixture.componentRef.setInput("sectionId", "favorites");
  fixture.detectChanges();
  return fixture;
}
