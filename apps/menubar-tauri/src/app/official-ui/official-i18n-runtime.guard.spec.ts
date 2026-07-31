import "zone.js";
import "@angular/compiler";

import { Component } from "@angular/core";
import { BrowserTestingModule, platformBrowserTesting } from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { I18nPipe } from "./official-ui-common";
import { OfficialI18nService, officialFormZhCnMessages } from "./official-i18n.service";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

@Component({
  standalone: true,
  imports: [I18nPipe],
  template: `<span data-testid="translated">{{ "m2ShellLongTranslation" | i18n }}</span>`,
})
class OfficialI18nPipeHostComponent {}

describe("official I18nPipe runtime guard", () => {
  it("keeps the adapter, provider, and provenance mapped to the pinned pipe", () => {
    expect(
      readFileSync(join(process.cwd(), "apps/menubar-tauri/src/app/official-ui/official-ui-common.ts"), "utf8"),
    ).toBe(
      'export { I18nPipe } from "../../../../../vendor/bitwarden-clients/libs/ui/common/src/i18n.pipe";\n',
    );
    expect(
      readFileSync(join(process.cwd(), "apps/menubar-tauri/src/app/app.config.ts"), "utf8"),
    ).toContain("{ provide: I18nService, useExisting: OfficialI18nService }");
    expect(
      readFileSync(
        join(
          process.cwd(),
          "apps/menubar-tauri/src/app/upstream-overlays/popup-header/jslib.module.adapter.ts",
        ),
        "utf8",
      ),
    ).toContain("providers: [OfficialI18nService, { provide: I18nService, useExisting: OfficialI18nService }]");

    for (const config of ["tsconfig.json", "apps/menubar-tauri/vite.config.ts", "vitest.config.ts"]) {
      const source = readFileSync(join(process.cwd(), config), "utf8");
      expect(source, config).toContain("@bitwarden/ui-common");
      expect(source, config).toContain("official-ui-common.ts");
      expect(source, config).toContain("@bitwarden/angular/jslib.module");
      expect(source, config).toContain("jslib.module.adapter.ts");
    }
  });

  it("renders a deterministic long translation through the pinned official pipe", async () => {
    await TestBed.configureTestingModule({
      imports: [OfficialI18nPipeHostComponent],
      providers: [OfficialI18nService, { provide: I18nService, useExisting: OfficialI18nService }],
    }).compileComponents();
    await TestBed.inject(I18nService).setLocale("zh-CN");

    const fixture = TestBed.createComponent(OfficialI18nPipeHostComponent);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector("[data-testid=translated]")?.textContent).toBe(
      "这是一个用于验证官方本地化管道在固定弹窗宽度内完整保留可访问文本的确定性长翻译文本",
    );
  });

  it("retains Task 5 form messages and placeholder metadata byte-for-byte from pinned zh_CN", () => {
    const upstream = JSON.parse(
      readFileSync(
        join(
          process.cwd(),
          "vendor/bitwarden-clients/apps/browser/src/_locales/zh_CN/messages.json",
        ),
        "utf8",
      ),
    ) as Record<
      string,
      { message: string; placeholders?: Record<string, unknown> }
    >;

    expect(Object.keys(officialFormZhCnMessages).length).toBeGreaterThan(30);
    for (const [key, message] of Object.entries(officialFormZhCnMessages)) {
      expect(message, key).toEqual(upstream[key]);
      expect(message.message, key).not.toMatch(/\{\d+\}/);
    }
  });
});
