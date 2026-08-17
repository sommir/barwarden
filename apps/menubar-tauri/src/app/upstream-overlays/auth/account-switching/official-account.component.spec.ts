import "zone.js";
import "@angular/compiler";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Location } from "@angular/common";
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AvatarService } from "@bitwarden/common/auth/abstractions/avatar.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { DialogService } from "@bitwarden/components";
import { BehaviorSubject } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { OfficialAccountSwitcherAdapter } from "../../../auth/official-account-switcher.adapter";
import { OfficialI18nService } from "../../../official-ui/official-i18n.service";
import { OfficialAccountComponent } from "./official-account.component";
import {
  OfficialAccountSwitcherComponent,
  presentAvailableAccounts,
} from "./official-account-switcher.component";

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

  style.textContent = source.replace(
    /var\((--mac-[\w-]+)\)/g,
    (reference, name) => tokens.get(name) ?? reference,
  );
  document.head.append(style);
  return () => style.remove();
}

describe("OfficialAccountComponent authorization copy", () => {
  it("renders the product account wrappers as continuous 52 px rows with one row action", async () => {
    const cleanupCss = installAccountVisualCss();
    const select = vi.fn(async () => undefined);
    const add = vi.fn(async () => undefined);
    const accounts = [
      {
        id: "current",
        email: "current-account-with-a-very-long-name@example.test",
        serverUrl: "https://an-extremely-long-self-hosted-vault-hostname.example.test",
        status: "unlocked" as const,
        isActive: true,
      },
      {
        id: "locked",
        email: "locked-account@example.test",
        serverUrl: "https://vault.example.test",
        status: "locked" as const,
        isActive: false,
      },
    ];
    const accountsSubject = new BehaviorSubject(accounts);
    const activeAccountSubject = new BehaviorSubject(accounts[0]!);
    const adapter = {
      accounts$: accountsSubject.asObservable(),
      activeAccount$: activeAccountSubject.asObservable(),
      activeAuthorization$: new BehaviorSubject<"unlocked">("unlocked").asObservable(),
      loading$: new BehaviorSubject(false).asObservable(),
      error$: new BehaviorSubject<string | null>(null).asObservable(),
      refresh: vi.fn(async () => undefined),
      select,
      add,
      lock: vi.fn(async () => undefined),
      lockAll: vi.fn(async () => undefined),
      logout: vi.fn(async () => undefined),
    };
    const dialogService = { openSimpleDialog: vi.fn(async () => false) };

    try {
      await TestBed.configureTestingModule({
        imports: [OfficialAccountSwitcherComponent],
        providers: [
          provideRouter([]),
          OfficialI18nService,
          { provide: I18nService, useExisting: OfficialI18nService },
          {
            provide: OfficialAccountSwitcherAdapter,
            useValue: adapter,
          },
          {
            provide: DialogService,
            useValue: dialogService,
          },
          {
            provide: AccountService,
            useValue: {
              activeAccount$: new BehaviorSubject({
                id: accounts[0]!.id,
                email: accounts[0]!.email,
                name: accounts[0]!.email,
                emailVerified: true,
                creationDate: undefined,
              }).asObservable(),
            },
          },
          {
            provide: AvatarService,
            useValue: {
              avatarColor$: new BehaviorSubject("#175DDC").asObservable(),
            },
          },
          {
            provide: AuthService,
            useValue: {
              activeAccountStatus$: new BehaviorSubject(
                AuthenticationStatus.Unlocked,
              ).asObservable(),
            },
          },
          { provide: PlatformUtilsService, useValue: { isFirefox: () => false } },
          { provide: Location, useValue: { back: vi.fn() } },
        ],
      }).compileComponents();

      const fixture = TestBed.createComponent(OfficialAccountSwitcherComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;
      document.body.append(host);

      const renderedAccounts = [...host.querySelectorAll<HTMLElement>("auth-account")];
      const rows = renderedAccounts.map((account) =>
        account.querySelector<HTMLElement>("bit-item")!,
      );
      const wrappers = renderedAccounts.map((account) => account.parentElement!);
      const buttons = renderedAccounts.map((account) => account.querySelectorAll("button"));
      const labels = [...host.querySelectorAll<HTMLElement>(".macos-account-label")];
      const writtenStatus = renderedAccounts[0]!.querySelector<HTMLElement>(".tw-italic")!;
      const statusIcon = renderedAccounts[0]!.querySelector<HTMLElement>("bit-icon[slot='end']")!;
      const accountSection = renderedAccounts[0]!.closest<HTMLElement>("bit-section")!;
      const accountLayout = accountSection.querySelector<HTMLElement>(":scope > section")!;

      expect(renderedAccounts).toHaveLength(3);
      expect(rows).toHaveLength(3);
      expect(wrappers.every((wrapper) => wrapper.parentElement === accountLayout)).toBe(true);
      expect(
        renderedAccounts.some((account) => account.nextElementSibling?.matches("auth-account")),
      ).toBe(false);
      expect(getComputedStyle(accountLayout).display).toBe("grid");
      expect(getComputedStyle(accountLayout).gap).toBe("0px");
      for (const wrapper of wrappers) {
        expect(getComputedStyle(wrapper).marginTop).toBe("0px");
        expect(getComputedStyle(wrapper).marginBottom).toBe("0px");
      }
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
      expect(add).not.toHaveBeenCalled();
      expect(dialogService.openSimpleDialog).not.toHaveBeenCalled();

      fixture.destroy();
      host.remove();
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
