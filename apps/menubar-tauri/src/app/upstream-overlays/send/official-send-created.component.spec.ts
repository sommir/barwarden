import "zone.js";
import "@angular/compiler";

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { TestBed } from "@angular/core/testing";
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { beforeEach, describe, expect, it } from "vitest";

const runtimePath = resolve(
  process.cwd(),
  "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-created.component.ts",
);

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

beforeEach(() => TestBed.resetTestingModule());

describe("OfficialSendCreatedComponent", () => {
  it("has a generated official runtime", () => {
    expect(existsSync(runtimePath)).toBe(true);
  });

  it.each([
    [false, "创建的 Send 将在 2 天后过期。"],
    [true, "创建的密码保护 Send 将在 2 天后过期。"],
  ])("retains the official no-auth and password descriptions", async (hasPassword, description) => {
    const fixture = await createFixture(hasPassword);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(description);
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain("电子邮件");
  });

  it("renders one quiet summary, readonly link, Copy, Close, and pop-out", async () => {
    const fixture = await createFixture(false);
    fixture.componentRef.setInput("link", "https://vault.example.test/#/send/access/key");
    const commands: string[] = [];
    fixture.componentInstance.copyLink.subscribe(() => commands.push("copy"));
    fixture.componentInstance.close.subscribe(() => commands.push("close"));
    fixture.componentInstance.popOut.subscribe(() => commands.push("popOut"));
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const summary = host.querySelector<HTMLElement>(".macos-send-created__summary")!;
    const link = host.querySelector<HTMLInputElement>('[data-testid="created-link"]')!;
    expect(summary).not.toBeNull();
    expect(summary.getAttribute("aria-labelledby")).toBe("send-created-title");
    expect(host.querySelector("#send-created-title")?.getAttribute("tabindex")).toBe("-1");
    expect(link.readOnly).toBe(true);
    expect(link.value).toContain("/#/send/");
    expect(link.getAttribute("aria-label")).toBe("复制链接");
    expect(host.querySelectorAll('[data-testid="created-copy"]')).toHaveLength(1);
    host.querySelector<HTMLButtonElement>('[data-testid="created-copy"]')!.click();
    host.querySelector<HTMLButtonElement>('[data-testid="created-close"]')!.click();
    host.querySelector<HTMLButtonElement>('[aria-label="弹出到新窗口"]')!.click();

    expect(commands).toEqual(["copy", "close", "popOut"]);
  });
});

async function createFixture(hasPassword: boolean) {
  const { OfficialSendCreatedComponent } = await import("./official-send-created.component");
  await TestBed.configureTestingModule({ imports: [OfficialSendCreatedComponent] }).compileComponents();
  const fixture = TestBed.createComponent(OfficialSendCreatedComponent);
  fixture.componentRef.setInput("send", {
    id: "send-created",
    name: "One time secret",
    deletionDate: "2026-08-01T00:00:00.000Z",
    hasPassword,
  });
  fixture.componentRef.setInput("formattedExpiration", "2 天");
  fixture.componentRef.setInput("link", "https://vault.example.test/#/send/access/key");
  return fixture;
}
