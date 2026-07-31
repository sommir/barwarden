import "zone.js";
import "@angular/compiler";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { VaultEditFieldComponent } from "./vault-edit-field.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("VaultEditFieldComponent", () => {
  it("binds an accessible required password field and reveals only its own value", async () => {
    await TestBed.configureTestingModule({
      imports: [VaultEditFieldComponent],
      providers: [OfficialI18nService, { provide: I18nService, useExisting: OfficialI18nService }],
    }).compileComponents();
    const fixture = TestBed.createComponent(VaultEditFieldComponent);
    fixture.componentRef.setInput("label", "密码");
    fixture.componentRef.setInput("controlId", "cipher-password");
    fixture.componentRef.setInput("value", "correct horse battery staple");
    fixture.componentRef.setInput("type", "password");
    fixture.componentRef.setInput("required", true);
    fixture.componentRef.setInput("hint", "使用生成器创建安全密码");
    fixture.componentRef.setInput("revealable", true);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const input = host.querySelector<HTMLInputElement>("#cipher-password")!;
    expect(host.querySelector('label[for="cipher-password"]')?.textContent).toContain("密码");
    expect(host.querySelector(".cipher-form-required")).not.toBeNull();
    expect(input.getAttribute("aria-describedby")).toBe("cipher-password-hint");
    expect(input.type).toBe("password");

    host.querySelector<HTMLButtonElement>('[aria-label="显示密码"]')!.click();
    fixture.detectChanges();

    expect(input.type).toBe("text");
    expect(host.querySelector('[aria-label="隐藏密码"]')).not.toBeNull();
  });

  it("emits the actual native control value", async () => {
    await TestBed.configureTestingModule({
      imports: [VaultEditFieldComponent],
      providers: [OfficialI18nService, { provide: I18nService, useExisting: OfficialI18nService }],
    }).compileComponents();
    const fixture = TestBed.createComponent(VaultEditFieldComponent);
    const values: string[] = [];
    fixture.componentInstance.valueChange.subscribe((value) => values.push(value));
    fixture.componentRef.setInput("label", "用户名");
    fixture.componentRef.setInput("controlId", "cipher-username");
    fixture.componentRef.setInput("value", "old@example.com");
    fixture.detectChanges();

    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>("#cipher-username")!;
    input.value = "new@example.com";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(values).toEqual(["new@example.com"]);
  });
});
