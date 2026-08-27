import "zone.js";
import "@angular/compiler";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { OfficialI18nService } from "../official-ui/official-i18n.service";
import type { VaultField } from "../vault-demo";
import { VaultDetailFieldComponent } from "./vault-detail-field.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("VaultDetailFieldComponent", () => {
  const password: VaultField = {
    id: "password",
    label: "密码",
    value: "correct horse battery staple",
    concealed: true,
    type: "hidden",
  };

  it("renders a readonly concealed field and reveals only that field", async () => {
    await TestBed.configureTestingModule({
      imports: [VaultDetailFieldComponent],
      providers: [OfficialI18nService, { provide: I18nService, useExisting: OfficialI18nService }],
    }).compileComponents();
    const fixture = TestBed.createComponent(VaultDetailFieldComponent);
    fixture.componentRef.setInput("field", password);
    fixture.componentRef.setInput("value", password.value);
    fixture.componentRef.setInput("conceal", true);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const input = host.querySelector<HTMLInputElement>("input")!;
    expect(input.readOnly).toBe(true);
    expect(input.type).toBe("password");
    expect(input.id).toBe("detail-field-password");

    host.querySelector<HTMLButtonElement>('[aria-label="显示密码"]')!.click();
    fixture.detectChanges();

    expect(input.type).toBe("text");
    expect(host.querySelector('[aria-label="隐藏密码"]')).not.toBeNull();
  });

  it("emits copy, fill and launch values from official-shaped suffix actions", async () => {
    await TestBed.configureTestingModule({
      imports: [VaultDetailFieldComponent],
      providers: [OfficialI18nService, { provide: I18nService, useExisting: OfficialI18nService }],
    }).compileComponents();
    const fixture = TestBed.createComponent(VaultDetailFieldComponent);
    const copied: VaultField[] = [];
    const filled: VaultField[] = [];
    const launched: string[] = [];
    fixture.componentInstance.copy.subscribe((field) => copied.push(field));
    fixture.componentInstance.fill.subscribe((field) => filled.push(field));
    fixture.componentInstance.launch.subscribe((value) => launched.push(value));
    fixture.componentRef.setInput("field", password);
    fixture.componentRef.setInput("value", password.value);
    fixture.componentRef.setInput("canFill", true);
    fixture.componentRef.setInput("launchable", true);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[aria-label="复制密码"] .bwi-clone')).not.toBeNull();
    host.querySelector<HTMLButtonElement>('[aria-label="复制密码"]')!.click();
    host.querySelector<HTMLButtonElement>('[aria-label="填入密码字段"]')!.click();
    host.querySelector<HTMLButtonElement>('[aria-label="打开密码"]')!.click();

    expect(copied).toEqual([password]);
    expect(filled).toEqual([password]);
    expect(launched).toEqual([password.value]);
  });

  it("keeps the real Fill field action at least 44px in both axes", async () => {
    const cleanupCss = installInteractionCss();
    await TestBed.configureTestingModule({
      imports: [VaultDetailFieldComponent],
      providers: [OfficialI18nService, { provide: I18nService, useExisting: OfficialI18nService }],
    }).compileComponents();
    const fixture = TestBed.createComponent(VaultDetailFieldComponent);
    fixture.componentRef.setInput("field", password);
    fixture.componentRef.setInput("value", password.value);
    fixture.componentRef.setInput("canFill", true);
    fixture.detectChanges();

    try {
      const action = fixture.nativeElement.querySelector<HTMLElement>(".field-action")!;
      expect(getComputedStyle(action).minWidth).toBe("44px");
      expect(getComputedStyle(action).minHeight).toBe("44px");
    } finally {
      fixture.destroy();
      cleanupCss();
    }
  });
});

function installInteractionCss(): () => void {
  const style = document.createElement("style");
  style.textContent = ["macos-tokens.css", "global.css"]
    .map((filename) => readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles", filename),
      "utf8",
    ))
    .join("\n")
    .replace(/^@import[^;]+;\s*/gm, "");
  document.head.append(style);
  const rootStyle = getComputedStyle(document.documentElement);
  style.textContent = style.textContent.replace(/var\((--[\w-]+)\)/g, (value, name) =>
    rootStyle.getPropertyValue(name).trim() || value,
  );
  return () => style.remove();
}
