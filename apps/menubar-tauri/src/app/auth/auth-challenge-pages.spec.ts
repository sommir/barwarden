import "zone.js";
import "@angular/compiler";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { By } from "@angular/platform-browser";
import { TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import postcss from "postcss";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccountSessionStore } from "../../auth/account-session-store";
import { buildBitwardenEnvironment, type HttpTransport } from "../../bitwarden-api/bitwarden-api";
import type { HostApi } from "../../host/host-api";
import { PopupStateStore } from "../popup-state";
import { ButtonComponent } from "../official-ui/official-components";
import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { AuthFacade } from "./auth.facade";
import { NewDeviceVerificationPageComponent } from "./new-device-verification-page.component";
import {
  OFFICIAL_PASSWORD_HINT_TRANSPORT,
} from "./official-password-hint-api.adapter";
import { PasswordHintPageComponent } from "./password-hint-page.component";
import { TwoFactorPageComponent } from "./two-factor-page.component";
import { OfficialNewDeviceVerificationComponent } from "../upstream-overlays/auth/new-device/official-new-device-verification.component";
import { OfficialAnonymousShellComponent } from "../upstream-overlays/auth/anonymous/official-anonymous-shell.component";
import { OfficialTwoFactorComponent } from "../upstream-overlays/auth/two-factor/official-two-factor.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

function twoFactorAuthFacade(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    authChallengeExpiresAt: () => Date.now() + 60_000,
    submitTwoFactor: vi.fn(async () => undefined),
    sendTwoFactorEmail: vi.fn(async () => undefined),
    cancelAuthChallenge: vi.fn(),
    ...overrides,
  };
}

function newDeviceAuthFacade(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    authChallengeExpiresAt: () => Date.now() + 60_000,
    submitNewDeviceOtp: vi.fn(async () => undefined),
    resendNewDeviceOtp: vi.fn(async () => undefined),
    cancelAuthChallenge: vi.fn(),
    ...overrides,
  };
}

function installChallengeVisualCss(): () => void {
  const style = document.createElement("style");
  const productionCascade = postcss.root();
  for (const filename of ["macos-tokens.css", "global.css"]) {
    const stylesheet = postcss.parse(
      readFileSync(join(process.cwd(), "apps/menubar-tauri/src/styles", filename), "utf8"),
    );
    productionCascade.append(
      stylesheet.nodes.filter(
        (node) => !(node.type === "atrule" && node.name.toLowerCase() === "import"),
      ),
    );
  }
  const tokens = new Map<string, string>();
  productionCascade.walkRules(":root", (rule) => {
    rule.walkDecls((declaration) => {
      if (declaration.prop.startsWith("--")) {
        tokens.set(declaration.prop, declaration.value.trim());
      }
    });
  });
  style.textContent = productionCascade.toString();
  document.head.append(style);

  const materializeDirectTokens = (rules: CSSRuleList): void => {
    for (const rule of Array.from(rules)) {
      if ("style" in rule) {
        const declaration = (rule as CSSStyleRule).style;
        for (const property of Array.from(declaration)) {
          const value = declaration.getPropertyValue(property).trim();
          if (value.startsWith("var(") && value.endsWith(")") && !value.includes(",")) {
            const token = tokens.get(value.slice(4, -1).trim());
            if (token && !token.includes("var(")) {
              declaration.setProperty(property, token, declaration.getPropertyPriority(property));
            }
          }
        }
      }
      if ("cssRules" in rule) {
        materializeDirectTokens((rule as CSSGroupingRule).cssRules);
      }
    }
  };
  if (style.sheet) {
    materializeDirectTokens(style.sheet.cssRules);
  }
  return () => style.remove();
}

describe("auth challenge pages", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", webcrypto);
  });

  it.each([
    {
      name: "US",
      serverUrl: "https://vault.bitwarden.com",
      apiUrl: "https://api.bitwarden.com",
    },
    {
      name: "EU",
      serverUrl: "https://vault.bitwarden.eu/",
      apiUrl: "https://api.bitwarden.eu",
    },
    {
      name: "self-hosted",
      serverUrl: "https://vault.example.test:8443/",
      apiUrl: "https://vault.example.test:8443/api",
    },
  ])("submits $name password hints through its API host", async ({ serverUrl, apiUrl }) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const transport: HttpTransport = {
      fetchJson: async (url, init) => {
        calls.push({ url, init });
        return {};
      },
    };
    const store = new PopupStateStore();
    store.setServerUrl(serverUrl);

    await TestBed.configureTestingModule({
      imports: [PasswordHintPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        { provide: OFFICIAL_PASSWORD_HINT_TRANSPORT, useValue: transport },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(PasswordHintPageComponent);
    const router = TestBed.inject(Router);
    router.navigateByUrl = async () => true;
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const input = host.querySelector<HTMLInputElement>('input[type="email"]')!;
    input.value = "person@example.test";
    input.dispatchEvent(new Event("input"));
    fixture.detectChanges();
    const submit = host.querySelector<HTMLButtonElement>('button[type="submit"][bitformbutton]');
    expect(submit).not.toBeNull();
    submit!.click();
    await fixture.whenStable();

    expect(calls[0]?.url).toBe(`${apiUrl}/accounts/password-hint`);
  });

  it("renders the official two-factor route shell with provider context", async () => {
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "twoFactor",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
      providers: ["0", "1"],
    });

    await TestBed.configureTestingModule({
      imports: [TwoFactorPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        { provide: AuthFacade, useValue: twoFactorAuthFacade() },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TwoFactorPageComponent);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("两步登录");
    expect(text).toContain("user@example.com");
    expect(text).toContain("验证码");
    expect(text).toContain("继续登录");
    expect((fixture.nativeElement as HTMLElement).querySelector("input")?.hasAttribute("disabled")).toBe(false);
    const otherMethod = (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>("[data-testid='two-factor-other-method']");
    expect(otherMethod?.textContent).toContain("选择其他方式");
    expect((fixture.nativeElement as HTMLElement).querySelector("popup-page > popup-header")).not.toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector(".auth-provider-list span")).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector("popup-page > main")).not.toBeNull();
    otherMethod!.click();
    fixture.detectChanges();
    const optionsText = (fixture.nativeElement as HTMLElement)
      .querySelector("bw-official-two-factor-options")?.textContent ?? "";
    expect(optionsText).toContain("验证器 App");
    expect(optionsText).toContain("电子邮箱");
  });

  it("renders the retained official parent and authenticator child through official primitives", async () => {
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "twoFactor",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
      providers: ["0"],
    });

    await TestBed.configureTestingModule({
      imports: [TwoFactorPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        {
          provide: AuthFacade,
          useValue: {
            authChallengeExpiresAt: () => Date.now() + 60_000,
            submitTwoFactor: vi.fn(),
            sendTwoFactorEmail: vi.fn(),
            cancelAuthChallenge: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TwoFactorPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector("bw-official-anonymous-shell auth-anon-layout")).not.toBeNull();
    expect(host.querySelector("bw-official-two-factor form[autocomplete='off']")).not.toBeNull();
    expect(host.querySelector("bw-official-two-factor-authenticator bit-form-field")).not.toBeNull();
    expect(host.querySelector("bw-official-two-factor-authenticator input[bitinput]")).not.toBeNull();
    expect(host.querySelector(".macos-two-factor-remember input[bitcheckbox]")) .not.toBeNull();
    expect(host.querySelector("bit-form-control input[bitcheckbox]")) .toBeNull();
    expect(host.querySelector("button[bitbutton][data-testid='two-factor-continue']")).not.toBeNull();
    expect(host.querySelector(".official-login-challenge-content")).toBeNull();
  });

  it("makes the rendered remember-device label a 44px click target while keeping its checkbox compact", async () => {
    const cleanupCss = installChallengeVisualCss();
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "twoFactor",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
      providers: ["0"],
    });

    await TestBed.configureTestingModule({
      imports: [TwoFactorPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        { provide: AuthFacade, useValue: twoFactorAuthFacade() },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TwoFactorPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const label = host.querySelector<HTMLLabelElement>("label.macos-two-factor-remember");
    const checkbox = label?.querySelector<HTMLInputElement>('input[type="checkbox"][bitcheckbox]');

    try {
      expect(label).not.toBeNull();
      expect(checkbox).not.toBeNull();
      expect(getComputedStyle(label!).display).toBe("inline-flex");
      expect(getComputedStyle(label!).minHeight).toBe("44px");
      expect(getComputedStyle(checkbox!).width).toBe("24px");
      expect(getComputedStyle(checkbox!).height).toBe("24px");

      expect(checkbox!.checked).toBe(false);
      label!.click();
      fixture.detectChanges();
      expect(checkbox!.checked).toBe(true);
    } finally {
      fixture.destroy();
      cleanupCss();
    }
  });

  it("updates the verification-code control only once for each typed character", async () => {
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "twoFactor",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
      providers: ["0"],
    });

    await TestBed.configureTestingModule({
      imports: [TwoFactorPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        { provide: AuthFacade, useValue: twoFactorAuthFacade() },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TwoFactorPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const component = fixture.debugElement.query(By.directive(OfficialTwoFactorComponent))
      .componentInstance as OfficialTwoFactorComponent;
    const values: string[] = [];
    component.tokenFormControl.valueChanges.subscribe((value) => values.push(value ?? ""));

    const input = host.querySelector<HTMLInputElement>("bw-official-two-factor-authenticator input")!;
    input.value = "1";
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new KeyboardEvent("keyup", { key: "1" }));

    expect(values).toEqual(["1"]);
  });

  it("uses macOS auth control hooks for two-factor and new-device challenges", async () => {
    const twoFactorStore = new PopupStateStore();
    twoFactorStore.setAuthChallenge({
      type: "twoFactor",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
      providers: ["0"],
    });
    await TestBed.configureTestingModule({
      imports: [TwoFactorPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: twoFactorStore },
        { provide: AuthFacade, useValue: twoFactorAuthFacade() },
      ],
    }).compileComponents();
    const twoFactor = TestBed.createComponent(TwoFactorPageComponent);
    twoFactor.detectChanges();
    const twoFactorHost = twoFactor.nativeElement as HTMLElement;
    expect(twoFactorHost.querySelector("bw-official-two-factor form.macos-auth-card")).not.toBeNull();
    expect(twoFactorHost.querySelector("[data-testid=two-factor-continue].macos-primary-action")).not.toBeNull();

    TestBed.resetTestingModule();
    const newDeviceStore = new PopupStateStore();
    newDeviceStore.setAuthChallenge({
      type: "newDevice",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
    });
    await TestBed.configureTestingModule({
      imports: [NewDeviceVerificationPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: newDeviceStore },
        { provide: AuthFacade, useValue: newDeviceAuthFacade() },
      ],
    }).compileComponents();
    const newDevice = TestBed.createComponent(NewDeviceVerificationPageComponent);
    newDevice.detectChanges();
    const newDeviceHost = newDevice.nativeElement as HTMLElement;
    expect(newDeviceHost.querySelector("bw-official-new-device-verification form.macos-auth-card")).not.toBeNull();
    expect(newDeviceHost.querySelector("[data-testid=new-device-continue].macos-primary-action")).not.toBeNull();
  });

  it("gives challenge secondary actions continuous 44px rows without changing the primary", () => {
    const stylesheet = document.createElement("style");
    const stylesheetSource = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
      "utf8",
    );
    const fixtureStyles = postcss.parse(stylesheetSource).nodes
      .filter(
        (node) =>
          node.type === "rule" &&
          ((node as postcss.Rule).selector.includes(".macos-auth-card") ||
            (node as postcss.Rule).selector.includes(".macos-auth-validation") ||
            (node as postcss.Rule).selector.includes(".macos-primary-action") ||
            (node as postcss.Rule).selector === ":root"),
      )
      .map((node) => node.toString())
      .join("\n");
    const rootTokens = new Map<string, string>();
    postcss
      .parse(
        readFileSync(join(process.cwd(), "apps/menubar-tauri/src/styles/macos-tokens.css"), "utf8"),
      )
      .walkRules(":root", (rule) => {
        rule.walkDecls((declaration) => {
          if (declaration.prop.startsWith("--")) {
            rootTokens.set(declaration.prop, declaration.value);
          }
        });
      });
    // This probe proves the challenge-specific literal wins over the generic
    // primary action's important token declaration.
    rootTokens.set("--mac-control-min-size", "40px");
    const renderedStyles = postcss.parse(fixtureStyles);
    renderedStyles.walkDecls((declaration) => {
      declaration.value = declaration.value.replace(
        /var\((--[\w-]+)\)/g,
        (_match, token: string) => rootTokens.get(token) ?? _match,
      );
    });
    stylesheet.textContent = renderedStyles.toString();
    document.head.append(stylesheet);

    const card = document.createElement("form");
    card.className = "macos-auth-card";
    const primary = document.createElement("button");
    primary.className = "macos-primary-action";
    primary.dataset.testid = "two-factor-continue";
    card.append(primary);
    const secondaryActions = [
      "two-factor-other-method",
      "two-factor-back",
      "new-device-resend",
      "new-device-back",
    ].map((testId) => {
      const action = document.createElement("button");
      action.dataset.testid = testId;
      card.append(action);
      return action;
    });
    const validation = document.createElement("div");
    validation.className = "macos-auth-validation";
    document.body.append(card, validation);

    try {
      const primaryStyles = getComputedStyle(primary);
      expect(primaryStyles.minHeight).toBe("44px");
      expect(primaryStyles.backgroundColor).toBe("rgb(10, 102, 255)");
      for (const action of secondaryActions) {
        const styles = getComputedStyle(action);
        expect(styles.minHeight).toBe("44px");
        expect(styles.borderTopWidth).toBe("0px");
        expect(styles.borderBottomWidth).toBe("1px");
        expect(styles.borderTopLeftRadius).toBe("0");
        expect(styles.backgroundColor).toBe("rgba(0, 0, 0, 0)");
      }
      expect(getComputedStyle(secondaryActions[0]).color).toBe("rgb(10, 102, 255)");
      expect(getComputedStyle(secondaryActions[1]).color).toBe("rgb(83, 103, 132)");
      expect(getComputedStyle(secondaryActions[2]).color).toBe("rgb(10, 102, 255)");
      expect(getComputedStyle(secondaryActions[3]).color).toBe("rgb(83, 103, 132)");
      expect(getComputedStyle(validation).minHeight).toBe("0px");
    } finally {
      card.remove();
      validation.remove();
      stylesheet.remove();
    }
  });

  it("keeps real two-factor and new-device action hierarchies on their production wrappers", async () => {
    const cleanupCss = installChallengeVisualCss();
    const expectAction = (
      element: HTMLElement,
      expectedColor: string,
      expectedBackground: string,
    ): void => {
      const styles = getComputedStyle(element);
      expect(styles.minHeight, element.dataset.testid).toBe("44px");
      expect(styles.color, element.dataset.testid).toBe(expectedColor);
      expect(styles.backgroundColor, element.dataset.testid).toBe(expectedBackground);
    };

    const twoFactorStore = new PopupStateStore();
    twoFactorStore.setAuthChallenge({
      type: "twoFactor",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
      providers: ["0", "1"],
    });
    await TestBed.configureTestingModule({
      imports: [TwoFactorPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: twoFactorStore },
        { provide: AuthFacade, useValue: twoFactorAuthFacade() },
      ],
    }).compileComponents();
    const twoFactor = TestBed.createComponent(TwoFactorPageComponent);
    twoFactor.detectChanges();
    let twoFactorDestroyed = false;
    let newDeviceFixture: { destroy(): void } | null = null;
    const twoFactorHost = twoFactor.nativeElement as HTMLElement;
    const twoFactorPrimary = twoFactorHost.querySelector<HTMLElement>(
      '[data-testid="two-factor-continue"]',
    )!;
    const twoFactorWrapper = twoFactorPrimary.parentElement!;

    try {
      expect(twoFactorWrapper.classList.contains("tw-flex")).toBe(true);
      expect(twoFactorWrapper.classList.contains("tw-flex-col")).toBe(true);
      expect(twoFactorWrapper.classList.contains("tw-space-y-3")).toBe(true);
      expect(
        [...twoFactorWrapper.querySelectorAll<HTMLElement>("[data-testid]")]
          .map((element) => element.dataset.testid),
      ).toEqual(["two-factor-continue", "two-factor-other-method", "two-factor-back"]);
      expectAction(twoFactorPrimary, "rgb(251, 253, 255)", "rgb(10, 102, 255)");
      const otherMethod = twoFactorWrapper.querySelector<HTMLElement>(
        '[data-testid="two-factor-other-method"]',
      )!;
      const twoFactorBack = twoFactorWrapper.querySelector<HTMLElement>(
        '[data-testid="two-factor-back"]',
      )!;
      expectAction(otherMethod, "rgb(10, 102, 255)", "rgba(0, 0, 0, 0)");
      expectAction(twoFactorBack, "rgb(83, 103, 132)", "rgba(0, 0, 0, 0)");
      for (const secondary of [otherMethod, twoFactorBack]) {
        expect(getComputedStyle(secondary).borderBottomWidth).toBe("1px");
      }

      twoFactor.destroy();
      twoFactorDestroyed = true;
      TestBed.resetTestingModule();

      const newDeviceStore = new PopupStateStore();
      newDeviceStore.setAuthChallenge({
        type: "newDevice",
        email: "user@example.com",
        serverUrl: "https://bitwarden.example.com",
      });
      await TestBed.configureTestingModule({
        imports: [NewDeviceVerificationPageComponent],
        providers: [
          provideRouter([]),
          { provide: PopupStateStore, useValue: newDeviceStore },
          { provide: AuthFacade, useValue: newDeviceAuthFacade() },
        ],
      }).compileComponents();
      const newDevice = TestBed.createComponent(NewDeviceVerificationPageComponent);
      newDeviceFixture = newDevice;
      newDevice.detectChanges();
      const newDeviceHost = newDevice.nativeElement as HTMLElement;
      const newDevicePrimary = newDeviceHost.querySelector<HTMLElement>(
        '[data-testid="new-device-continue"]',
      )!;
      const newDeviceWrapper = newDevicePrimary.parentElement!;

      expect(newDeviceWrapper.classList.contains("tw-grid")).toBe(true);
      expect(newDeviceWrapper.classList.contains("tw-gap-3")).toBe(true);
      expect(
        [...newDeviceWrapper.querySelectorAll<HTMLElement>("[data-testid]")]
          .map((element) => element.dataset.testid),
      ).toEqual(["new-device-continue", "new-device-back"]);
      expect(
        [...newDeviceHost.querySelectorAll<HTMLElement>("form.macos-auth-card [data-testid]")]
          .map((element) => element.dataset.testid),
      ).toEqual(["new-device-resend", "new-device-continue", "new-device-back"]);
      expectAction(newDevicePrimary, "rgb(251, 253, 255)", "rgb(10, 102, 255)");
      const resend = newDeviceHost.querySelector<HTMLElement>('[data-testid="new-device-resend"]')!;
      const newDeviceBack = newDeviceWrapper.querySelector<HTMLElement>(
        '[data-testid="new-device-back"]',
      )!;
      expectAction(resend, "rgb(10, 102, 255)", "rgba(0, 0, 0, 0)");
      expectAction(newDeviceBack, "rgb(83, 103, 132)", "rgba(0, 0, 0, 0)");
      for (const secondary of [resend, newDeviceBack]) {
        expect(getComputedStyle(secondary).borderBottomWidth).toBe("1px");
      }
      newDevice.destroy();
      newDeviceFixture = null;
    } finally {
      if (!twoFactorDestroyed) {
        twoFactor.destroy();
      }
      newDeviceFixture?.destroy();
      cleanupCss();
    }
  });

  it("keeps a single-line two-factor error compact so every recovery action remains in the first viewport", async () => {
    const store = new PopupStateStore();
    const challenge = {
      type: "twoFactor",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
      providers: ["0", "1"],
    } as const;
    store.setAuthChallenge(challenge);
    store.setAuthChallengeError(challenge, "验证码无效。请重试。");

    await TestBed.configureTestingModule({
      imports: [TwoFactorPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        { provide: AuthFacade, useValue: twoFactorAuthFacade() },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TwoFactorPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const error = host.querySelector<HTMLElement>("[data-testid='two-factor-error']");

    expect(error).not.toBeNull();
    expect(error?.querySelector("header")).toBeNull();
    expect(error?.querySelector(".macos-alert-strip[role='alert']")).not.toBeNull();
    expect(error?.querySelectorAll("[role='alert']")).toHaveLength(1);
    expect(error?.textContent).toContain("验证码无效");
    expect(host.querySelector("[data-testid='two-factor-continue']")).not.toBeNull();
    expect(host.querySelector("[data-testid='two-factor-other-method']")).not.toBeNull();
    expect(host.querySelector("[data-testid='two-factor-back']")).not.toBeNull();
  });

  it("renders only the fixed unsupported-provider state when no retained provider is offered", async () => {
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "twoFactor",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
      providers: ["2", "3"],
    });

    await TestBed.configureTestingModule({
      imports: [TwoFactorPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        {
          provide: AuthFacade,
          useValue: {
            authChallengeExpiresAt: () => Date.now() + 60_000,
            submitTwoFactor: vi.fn(),
            sendTwoFactorEmail: vi.fn(),
            cancelAuthChallenge: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TwoFactorPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.textContent).toContain(
      "此账户已设置两步登录，但此浏览器不支持任何已配置的两步登录提供程序。",
    );
    expect(host.querySelector("[data-testid='two-factor-back']")).not.toBeNull();
    expect(host.querySelector("input")).toBeNull();
    expect(host.querySelector("[data-testid='two-factor-continue']")).toBeNull();
    expect(host.querySelector("[data-testid='two-factor-other-method']")).toBeNull();
  });

  it("passes the official remember-device checkbox through the retained challenge port", async () => {
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "twoFactor",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
      providers: ["0"],
    });
    const submitTwoFactor = vi.fn(async () => undefined);

    await TestBed.configureTestingModule({
      imports: [TwoFactorPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        {
          provide: AuthFacade,
          useValue: {
            authChallengeExpiresAt: () => Date.now() + 60_000,
            submitTwoFactor,
            sendTwoFactorEmail: vi.fn(),
            cancelAuthChallenge: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TwoFactorPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const remember = host.querySelector<HTMLInputElement>("input[bitcheckbox]")!;
    remember.click();
    const token = host.querySelector<HTMLInputElement>("input[bitinput][type='text']")!;
    token.value = "123456";
    token.dispatchEvent(new Event("input"));
    fixture.detectChanges();
    host.querySelector<HTMLButtonElement>("[data-testid='two-factor-continue']")!.click();
    await fixture.whenStable();

    expect(submitTwoFactor).toHaveBeenCalledWith({ provider: 0, token: "123456", remember: true });
  });

  it("uses the retained official options dialog to change providers", async () => {
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "twoFactor",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
      providers: ["0", "1"],
    });
    const sendTwoFactorEmail = vi.fn(async () => undefined);

    await TestBed.configureTestingModule({
      imports: [TwoFactorPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        {
          provide: AuthFacade,
          useValue: {
            authChallengeExpiresAt: () => Date.now() + 60_000,
            submitTwoFactor: vi.fn(),
            sendTwoFactorEmail,
            cancelAuthChallenge: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TwoFactorPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLButtonElement>("[data-testid='two-factor-other-method']")!.click();
    fixture.detectChanges();

    const dialog = host.querySelector("bw-official-two-factor-options dialog[open] form[bit-dialog]");
    expect(dialog).not.toBeNull();
    expect(dialog?.querySelectorAll("bit-item")).toHaveLength(2);
    dialog?.querySelector<HTMLButtonElement>("[data-provider='1']")?.click();
    await fixture.whenStable();

    expect(host.querySelector("bw-official-two-factor-email")).not.toBeNull();
    expect(sendTwoFactorEmail).toHaveBeenCalledOnce();
  });

  it("uses the first retained provider in server order as the official default", async () => {
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "twoFactor",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
      providers: ["1", "0"],
    });
    const sendTwoFactorEmail = vi.fn(async () => undefined);

    await TestBed.configureTestingModule({
      imports: [TwoFactorPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        {
          provide: AuthFacade,
          useValue: {
            authChallengeExpiresAt: () => Date.now() + 60_000,
            submitTwoFactor: vi.fn(),
            sendTwoFactorEmail,
            cancelAuthChallenge: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TwoFactorPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector("bw-official-two-factor-email")).not.toBeNull();
    expect(host.querySelector("bw-official-two-factor-authenticator")).toBeNull();
    expect(sendTwoFactorEmail).toHaveBeenCalledOnce();
  });

  it("suppresses duplicate official challenge submissions", async () => {
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "twoFactor",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
      providers: ["0"],
    });
    const gate = deferred<void>();
    const submitTwoFactor = vi.fn(async () => gate.promise);

    await TestBed.configureTestingModule({
      imports: [TwoFactorPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        {
          provide: AuthFacade,
          useValue: {
            authChallengeExpiresAt: () => Date.now() + 60_000,
            submitTwoFactor,
            sendTwoFactorEmail: vi.fn(),
            cancelAuthChallenge: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TwoFactorPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const input = host.querySelector<HTMLInputElement>("input[bitinput][type='text']")!;
    input.value = "123456";
    input.dispatchEvent(new Event("input"));
    fixture.detectChanges();
    const submit = host.querySelector<HTMLButtonElement>("[data-testid='two-factor-continue']")!;
    submit.click();
    submit.click();
    await Promise.resolve();

    expect(submitTwoFactor).toHaveBeenCalledOnce();
    gate.resolve();
    await fixture.whenStable();
  });

  it("submits a pasted authenticator token once and clears it", async () => {
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "twoFactor",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
      providers: ["0"],
    });
    const submitTwoFactor = vi.fn(async () => undefined);

    await TestBed.configureTestingModule({
      imports: [TwoFactorPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        {
          provide: AuthFacade,
          useValue: {
            authChallengeExpiresAt: () => Date.now() + 60_000,
            submitTwoFactor,
            sendTwoFactorEmail: vi.fn(),
            cancelAuthChallenge: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TwoFactorPageComponent);
    fixture.detectChanges();
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>("input[bitinput][type='text']")!;
    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(input.getAttribute("autocapitalize")).toBe("none");
    expect(input.getAttribute("autocorrect")).toBe("none");
    expect(input.outerHTML).toContain('spellcheck="false"');
    const paste = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(paste, "clipboardData", { value: { getData: () => " 654321 " } });
    input.dispatchEvent(paste);
    await fixture.whenStable();

    expect(submitTwoFactor).toHaveBeenCalledOnce();
    expect(submitTwoFactor).toHaveBeenCalledWith({ provider: 0, token: "654321", remember: false });
    expect(input.value).toBe("");
  });

  it("cancels an unresolved submit when the official route is destroyed", async () => {
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "twoFactor",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
      providers: ["0"],
    });
    const gate = deferred<void>();
    const cancelAuthChallenge = vi.fn(() => store.clearAuthChallenge());

    await TestBed.configureTestingModule({
      imports: [TwoFactorPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        {
          provide: AuthFacade,
          useValue: {
            authChallengeExpiresAt: () => Date.now() + 60_000,
            submitTwoFactor: vi.fn(async () => gate.promise),
            sendTwoFactorEmail: vi.fn(),
            cancelAuthChallenge,
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TwoFactorPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const input = host.querySelector<HTMLInputElement>("input[bitinput][type='text']")!;
    input.value = "123456";
    input.dispatchEvent(new Event("input"));
    fixture.detectChanges();
    host.querySelector<HTMLButtonElement>("[data-testid='two-factor-continue']")!.click();
    await Promise.resolve();
    fixture.destroy();
    gate.resolve();
    await Promise.resolve();

    expect(cancelAuthChallenge).toHaveBeenCalledOnce();
    expect(store.snapshot().authChallenge).toBeNull();
  });

  it("cancels an unresolved two-factor submit after challenge state was cleared", async () => {
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "twoFactor",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
      providers: ["0"],
    });
    const gate = deferred<"twoFactor">();
    const cancelAuthChallenge = vi.fn();

    await TestBed.configureTestingModule({
      imports: [TwoFactorPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        {
          provide: AuthFacade,
          useValue: twoFactorAuthFacade({
            submitTwoFactor: vi.fn(() => gate.promise),
            cancelAuthChallenge,
          }),
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TwoFactorPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const input = host.querySelector<HTMLInputElement>("input[bitinput][type='text']")!;
    input.value = "123456";
    input.dispatchEvent(new Event("input"));
    fixture.detectChanges();
    host.querySelector<HTMLButtonElement>("[data-testid='two-factor-continue']")!.click();
    await Promise.resolve();
    store.clearAuthChallenge();
    fixture.destroy();

    expect(cancelAuthChallenge).toHaveBeenCalledOnce();
    gate.resolve("twoFactor");
    await Promise.resolve();
  });

  it("cancels a settled but still-active challenge when the route is destroyed", async () => {
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "twoFactor",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
      providers: ["0"],
    });
    const cancelAuthChallenge = vi.fn(() => store.clearAuthChallenge());

    await TestBed.configureTestingModule({
      imports: [TwoFactorPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        {
          provide: AuthFacade,
          useValue: {
            authChallengeExpiresAt: () => Date.now() + 60_000,
            submitTwoFactor: vi.fn(async () => undefined),
            sendTwoFactorEmail: vi.fn(),
            cancelAuthChallenge,
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TwoFactorPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const input = host.querySelector<HTMLInputElement>("input[bitinput][type='text']")!;
    input.value = "bad-code";
    input.dispatchEvent(new Event("input"));
    fixture.detectChanges();
    host.querySelector<HTMLButtonElement>("[data-testid='two-factor-continue']")!.click();
    await fixture.whenStable();
    expect(store.snapshot().authChallenge?.type).toBe("twoFactor");

    fixture.destroy();

    expect(cancelAuthChallenge).toHaveBeenCalledOnce();
    expect(store.snapshot().authChallenge).toBeNull();
  });

  it("keeps a successful unlock and reports only navigation failure when vault routing rejects", async () => {
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "twoFactor",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
      providers: ["0"],
    });
    const submitTwoFactor = vi.fn(async () => store.setUnlocked("user@example.com"));

    await TestBed.configureTestingModule({
      imports: [TwoFactorPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        {
          provide: AuthFacade,
          useValue: {
            authChallengeExpiresAt: () => Date.now() + 60_000,
            submitTwoFactor,
            sendTwoFactorEmail: vi.fn(),
            cancelAuthChallenge: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TwoFactorPageComponent);
    const router = TestBed.inject(Router);
    vi.spyOn(router, "navigateByUrl").mockRejectedValue(new Error("route failed"));
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const input = host.querySelector<HTMLInputElement>("input[bitinput][type='text']")!;
    input.value = "123456";
    input.dispatchEvent(new Event("input"));
    fixture.detectChanges();
    host.querySelector<HTMLButtonElement>("[data-testid='two-factor-continue']")!.click();
    await fixture.whenStable();

    expect(submitTwoFactor).toHaveBeenCalledOnce();
    expect(store.snapshot().isUnlocked).toBe(true);
    expect(store.snapshot().authChallenge).toBeNull();
    expect(store.snapshot().loginError).toBe("");
    expect(store.snapshot().statusMessage).toBe("无法打开下一页。请重试。");
  });

  it("submits the provider selected by the user", async () => {
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "twoFactor",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
      providers: ["1", "0"],
    });
    const submissions: unknown[] = [];

    await TestBed.configureTestingModule({
      imports: [TwoFactorPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        {
          provide: AuthFacade,
          useValue: twoFactorAuthFacade({
            submitTwoFactor: async (request: unknown) => submissions.push(request),
            sendTwoFactorEmail: async () => undefined,
          }),
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TwoFactorPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLButtonElement>("[data-testid='two-factor-other-method']")!.click();
    fixture.detectChanges();
    host.querySelector<HTMLButtonElement>("[data-provider='0']")!.click();
    fixture.detectChanges();
    const input = host.querySelector<HTMLInputElement>("input[type='text']")!;
    input.value = "123456";
    input.dispatchEvent(new Event("input"));
    fixture.detectChanges();
    host.querySelector<HTMLButtonElement>("[data-testid='two-factor-continue']")!.click();
    await fixture.whenStable();

    expect(submissions).toEqual([{ provider: 0, token: "123456", remember: false }]);
  });

  it("automatically sends and can resend the official email provider code", async () => {
    window.location.hash = "#/2fa";
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "twoFactor",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
      providers: ["1"],
    });
    const sendTwoFactorEmail = vi.fn(async () => undefined);

    await TestBed.configureTestingModule({
      imports: [TwoFactorPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        {
          provide: AuthFacade,
          useValue: twoFactorAuthFacade({ sendTwoFactorEmail }),
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TwoFactorPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const resend = (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-testid="two-factor-email-resend"]');
    expect(sendTwoFactorEmail).toHaveBeenCalledTimes(1);
    expect(resend?.textContent).toContain("重新发送代码");

    resend!.click();
    await fixture.whenStable();
    expect(sendTwoFactorEmail).toHaveBeenCalledTimes(2);
    expect(window.location.hash).toBe("#/2fa");
  });

  it("sends the email code when the user switches from authenticator to email", async () => {
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "twoFactor",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
      providers: ["0", "1"],
    });
    const sendTwoFactorEmail = vi.fn(async () => undefined);

    await TestBed.configureTestingModule({
      imports: [TwoFactorPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        {
          provide: AuthFacade,
          useValue: twoFactorAuthFacade({ sendTwoFactorEmail }),
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TwoFactorPageComponent);
    fixture.detectChanges();
    expect(sendTwoFactorEmail).not.toHaveBeenCalled();

    const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLButtonElement>("[data-testid='two-factor-other-method']")!.click();
    fixture.detectChanges();
    host.querySelector<HTMLButtonElement>("[data-provider='1']")!.click();
    await fixture.whenStable();
    expect(sendTwoFactorEmail).toHaveBeenCalledTimes(1);
  });

  it("renders sanitized email delivery failure feedback", async () => {
    const store = new PopupStateStore();
    const challenge = {
      type: "twoFactor" as const,
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
      providers: ["1"],
    };
    store.setAuthChallengeError(challenge, "无法发送验证码邮件。请重试。");

    await TestBed.configureTestingModule({
      imports: [TwoFactorPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        {
          provide: AuthFacade,
          useValue: twoFactorAuthFacade(),
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TwoFactorPageComponent);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')?.textContent)
      .toContain("无法发送验证码邮件。请重试。");
  });

  it("renders email delivery success feedback", async () => {
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "twoFactor",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
      providers: ["1"],
    });
    store.setStatus("验证码邮件已发送。");

    await TestBed.configureTestingModule({
      imports: [TwoFactorPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        {
          provide: AuthFacade,
          useValue: twoFactorAuthFacade(),
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TwoFactorPageComponent);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="status"]')?.textContent)
      .toContain("验证码邮件已发送。");
  });

  it("keeps a successful two-factor OTP stable until route takeover", async () => {
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "twoFactor",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
      providers: ["0"],
    });
    const submitTwoFactor = vi.fn(async () => {
      store.setUnlocked("user@example.com");
      return "unlocked" as const;
    });

    await TestBed.configureTestingModule({
      imports: [TwoFactorPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        { provide: AuthFacade, useValue: twoFactorAuthFacade({ submitTwoFactor }) },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TwoFactorPageComponent);
    const router = TestBed.inject(Router);
    const navigateByUrl = vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const input = host.querySelector<HTMLInputElement>("input[type='text']")!;
    input.value = "123456";
    input.dispatchEvent(new Event("input"));
    fixture.detectChanges();
    host.querySelector<HTMLButtonElement>("[data-testid='two-factor-continue']")!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(navigateByUrl).toHaveBeenCalledWith("/tabs/vault");
    expect(input.value).toBe("123456");
    expect(host.textContent).not.toContain("必须输入内容");

    const component = fixture.debugElement.query(By.directive(OfficialTwoFactorComponent))
      .componentInstance as OfficialTwoFactorComponent;
    fixture.destroy();
    expect(component.tokenFormControl.value).toBe("");
  });

  it("clears the pending two-factor challenge before returning to login", async () => {
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "twoFactor",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
      providers: ["0", "1"],
    });
    const cancelAuthChallenge = vi.fn(() => {
      store.clearAuthChallenge();
    });

    await TestBed.configureTestingModule({
      imports: [TwoFactorPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        {
          provide: AuthFacade,
          useValue: twoFactorAuthFacade({
            submitTwoFactor: async () => undefined,
            cancelAuthChallenge,
          }),
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TwoFactorPageComponent);
    const router = TestBed.inject(Router);
    const navigateByUrl = vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[data-testid="two-factor-back"]')?.tagName).toBe("BUTTON");
    host.querySelector<HTMLButtonElement>('[data-testid="two-factor-back"]')!.click();
    await fixture.whenStable();

    expect(cancelAuthChallenge).toHaveBeenCalledTimes(1);
    expect(navigateByUrl).toHaveBeenCalledWith("/login");
    expect(store.snapshot().authChallenge).toBeNull();
  });

  it("falls back to the hash login route when two-factor back navigation fails", async () => {
    window.location.hash = "#/challenge";
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "twoFactor",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
      providers: ["0"],
    });
    const cancelAuthChallenge = vi.fn(() => {
      store.clearAuthChallenge();
    });

    await TestBed.configureTestingModule({
      imports: [TwoFactorPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        {
          provide: AuthFacade,
          useValue: twoFactorAuthFacade({
            submitTwoFactor: async () => undefined,
            cancelAuthChallenge,
          }),
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TwoFactorPageComponent);
    const router = TestBed.inject(Router);
    vi.spyOn(router, "navigateByUrl").mockResolvedValue(false);
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="two-factor-back"]')!.click();
    await fixture.whenStable();

    expect(cancelAuthChallenge).toHaveBeenCalledTimes(1);
    expect(store.snapshot().authChallenge).toBeNull();
    expect(window.location.hash).toBe("#/login");
  });

  it("does not navigate to vault when a canceled two-factor submit resolves late", async () => {
    const priorStore = new PopupStateStore();
    priorStore.setServerUrl("https://vault.current.example.com");
    priorStore.setActiveSession({
      environment: buildBitwardenEnvironment(),
      token: {
        accessToken: "current",
        refreshToken: "refresh",
        tokenType: "Bearer",
        expiresIn: 3600,
      },
    });
    priorStore.setUnlocked("current@example.com");
    const baseline = priorStore.snapshot();
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "twoFactor",
      email: "attempt@example.com",
      serverUrl: "https://bitwarden.example.com",
      providers: ["0"],
    });
    const submitGate = deferred<void>();
    const submitTwoFactor = vi.fn(async () => submitGate.promise);
    const cancelAuthChallenge = vi.fn(() => {
      store.restore(baseline);
    });

    await TestBed.configureTestingModule({
      imports: [TwoFactorPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        {
          provide: AuthFacade,
          useValue: twoFactorAuthFacade({
            submitTwoFactor,
            cancelAuthChallenge,
          }),
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TwoFactorPageComponent);
    const router = TestBed.inject(Router);
    const navigateByUrl = vi.spyOn(router, "navigateByUrl").mockImplementation(async () => true);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const input = host.querySelector<HTMLInputElement>("input[type='text']")!;
    input.value = "123456";
    input.dispatchEvent(new Event("input"));
    fixture.detectChanges();
    host.querySelector<HTMLButtonElement>("[data-testid='two-factor-continue']")!.click();
    await Promise.resolve();
    host.querySelector<HTMLButtonElement>('[data-testid="two-factor-back"]')!.click();
    await fixture.whenStable();

    submitGate.resolve();
    await fixture.whenStable();

    expect(cancelAuthChallenge).toHaveBeenCalledTimes(1);
    expect(navigateByUrl).toHaveBeenCalledWith("/login");
    expect(navigateByUrl).not.toHaveBeenCalledWith("/tabs/vault");
    expect(store.snapshot()).toMatchObject({
      email: "current@example.com",
      serverUrl: "https://vault.current.example.com",
      isUnlocked: true,
      authChallenge: null,
    });
  });

  it("keeps the prior active account and avoids vault navigation when cancel wins during guarded save persistence", async () => {
    const store = new PopupStateStore();
    const host = new PendingIndexWriteHost();
    const accountStore = new AccountSessionStore(host);
    await accountStore.saveAccount({
      email: "current@example.com",
      serverUrl: "https://vault.current.example.com",
      session: authSession(jwt({ sub: "current-account" })),
    });
    store.setLockedAccount("current@example.com", "https://vault.current.example.com");
    host.deferNextIndexWrite();
    const login = vi.fn(async (request: any) => {
      if (!request.twoFactor) {
        throw new Error(JSON.stringify({ TwoFactorProviders2: { 0: null } }));
      }

      return authSession(jwt({ sub: "attempt-account" }));
    });
    const sync = vi.fn(async () => ({
      cipherCount: 0,
      encryptedCipherCount: 0,
      folderCount: 0,
      items: [],
      archivedItems: [],
      deletedItems: [],
      folders: [],
      organizations: [],
      collections: [],
      sends: [],
      sendCount: 0,
    }));
    const auth = new AuthFacade(store, { login }, { sync }, null, undefined, accountStore);
    await auth.login({
      email: "attempt@example.com",
      masterPassword: "secret",
      serverUrl: "https://vault.attempt.example.com",
    });

    await TestBed.configureTestingModule({
      imports: [TwoFactorPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        { provide: AuthFacade, useValue: auth },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TwoFactorPageComponent);
    const router = TestBed.inject(Router);
    const navigateByUrl = vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);
    fixture.detectChanges();
    const hostElement = fixture.nativeElement as HTMLElement;
    const input = hostElement.querySelector<HTMLInputElement>("input[type='text']")!;
    input.value = "123456";
    input.dispatchEvent(new Event("input"));
    fixture.detectChanges();
    hostElement.querySelector<HTMLButtonElement>("[data-testid='two-factor-continue']")!.click();
    await host.pendingIndexWrite.promise;
    hostElement.querySelector<HTMLButtonElement>('[data-testid="two-factor-back"]')!.click();
    await fixture.whenStable();
    host.release();
    await fixture.whenStable();

    expect(navigateByUrl).toHaveBeenCalledWith("/login");
    expect(navigateByUrl).not.toHaveBeenCalledWith("/tabs/vault");
    expect(await accountStore.list()).toEqual([
      expect.objectContaining({
        email: "current@example.com",
        serverUrl: "https://vault.current.example.com",
        isActive: true,
      }),
    ]);
    expect(await accountStore.readSession("attempt-account")).toBeNull();
    expect(store.snapshot()).toMatchObject({
      email: "current@example.com",
      serverUrl: "https://vault.current.example.com",
      isUnlocked: false,
      activeSession: null,
      authChallenge: null,
    });
  });

  it("submits the only supported two-factor provider without redundant selection controls", async () => {
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "twoFactor",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
      providers: ["0"],
    });
    const submissions: unknown[] = [];

    await TestBed.configureTestingModule({
      imports: [TwoFactorPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        {
          provide: AuthFacade,
          useValue: twoFactorAuthFacade({
            submitTwoFactor: async (request: unknown) => submissions.push(request),
          }),
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TwoFactorPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector("input[type='radio']")).toBeNull();
    const input = host.querySelector<HTMLInputElement>("input[type='text']")!;
    input.value = "123456";
    input.dispatchEvent(new Event("input"));
    fixture.detectChanges();
    host.querySelector<HTMLButtonElement>("[data-testid='two-factor-continue']")!.click();
    await fixture.whenStable();

    expect(submissions).toEqual([{ provider: 0, token: "123456", remember: false }]);
  });

  it("renders the official new-device verification route shell", async () => {
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "newDevice",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
    });

    await TestBed.configureTestingModule({
      imports: [NewDeviceVerificationPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        { provide: AuthFacade, useValue: newDeviceAuthFacade() },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(NewDeviceVerificationPageComponent);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("user@example.com");
    expect(text).toContain("验证码");
    expect(text).toContain("继续登录");
    expect(text).toContain("重新发送代码");
    expect((fixture.nativeElement as HTMLElement).querySelector("input")?.hasAttribute("disabled")).toBe(false);
    expect((fixture.nativeElement as HTMLElement).querySelector("bw-official-new-device-verification form")).not.toBeNull();
  });

  it("submits a new-device OTP through AuthFacade", async () => {
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "newDevice",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
    });
    const submissions: string[] = [];

    await TestBed.configureTestingModule({
      imports: [NewDeviceVerificationPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        {
          provide: AuthFacade,
          useValue: newDeviceAuthFacade({
            submitNewDeviceOtp: async (otp: string) => submissions.push(otp),
          }),
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(NewDeviceVerificationPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const input = host.querySelector<HTMLInputElement>("input")!;
    input.value = "654321";
    input.dispatchEvent(new Event("input"));
    fixture.detectChanges();
    host.querySelector<HTMLButtonElement>("[data-testid='new-device-continue']")!.click();
    await fixture.whenStable();

    expect(submissions).toEqual(["654321"]);
  });

  it("keeps a successful new-device OTP stable until route takeover", async () => {
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "newDevice",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
    });
    const submitNewDeviceOtp = vi.fn(async () => {
      store.setUnlocked("user@example.com");
      return "unlocked" as const;
    });

    await TestBed.configureTestingModule({
      imports: [NewDeviceVerificationPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        { provide: AuthFacade, useValue: newDeviceAuthFacade({ submitNewDeviceOtp }) },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(NewDeviceVerificationPageComponent);
    const router = TestBed.inject(Router);
    const navigateByUrl = vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const input = host.querySelector<HTMLInputElement>("input")!;
    input.value = "654321";
    input.dispatchEvent(new Event("input"));
    fixture.detectChanges();
    host.querySelector<HTMLButtonElement>("[data-testid='new-device-continue']")!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(navigateByUrl).toHaveBeenCalledWith("/tabs/vault");
    expect(input.value).toBe("654321");
    expect(host.textContent).not.toContain("必须输入内容");

    const component = fixture.debugElement.query(
      By.directive(OfficialNewDeviceVerificationComponent),
    ).componentInstance as OfficialNewDeviceVerificationComponent;
    fixture.destroy();
    expect(component.formGroup.controls.code.value).toBe("");
  });

  it("keeps resend unavailable while submit owns the official new-device form, then recovers", async () => {
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "newDevice",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
    });
    const submitGate = deferred<void>();
    const submitNewDeviceOtp = vi.fn(async () => {
      if (submitNewDeviceOtp.mock.calls.length === 1) {
        await submitGate.promise;
        return;
      }
      store.setUnlocked("user@example.com");
    });
    const resendNewDeviceOtp = vi.fn(async () => undefined);

    await TestBed.configureTestingModule({
      imports: [NewDeviceVerificationPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        {
          provide: AuthFacade,
          useValue: newDeviceAuthFacade({ submitNewDeviceOtp, resendNewDeviceOtp }),
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(NewDeviceVerificationPageComponent);
    const router = TestBed.inject(Router);
    const navigateByUrl = vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const input = host.querySelector<HTMLInputElement>("input[type='text']")!;
    input.value = "654321";
    input.dispatchEvent(new Event("input"));
    fixture.detectChanges();
    const submit = host.querySelector<HTMLButtonElement>("[data-testid='new-device-continue']")!;
    const resend = host.querySelector<HTMLButtonElement>("[data-testid='new-device-resend']")!;
    const official = fixture.debugElement.query(By.directive(OfficialNewDeviceVerificationComponent))
      .componentInstance as OfficialNewDeviceVerificationComponent;

    submit.click();
    fixture.detectChanges();
    await official.resendOTP();
    expect(submitNewDeviceOtp).toHaveBeenCalledOnce();
    expect(resendNewDeviceOtp).not.toHaveBeenCalled();
    expect(submit.getAttribute("aria-disabled")).toBe("true");
    expect(resend.getAttribute("aria-disabled")).toBe("true");

    submitGate.resolve();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges(false);
    fixture.detectChanges(false);

    expect(official.disableRequestOTP).toBe(false);
    expect(submit.getAttribute("aria-disabled")).toBe("true");
    expect(resend.getAttribute("aria-disabled")).toBeNull();

    input.value = "654321";
    input.dispatchEvent(new Event("input"));
    fixture.detectChanges();
    expect(submit.getAttribute("aria-disabled")).toBeNull();
    submit.click();
    await fixture.whenStable();
    expect(submitNewDeviceOtp).toHaveBeenCalledTimes(2);
    expect(navigateByUrl).toHaveBeenCalledWith("/tabs/vault");
  });

  it("keeps submit unavailable while resend owns the official new-device form, then recovers", async () => {
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "newDevice",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
    });
    const resendGate = deferred<void>();
    const submitNewDeviceOtp = vi.fn(async () => {
      store.setUnlocked("user@example.com");
    });
    const resendNewDeviceOtp = vi.fn(async () => resendGate.promise);

    await TestBed.configureTestingModule({
      imports: [NewDeviceVerificationPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        { provide: AuthFacade, useValue: newDeviceAuthFacade({ submitNewDeviceOtp, resendNewDeviceOtp }) },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(NewDeviceVerificationPageComponent);
    const router = TestBed.inject(Router);
    const navigateByUrl = vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const input = host.querySelector<HTMLInputElement>("input[type='text']")!;
    input.value = "654321";
    input.dispatchEvent(new Event("input"));
    fixture.detectChanges();
    const submit = host.querySelector<HTMLButtonElement>("[data-testid='new-device-continue']")!;
    const resend = host.querySelector<HTMLButtonElement>("[data-testid='new-device-resend']")!;
    const official = fixture.debugElement.query(By.directive(OfficialNewDeviceVerificationComponent))
      .componentInstance as OfficialNewDeviceVerificationComponent;

    resend.click();
    fixture.detectChanges();
    await official.submit();
    expect(resendNewDeviceOtp).toHaveBeenCalledOnce();
    expect(submitNewDeviceOtp).not.toHaveBeenCalled();
    expect(submit.getAttribute("aria-disabled")).toBe("true");
    expect(resend.getAttribute("aria-disabled")).toBe("true");

    resendGate.resolve();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges(false);
    fixture.detectChanges(false);
    expect(official.disableRequestOTP).toBe(false);
    expect(official.formGroup.invalid).toBe(false);
    expect(store.snapshot().isLoggingIn).toBe(false);
    expect(fixture.debugElement.query(By.css("[data-testid='new-device-continue']"))
      .injector.get(ButtonComponent).disabled()).toBe(false);
    expect(submit.getAttribute("aria-disabled")).toBeNull();
    expect(resend.getAttribute("aria-disabled")).toBeNull();

    submit.click();
    await fixture.whenStable();
    expect(submitNewDeviceOtp).toHaveBeenCalledOnce();
    expect(navigateByUrl).toHaveBeenCalledWith("/tabs/vault");
  });

  it("hands a new-device submit to the two-factor route when Identity changes challenge type", async () => {
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "newDevice",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
    });
    const submitNewDeviceOtp = vi.fn(async () => {
      store.setAuthChallenge({
        type: "twoFactor",
        email: "user@example.com",
        serverUrl: "https://bitwarden.example.com",
        providers: ["0"],
      });
      return "twoFactor" as const;
    });
    const cancelAuthChallenge = vi.fn();

    await TestBed.configureTestingModule({
      imports: [NewDeviceVerificationPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        {
          provide: AuthFacade,
          useValue: newDeviceAuthFacade({ submitNewDeviceOtp, cancelAuthChallenge }),
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(NewDeviceVerificationPageComponent);
    const router = TestBed.inject(Router);
    const navigateByUrl = vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);
    fixture.detectChanges();
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>("input[type='text']")!;
    input.value = "654321";
    input.dispatchEvent(new Event("input"));
    fixture.detectChanges();
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>("[data-testid='new-device-continue']")!.click();
    await fixture.whenStable();

    expect(navigateByUrl).toHaveBeenCalledWith("/2fa");
    expect(cancelAuthChallenge).not.toHaveBeenCalled();
  });

  it("cancels a failed new-device handoff, returns to login, and rejects an old-form retry", async () => {
    const store = new PopupStateStore();
    const login = vi.fn(async (request: any) => {
      if (!request.newDeviceOtp) {
        throw new Error("new device verification required");
      }
      throw new Error(JSON.stringify({ TwoFactorProviders2: { 0: null } }));
    });
    const facade = new AuthFacade(store, { login });
    await facade.login({
      email: "user@example.test",
      masterPassword: "synthetic-master-password",
      serverUrl: "https://vault.example.test",
    });
    expect(store.snapshot().authChallenge).toMatchObject({ type: "newDevice" });

    await TestBed.configureTestingModule({
      imports: [NewDeviceVerificationPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        { provide: AuthFacade, useValue: facade },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(NewDeviceVerificationPageComponent);
    const router = TestBed.inject(Router);
    const navigateByUrl = vi.spyOn(router, "navigateByUrl").mockImplementation(async (destination) => {
      if (destination === "/2fa") {
        throw new Error("route failed");
      }
      return true;
    });
    fixture.detectChanges();
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>("input[type='text']")!;
    input.value = "654321";
    input.dispatchEvent(new Event("input"));
    fixture.detectChanges();
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>("[data-testid='new-device-continue']")!.click();
    await fixture.whenStable();

    expect(store.snapshot().statusMessage).toBe("无法打开下一页。请重试。");
    expect(navigateByUrl.mock.calls.map(([destination]) => destination)).toEqual(["/2fa", "/login"]);
    expect(store.snapshot().authChallenge).toBeNull();
    expect((facade as unknown as { pendingLoginRequest: unknown }).pendingLoginRequest).toBeNull();

    const callsBeforeRetry = login.mock.calls.length;
    input.value = "retry-old-form";
    input.dispatchEvent(new Event("input"));
    fixture.detectChanges();
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>("[data-testid='new-device-continue']")!.click();
    await fixture.whenStable();
    expect(login).toHaveBeenCalledTimes(callsBeforeRetry);
    expect(navigateByUrl).toHaveBeenCalledTimes(2);
  });

  it("routes an expired new-device owner back to login without requiring route reactivation", async () => {
    vi.useFakeTimers();
    try {
      const store = new PopupStateStore();
      store.setAuthChallenge({
        type: "newDevice",
        email: "user@example.com",
        serverUrl: "https://bitwarden.example.com",
      });
      const cancelAuthChallenge = vi.fn(() => store.clearAuthChallenge());

      await TestBed.configureTestingModule({
        imports: [NewDeviceVerificationPageComponent],
        providers: [
          provideRouter([]),
          { provide: PopupStateStore, useValue: store },
          {
            provide: AuthFacade,
            useValue: newDeviceAuthFacade({
              authChallengeExpiresAt: () => Date.now() + 25,
              cancelAuthChallenge,
            }),
          },
        ],
      }).compileComponents();

      const fixture = TestBed.createComponent(NewDeviceVerificationPageComponent);
      const router = TestBed.inject(Router);
      const navigateByUrl = vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);
      fixture.detectChanges();
      await vi.advanceTimersByTimeAsync(25);

      expect(navigateByUrl).toHaveBeenCalledWith("/login");
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels an unresolved new-device submit after challenge state was cleared", async () => {
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "newDevice",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
    });
    const gate = deferred<"newDevice">();
    const cancelAuthChallenge = vi.fn();

    await TestBed.configureTestingModule({
      imports: [NewDeviceVerificationPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        {
          provide: AuthFacade,
          useValue: newDeviceAuthFacade({
            submitNewDeviceOtp: vi.fn(() => gate.promise),
            cancelAuthChallenge,
          }),
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(NewDeviceVerificationPageComponent);
    fixture.detectChanges();
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>("input[type='text']")!;
    input.value = "654321";
    input.dispatchEvent(new Event("input"));
    fixture.detectChanges();
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>("[data-testid='new-device-continue']")!.click();
    await Promise.resolve();
    store.clearAuthChallenge();
    fixture.destroy();

    expect(cancelAuthChallenge).toHaveBeenCalledOnce();
    gate.resolve("newDevice");
    await Promise.resolve();
  });

  it("clears the pending new-device challenge before returning to login", async () => {
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "newDevice",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
    });
    const cancelAuthChallenge = vi.fn(() => {
      store.clearAuthChallenge();
    });

    await TestBed.configureTestingModule({
      imports: [NewDeviceVerificationPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        {
          provide: AuthFacade,
          useValue: newDeviceAuthFacade({ cancelAuthChallenge }),
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(NewDeviceVerificationPageComponent);
    const router = TestBed.inject(Router);
    const navigateByUrl = vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[data-testid="new-device-back"]')?.tagName).toBe("BUTTON");
    host.querySelector<HTMLButtonElement>('[data-testid="new-device-back"]')!.click();
    await fixture.whenStable();

    expect(cancelAuthChallenge).toHaveBeenCalledTimes(1);
    expect(navigateByUrl).toHaveBeenCalledWith("/login");
    expect(store.snapshot().authChallenge).toBeNull();
  });

  it("falls back to the hash login route when new-device back navigation rejects", async () => {
    window.location.hash = "#/challenge";
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "newDevice",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
    });
    const cancelAuthChallenge = vi.fn(() => {
      store.clearAuthChallenge();
    });

    await TestBed.configureTestingModule({
      imports: [NewDeviceVerificationPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        {
          provide: AuthFacade,
          useValue: newDeviceAuthFacade({ cancelAuthChallenge }),
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(NewDeviceVerificationPageComponent);
    const router = TestBed.inject(Router);
    vi.spyOn(router, "navigateByUrl").mockRejectedValue(new Error("navigation failed"));
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="new-device-back"]')!.click();
    await fixture.whenStable();

    expect(cancelAuthChallenge).toHaveBeenCalledTimes(1);
    expect(store.snapshot().authChallenge).toBeNull();
    expect(window.location.hash).toBe("#/login");
  });

  it("clears the new-device OTP and avoids vault navigation when cancel wins over a late submit", async () => {
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "newDevice",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
    });
    const submitGate = deferred<void>();
    const submitNewDeviceOtp = vi.fn(async () => submitGate.promise);
    const cancelAuthChallenge = vi.fn(() => {
      store.clearAuthChallenge();
    });

    await TestBed.configureTestingModule({
      imports: [NewDeviceVerificationPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        { provide: AuthFacade, useValue: newDeviceAuthFacade({ submitNewDeviceOtp, cancelAuthChallenge }) },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(NewDeviceVerificationPageComponent);
    const router = TestBed.inject(Router);
    const navigateByUrl = vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const input = host.querySelector<HTMLInputElement>("input[type='text']")!;
    input.value = "654321";
    input.dispatchEvent(new Event("input"));
    fixture.detectChanges();

    host.querySelector<HTMLButtonElement>('[data-testid="new-device-continue"]')!.click();
    await Promise.resolve();
    host.querySelector<HTMLButtonElement>('[data-testid="new-device-back"]')!.click();
    await fixture.whenStable();
    submitGate.resolve();
    await fixture.whenStable();

    expect(cancelAuthChallenge).toHaveBeenCalledTimes(1);
    expect(navigateByUrl).toHaveBeenCalledWith("/login");
    expect(navigateByUrl).not.toHaveBeenCalledWith("/tabs/vault");
    expect(input.value).toBe("");
  });
  it("renders the two-step login page title in English when English is active", async () => {
    TestBed.resetTestingModule();
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "twoFactor",
      email: "user@example.com",
      serverUrl: "https://vault.bitwarden.com",
      providers: ["0"],
    });
    await TestBed.configureTestingModule({
      imports: [TwoFactorPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: PopupStateStore, useValue: store },
        { provide: AuthFacade, useValue: twoFactorAuthFacade() },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(TwoFactorPageComponent);
    await fixture.componentInstance.i18n.setLocale("en-US");
    fixture.detectChanges();
    const shell = fixture.debugElement.query(By.directive(OfficialAnonymousShellComponent))
      .componentInstance as OfficialAnonymousShellComponent;

    expect(shell.pageTitle).toBe("Two-step login");
  });

  it("renders the new-device page title in English when English is active", async () => {
    TestBed.resetTestingModule();
    const store = new PopupStateStore();
    store.setAuthChallenge({
      type: "newDevice",
      email: "user@example.com",
      serverUrl: "https://vault.bitwarden.com",
    });
    await TestBed.configureTestingModule({
      imports: [NewDeviceVerificationPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: PopupStateStore, useValue: store },
        { provide: AuthFacade, useValue: newDeviceAuthFacade() },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(NewDeviceVerificationPageComponent);
    await fixture.componentInstance.i18n.setLocale("en-US");
    fixture.detectChanges();
    const shell = fixture.debugElement.query(By.directive(OfficialAnonymousShellComponent))
      .componentInstance as OfficialAnonymousShellComponent;

    expect(shell.pageTitle).toBe("Verify your identity");
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function authSession(accessToken: string) {
  return {
    environment: buildBitwardenEnvironment(),
    token: {
      accessToken,
      refreshToken: "refresh-token",
      tokenType: "Bearer",
      expiresIn: 3600,
    },
  };
}

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: object): string =>
    btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

  return `${encode({ alg: "none" })}.${encode(payload)}.signature`;
}

class MemoryHostApi implements HostApi {
  readonly values = new Map<string, string>();
  private readonly lockedAccountIds = new Set<string>();

  showPopup(): Promise<void> { return Promise.resolve(); }
  hidePopup(): Promise<void> { return Promise.resolve(); }
  copyText(): Promise<void> { return Promise.resolve(); }
  pasteText(): Promise<void> { return Promise.resolve(); }
  openUrl(): Promise<void> { return Promise.resolve(); }
  secureGet(key: string): Promise<string | null> { return Promise.resolve(this.values.get(key) ?? null); }
  secureSet(key: string, value: string): Promise<void> { this.values.set(key, value); return Promise.resolve(); }
  secureDelete(key: string): Promise<void> { this.values.delete(key); return Promise.resolve(); }
  getAccountLockIntents(): Promise<readonly string[]> { return Promise.resolve([...this.lockedAccountIds]); }
  setAccountLockIntents(accountIds: readonly string[], locked: boolean): Promise<void> {
    for (const accountId of accountIds) {
      if (locked) this.lockedAccountIds.add(accountId);
      else this.lockedAccountIds.delete(accountId);
    }
    return Promise.resolve();
  }
}

class PendingIndexWriteHost extends MemoryHostApi {
  readonly pendingIndexWrite = deferred<void>();
  private readonly pendingIndexRelease = deferred<void>();
  private deferred = false;
  private started = false;

  deferNextIndexWrite(): void {
    this.deferred = true;
  }

  release(): void {
    this.pendingIndexRelease.resolve();
  }

  override async secureSet(key: string, value: string): Promise<void> {
    await super.secureSet(key, value);
    if (this.deferred && key === "auth.accounts" && !this.started) {
      this.started = true;
      this.deferred = false;
      this.pendingIndexWrite.resolve();
      await this.pendingIndexRelease.promise;
    }
  }
}
