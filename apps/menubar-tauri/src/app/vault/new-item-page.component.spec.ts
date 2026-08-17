import "zone.js";
import "@angular/compiler";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { ActivatedRoute, provideRouter, Router } from "@angular/router";
import { of } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { NewItemPageComponent } from "./new-item-page.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("NewItemPageComponent", () => {
  it("renders a continuous semantic list with exact keys", async () => {
    await TestBed.configureTestingModule({
      imports: [NewItemPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(NewItemPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector(".new-item-grid")?.getAttribute("role")).toBe("list");
    expect(Array.from(host.querySelectorAll<HTMLElement>(".new-item-option"), (node) => [
      node.dataset["popupFocusKey"],
      node.tagName,
    ])).toEqual([
      ["new-item:type:1", "A"],
      ["new-item:type:3", "A"],
      ["new-item:type:4", "A"],
      ["new-item:type:2", "A"],
      ["new-item:folder", "BUTTON"],
    ]);
    expect(Array.from(host.querySelectorAll(".new-item-option"))
      .every((node) => node.getAttribute("aria-describedby"))).toBe(true);
  });

  it("renders the official choose-item add flow entries", async () => {
    await TestBed.configureTestingModule({
      imports: [NewItemPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(NewItemPageComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain("选择要添加的项目");
    expect(host.textContent).toContain("登录");
    expect(host.textContent).toContain("支付卡");
    expect(host.textContent).toContain("身份");
    expect(host.textContent).toContain("安全笔记");
    expect(host.textContent).not.toContain("SSH 密钥");
    expect(host.textContent).toContain("文件夹");

    expect(host.querySelector('a[href="/add-cipher?type=1"]')).not.toBeNull();
    expect(host.querySelector('a[href="/add-cipher?type=3"]')).not.toBeNull();
    expect(host.querySelector('a[href="/add-cipher?type=4"]')).not.toBeNull();
    expect(host.querySelector('a[href="/add-cipher?type=2"]')).not.toBeNull();
    expect(host.querySelector('a[href="/add-cipher?type=5"]')).toBeNull();
    expect(host.querySelector('button[aria-label="新增文件夹"]')).not.toBeNull();
    expect([...host.querySelectorAll(".new-item-label")].map((node) => node.textContent?.trim()))
      .toEqual(["登录", "支付卡", "身份", "安全笔记", "文件夹"]);
  });

  it("passes the selected folder to every retained cipher add route", async () => {
    const queryParamMap = { get: (key: string) => key === "folderId" ? "work" : null };
    await TestBed.configureTestingModule({
      imports: [NewItemPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap }, queryParamMap: of(queryParamMap) },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(NewItemPageComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const queryByType = new Map(
      [...host.querySelectorAll<HTMLAnchorElement>('a[href^="/add-cipher"]')].map((link) => {
        const query = new URL(link.href).searchParams;
        return [query.get("type"), query.get("folderId")];
      }),
    );
    expect(queryByType).toEqual(new Map([
      ["1", "work"],
      ["3", "work"],
      ["4", "work"],
      ["2", "work"],
    ]));
    expect(host.querySelector('a[href="/folders?folderId=work"]')).toBeNull();
  });

  it("opens the retained official folder dialog from the chooser", async () => {
    await TestBed.configureTestingModule({
      imports: [NewItemPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(NewItemPageComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLButtonElement>('[aria-label="新增文件夹"]')!.click();
    fixture.detectChanges();

    expect(host.querySelector("bw-vault-folder-dialog dialog[open]")).not.toBeNull();
  });

  it("does not navigate from the chooser when a folder has no active session to create it", async () => {
    await TestBed.configureTestingModule({
      imports: [NewItemPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(NewItemPageComponent);
    const router = TestBed.inject(Router);
    const navigateByUrl = vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLButtonElement>('[aria-label="新增文件夹"]')!.click();
    fixture.detectChanges();
    const folderName = host.querySelector<HTMLInputElement>("#folderName")!;
    folderName.value = "Projects";
    folderName.dispatchEvent(new Event("input"));
    host.querySelector<HTMLFormElement>("#add-edit-folder")!.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await fixture.whenStable();

    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it("returns to the Vault tab from the official back button", async () => {
    await TestBed.configureTestingModule({
      imports: [NewItemPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(NewItemPageComponent);
    const router = TestBed.inject(Router);
    const calls: string[] = [];
    router.navigateByUrl = async (url) => {
      calls.push(String(url));
      return true;
    };

    await fixture.componentInstance.back();

    expect(calls).toEqual(["/tabs/vault"]);
  });

  it("returns focus to the New Item folder trigger when the Sheet is cancelled", async () => {
    await TestBed.configureTestingModule({
      imports: [NewItemPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(NewItemPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const trigger = host.querySelector<HTMLButtonElement>(
      "[data-popup-focus-key='new-item:folder']",
    )!;
    trigger.focus();
    trigger.click();
    fixture.detectChanges();
    await Promise.resolve();
    const cancel = Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "取消")!;
    cancel.click();
    fixture.detectChanges();
    await Promise.resolve();
    expect(document.activeElement).toBe(trigger);
  });
});
