import "zone.js";
import "@angular/compiler";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { describe, expect, it, vi } from "vitest";

import { OfficialAccountSwitcherAdapter } from "../../../auth/official-account-switcher.adapter";
import { OfficialAccountComponent } from "./official-account.component";
import { presentAvailableAccounts } from "./official-account-switcher.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

function installAccountVisualCss(): () => void {
  const style = document.createElement("style");
  const source = ["macos-tokens.css", "global.css"]
    .map((filename) =>
      readFileSync(
        join(process.cwd(), "apps/menubar-tauri/src/styles", filename),
        "utf8",
      ),
    )
    .join("\n")
    .replace(/^@import[^;]+;\s*/gm, "");
  const rootDeclarations = source.match(/^:root\s*{([\s\S]*?)^}/m)?.[1] ?? "";
  const tokens = new Map(
    [...rootDeclarations.matchAll(/(--mac-[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [
      name,
      value.trim(),
    ]),
  );

  style.textContent = `auth-account + auth-account { margin-top: 12px; }\n${source.replace(
    /var\((--mac-[\w-]+)\)/g,
    (reference, name) => tokens.get(name) ?? reference,
  )}`;
  document.head.append(style);
  return () => style.remove();
}

@Component({
  standalone: true,
  imports: [OfficialAccountComponent],
  host: { class: "macos-page--account-switcher" },
  template: `
    <auth-account [account]="accounts[0]"></auth-account>
    <auth-account [account]="accounts[1]"></auth-account>
  `,
})
class AccountVisualTestHostComponent {
  readonly accounts = [
    {
      id: "current",
      name: "current-account-with-a-very-long-name@example.test",
      email: "current-account-with-a-very-long-name@example.test",
      server: "an-extremely-long-self-hosted-vault-hostname.example.test",
      status: "unlocked" as const,
      isActive: true,
    },
    {
      id: "locked",
      name: "locked-account@example.test",
      email: "locked-account@example.test",
      server: "vault.example.test",
      status: "locked" as const,
      isActive: false,
    },
  ];
}

describe("OfficialAccountComponent authorization copy", () => {
  it("renders continuous 52 px account rows with wrapping written status and one row action", async () => {
    const cleanupCss = installAccountVisualCss();
    const select = vi.fn(async () => undefined);

    try {
      await TestBed.configureTestingModule({
        imports: [AccountVisualTestHostComponent],
        providers: [
          {
            provide: OfficialAccountSwitcherAdapter,
            useValue: { add: vi.fn(async () => undefined), select },
          },
          {
            provide: I18nService,
            useValue: { t: (key: string) => key },
          },
        ],
      }).compileComponents();

      const fixture = TestBed.createComponent(AccountVisualTestHostComponent);
      fixture.detectChanges();
      const parent = fixture.nativeElement as HTMLElement;
      document.body.append(parent);

      const accounts = [...parent.querySelectorAll<HTMLElement>("auth-account")];
      const rows = accounts.map((account) => account.querySelector<HTMLElement>("bit-item")!);
      const buttons = accounts.map((account) => account.querySelectorAll("button"));
      const labels = [...parent.querySelectorAll<HTMLElement>(".macos-account-label")];
      const writtenStatus = accounts[0]!.querySelector<HTMLElement>(".tw-italic")!;
      const statusIcon = accounts[0]!.querySelector<HTMLElement>("bit-icon[slot='end']")!;

      expect(accounts).toHaveLength(2);
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        const styles = getComputedStyle(row);
        expect(styles.minHeight).toBe("52px");
        expect(styles.borderTopWidth).toBe("0px");
        expect(styles.borderRightWidth).toBe("0px");
        expect(styles.borderBottomWidth).toBe("1px");
        expect(styles.borderLeftWidth).toBe("0px");
        expect(styles.borderRadius).toBe("0px");
        expect(styles.boxShadow).toBe("none");
      }
      expect(getComputedStyle(accounts[1]!).marginTop).toBe("0px");
      for (const buttonsInRow of buttons) {
        expect(buttonsInRow).toHaveLength(1);
        expect(getComputedStyle(buttonsInRow[0]!).minHeight).toBe("52px");
      }
      for (const label of labels) {
        const styles = getComputedStyle(label);
        expect(styles.maxWidth).toBe("100%");
        expect(styles.overflowWrap).toBe("anywhere");
        expect(styles.whiteSpace).toBe("normal");
        expect(styles.overflow).toBe("visible");
        expect(styles.textOverflow).toBe("clip");
      }
      expect(writtenStatus.textContent).toContain("已激活 · 已解锁");
      expect(getComputedStyle(writtenStatus).overflowWrap).toBe("anywhere");
      expect(getComputedStyle(writtenStatus).whiteSpace).toBe("normal");
      expect(statusIcon.classList).toContain("bwi-unlock");

      (buttons[1]![0] as HTMLButtonElement).click();
      expect(select).toHaveBeenCalledOnce();
      expect(select).toHaveBeenCalledWith("locked");

      fixture.destroy();
      parent.remove();
    } finally {
      cleanupCss();
      TestBed.resetTestingModule();
    }
  });

  it("distinguishes the current account from an unlocked session and explains recovery", () => {
    const component = new OfficialAccountComponent(
      {} as never,
      {
        t: (key: string) =>
          key === "i18nSessionRestoreRequired" ? "会话需要恢复" : key,
      } as never,
    );
    component.account = {
      id: "account-1",
      name: "person@example.com",
      email: "person@example.com",
      isActive: true,
      status: "recovery-required",
    };

    expect(component.status).toEqual({
      text: "会话需要恢复",
      icon: "bwi-exclamation-triangle",
    });
  });

  it("announces both current-account ownership and unlocked authorization", () => {
    const component = new OfficialAccountComponent(
      {} as never,
      { t: (key: string) => key } as never,
    );
    component.account = {
      id: "account-1",
      name: "person@example.com",
      email: "person@example.com",
      isActive: true,
      status: "unlocked",
    };

    expect(component.status).toEqual({
      text: "active · unlocked",
      icon: "bwi-unlock",
    });
  });

  it("projects recovery authorization onto only the active account card", () => {
    expect(
      presentAvailableAccounts(
        [
          {
            id: "active",
            email: "active@example.com",
            serverUrl: "https://vault.active.example.com",
            status: "unlocked",
            isActive: true,
          },
          {
            id: "other",
            email: "other@example.com",
            serverUrl: "https://vault.other.example.com",
            status: "unlocked",
            isActive: false,
          },
        ],
        "recovery-required",
        5,
      ),
    ).toEqual([
      expect.objectContaining({ id: "active", status: "recovery-required" }),
      expect.objectContaining({ id: "other", status: "unlocked" }),
      expect.objectContaining({ id: "addAccount" }),
    ]);
  });
});
