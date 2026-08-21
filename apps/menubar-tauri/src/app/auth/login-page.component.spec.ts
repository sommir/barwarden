import "zone.js";
import "@angular/compiler";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BrowserTestingModule, platformBrowserTesting } from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { provideRouter, Router } from "@angular/router";
import { BehaviorSubject, Observable, of } from "rxjs";
import postcss from "postcss";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PopupStateStore } from "../popup-state";
import { OfficialI18nService, type OfficialLocale } from "../official-ui/official-i18n.service";
import { ButtonComponent } from "../official-ui/official-components";
import { OfficialPasswordLoginComponent } from "../upstream-overlays/auth/login/official-password-login.component";
import { OfficialAnonymousShellComponent } from "../upstream-overlays/auth/anonymous/official-anonymous-shell.component";
import { LoginPageComponent } from "./login-page.component";
import { OfficialPasswordAuthAdapter } from "./official-password-auth.adapter";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) throw error;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function installLoginVisualCss(media: { readonly forcedColors?: boolean } = {}): {
  readonly exposeFocusVisible: (element: HTMLElement) => void;
  readonly cleanup: () => void;
} {
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
  productionCascade.walkAtRules("media", (rule) => {
    const active = rule.params === "(forced-colors: active)" && media.forcedColors === true;
    if (active) {
      rule.replaceWith(...(rule.nodes ?? []).map((node) => node.clone()));
    } else {
      rule.remove();
    }
  });
  productionCascade.walkAtRules("starting-style", (rule) => rule.remove());
  style.textContent = productionCascade.toString()
    .replace(/:focus-visible/g, '[data-production-focus-visible="true"]');
  document.head.append(style);
  const rootStyle = getComputedStyle(document.documentElement);
  style.textContent = style.textContent.replace(/var\((--[\w-]+)\)/g, (value, name) =>
    resolveCustomProperty(rootStyle.getPropertyValue(name).trim(), rootStyle, new Set([name]))
      || value,
  );

  return {
    exposeFocusVisible: (element) => element.dataset["productionFocusVisible"] = "true",
    cleanup: () => style.remove(),
  };
}

function resolveCustomProperty(
  value: string,
  rootStyle: CSSStyleDeclaration,
  seen: Set<string>,
): string {
  return value.replace(/var\((--[\w-]+)\)/g, (reference, name) => {
    if (seen.has(name)) return reference;
    const next = rootStyle.getPropertyValue(name).trim();
    if (!next) return reference;
    return resolveCustomProperty(next, rootStyle, new Set([...seen, name]));
  });
}

function visualCssHasRule(selector: string): boolean {
  return [...document.querySelectorAll<HTMLStyleElement>("style")]
    .some((style) => style.textContent?.includes(selector));
}

describe("LoginPageComponent", () => {
  beforeEach(() => {
    localStorage.clear();
    void new OfficialI18nService().setLocale("zh-CN");
  });

  async function createPage(options: {
    login?: (request: { email: string; masterPassword: string; serverUrl: string }) => Promise<"vault" | "twoFactor" | "newDeviceVerification">;
    rememberedEmail?: string;
    rememberedEmail$?: Observable<string>;
    rememberEmail?: (email: string, remember: boolean) => void;
    navigationEmail?: string;
    store?: PopupStateStore;
    locale?: OfficialLocale;
  } = {}) {
    TestBed.resetTestingModule();
    const store = options.store ?? new PopupStateStore();
    const auth = {
      rememberedEmail$: options.rememberedEmail$ ?? of(options.rememberedEmail ?? ""),
      login: vi.fn(options.login ?? (async () => "vault" as const)),
      cancel: vi.fn(),
      rememberEmail: vi.fn(options.rememberEmail ?? (() => undefined)),
      takeNavigationEmail: vi.fn(() => options.navigationEmail ?? ""),
      setNavigationEmail: vi.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [LoginPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        { provide: OfficialPasswordAuthAdapter, useValue: auth },
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(LoginPageComponent);
    if (options.locale) {
      await fixture.componentInstance.i18n.setLocale(options.locale);
    }
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    return {
      fixture,
      store,
      auth,
      router,
      official: fixture.debugElement.query(By.directive(OfficialPasswordLoginComponent))
        .componentInstance as OfficialPasswordLoginComponent,
    };
  }

  function enterPassword(official: OfficialPasswordLoginComponent, password = "master-password"): void {
    official.formGroup.controls.email.setValue("person@example.com");
    official.continuePressed();
    official.formGroup.controls.masterPassword.setValue(password);
  }

  it("owns the route through official form primitives and retains the upstream eight-character minimum", async () => {
    const { fixture, official } = await createPage();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector("bw-official-anonymous-shell")).not.toBeNull();
    expect(host.querySelector("bw-official-password-login form")).not.toBeNull();
    expect(host.querySelector("bit-form-field input[bitinput][data-testid=login-email-input]")).not.toBeNull();
    expect(host.querySelector("input[bitcheckbox][data-testid=login-remember-email]")).not.toBeNull();
    expect(host.querySelector("[data-testid=login-with-passkey-button]")).toBeNull();
    enterPassword(official, "short");
    expect(official.formGroup.controls.masterPassword.hasError("minlength")).toBe(true);
  });

  it("renders the login title in English when English is active", async () => {
    const { fixture } = await createPage({ locale: "en-US" });

    const shell = fixture.debugElement.query(By.directive(OfficialAnonymousShellComponent))
      .componentInstance as OfficialAnonymousShellComponent;
    expect(shell.pageTitle).toBe("Log in");
  });

  it("uses the macOS auth card and semantic control hooks without changing login form semantics", async () => {
    const { fixture } = await createPage();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector("bw-official-password-login form.macos-auth-card")).not.toBeNull();
    expect(host.querySelector("bit-form-field.macos-field")).not.toBeNull();
    expect(host.querySelector("[data-testid=login-continue-button].macos-primary-action")).not.toBeNull();
    expect(host.querySelector("form [data-testid=login-email-input]")).not.toBeNull();
  });

  it("mounts the active login stage with 44px owners, scalable visible paint, and one primary action", async () => {
    const visualCss = installLoginVisualCss();
    const { fixture, official } = await createPage();
    const host = fixture.nativeElement as HTMLElement;

    const assertActiveStage = (visiblePaint: "40px" | "36px") => {
      const activeStage = Array.from(
        host.querySelectorAll<HTMLElement>("form.macos-auth-card > div"),
      ).find((stage) => !stage.classList.contains("tw-hidden"))!;
      const field = activeStage.querySelector<HTMLElement>("bit-form-field")!;
      const owner = field.querySelector<HTMLElement>("[bitfieldcontainer]")!;
      const input = field.querySelector<HTMLInputElement>("input[bitinput]")!;
      const primary = activeStage.querySelector<HTMLButtonElement>(".macos-primary-action")!;

      expect(field.classList).toContain("macos-field-owner");
      expect(input.classList).toContain("macos-control-visible");
      expect(parseFloat(getComputedStyle(owner).minHeight)).toBeGreaterThanOrEqual(44);
      expect(getComputedStyle(input).height).toBe(visiblePaint);
      expect(primary.classList).toContain("macos-button-owner");
      expect(parseFloat(getComputedStyle(primary).minHeight)).toBeGreaterThanOrEqual(44);
      expect(activeStage.querySelectorAll(".macos-primary-action")).toHaveLength(1);
    };

    try {
      assertActiveStage("40px");

      document.documentElement.setAttribute("data-bw-compact-mode", "true");
      assertActiveStage("36px");

      document.documentElement.removeAttribute("data-bw-compact-mode");
      official.formGroup.controls.email.setValue("person@example.com");
      await official.continuePressed();
      fixture.detectChanges();
      assertActiveStage("40px");

      document.documentElement.style.fontSize = "200%";
      const scaledInput = host.querySelector<HTMLInputElement>(
        '[data-testid="login-master-password-input"]',
      )!;
      expect(parseFloat(getComputedStyle(scaledInput).minHeight)).toBeGreaterThanOrEqual(40);
      expect(getComputedStyle(scaledInput).overflow).not.toBe("hidden");
    } finally {
      document.documentElement.removeAttribute("data-bw-compact-mode");
      document.documentElement.style.removeProperty("font-size");
      fixture.destroy();
      visualCss.cleanup();
    }
  });

  it("keeps the focused login action owner ringless so the visible fill owns the single ring", async () => {
    const visualCss = installLoginVisualCss();
    const { fixture } = await createPage();
    const action = fixture.nativeElement.querySelector<HTMLButtonElement>(
      '[data-testid="login-continue-button"]',
    );

    try {
      expect(action).not.toBeNull();
      action!.focus();
      expect(document.activeElement).toBe(action);
      visualCss.exposeFocusVisible(action!);
      const styles = getComputedStyle(action!);
      expect(styles.outlineWidth).toBe("0px");
      expect(styles.outlineStyle).toBe("none");
      expect(styles.boxShadow).toBe("none");
      expect(visualCssHasRule(".macos-auth-card .macos-button-owner[data-production-focus-visible=\"true\"]")).toBe(true);
      expect(visualCssHasRule(".macos-button-owner[data-production-focus-visible=\"true\"]::before")).toBe(true);
    } finally {
      fixture.destroy();
      visualCss.cleanup();
    }
  });

  it("renders one 2px production focus ring on the real auth field container", async () => {
    const visualCss = installLoginVisualCss();
    const { fixture } = await createPage();
    const input = fixture.nativeElement.querySelector<HTMLInputElement>(
      '[data-testid="login-email-input"]',
    )!;
    const field = input.closest<HTMLElement>("[bitfieldcontainer]")!;

    try {
      input.focus();
      expect([
        getComputedStyle(input).outlineWidth,
        getComputedStyle(field).outlineWidth,
      ]).not.toContain("2px");
      visualCss.exposeFocusVisible(input);
      const inputStyle = getComputedStyle(input);
      const fieldStyle = getComputedStyle(field);
      expect(fieldStyle.outlineWidth).toBe("2px");
      expect(fieldStyle.outlineStyle).toBe("solid");
      expect(fieldStyle.outlineOffset).toBe("2px");
      expect(fieldStyle.boxShadow).toBe("none");
      expect(inputStyle.outlineStyle).toBe("none");
    } finally {
      fixture.destroy();
      visualCss.cleanup();
    }
  });

  it("keeps the real auth field focus ring visible in forced colors", async () => {
    const visualCss = installLoginVisualCss({ forcedColors: true });
    const { fixture } = await createPage();
    const input = fixture.nativeElement.querySelector<HTMLInputElement>(
      '[data-testid="login-email-input"]',
    )!;
    const field = input.closest<HTMLElement>("[bitfieldcontainer]")!;
    const probe = document.createElement("span");
    probe.style.outlineColor = "Highlight";
    document.body.append(probe);

    try {
      input.focus();
      visualCss.exposeFocusVisible(input);
      expect(getComputedStyle(field).outlineWidth).toBe("2px");
      expect(getComputedStyle(field).outlineColor).toBe(getComputedStyle(probe).outlineColor);
    } finally {
      probe.remove();
      fixture.destroy();
      visualCss.cleanup();
    }
  });

  it("renders one large Barwarden product title without a provider subtitle", async () => {
    const { fixture } = await createPage();
    const host = fixture.nativeElement as HTMLElement;
    const product = host.querySelector<HTMLElement>(".macos-auth-product");

    expect(product?.textContent?.trim()).toBe("Barwarden");
    expect(product?.querySelectorAll("strong")).toHaveLength(1);
    expect(product?.querySelector("span")).toBeNull();
    expect(product?.getAttribute("aria-label")).toBeNull();
    expect(host.textContent).not.toContain("Bitwarden 服务");
  });

  it("provides the login route with an in-flow semantic heading", async () => {
    const { fixture } = await createPage();
    const heading = fixture.nativeElement.querySelector<HTMLElement>(
      "bw-official-anonymous-shell auth-anon-layout h1, bw-official-anonymous-shell auth-anon-layout [role=heading]",
    );

    expect(heading?.textContent?.trim()).toBe("登录");
  });

  it("defines solid macOS auth controls with reserved feedback space and motion-safe loading", () => {
    const styles = readFileSync(join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"), "utf8");

    expect(styles).toContain(".macos-auth-page {");
    expect(styles).toContain("background: var(--mac-canvas);");
    expect(styles).toContain(".macos-auth-card {");
    expect(styles).toContain("width: min(100%, 360px);");
    expect(styles).toContain("bit-form-field [bitfieldcontainer]:has(:focus-visible)");
    expect(styles).toContain(".macos-auth-validation");
    expect(styles).toContain("min-block-size:");
    expect(styles).toContain(".macos-auth-identity");
    expect(styles).toContain("overflow-wrap: anywhere;");
    expect(styles).toContain(".macos-auth-skeleton");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toMatch(
      /\.macos-auth-product strong\s*{[^}]*font-size:\s*1\.5rem;[^}]*line-height:\s*1\.2;/s,
    );
  });

  it("uses a flat auth form and a continuous 52px environment row", () => {
    const stylesheet = document.createElement("style");
    const stylesheetSource = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
      "utf8",
    );
    const fixtureSelectors = [
      ".macos-auth-card",
      ".macos-auth-card input",
      "bw-login-environment-selector",
      'bw-login-environment-selector [bitTypography="body2"]',
      'bw-login-environment-selector [bitTypography="body2"] button',
    ];
    const fixtureStyles = postcss.parse(stylesheetSource).nodes
      .filter(
        (node) =>
          node.type === "rule" &&
          fixtureSelectors.some((selector) => (node as postcss.Rule).selector.includes(selector)),
      )
      .map((node) => node.toString())
      .join("\n");
    stylesheet.textContent = fixtureStyles;
    document.head.append(stylesheet);

    const authCard = document.createElement("form");
    authCard.className = "macos-auth-card";
    const input = document.createElement("input");
    const action = document.createElement("button");
    authCard.append(input, action);

    const environmentSelector = document.createElement("bw-login-environment-selector");
    const environmentRow = document.createElement("div");
    environmentRow.setAttribute("bitTypography", "body2");
    const environmentButton = document.createElement("button");
    environmentRow.append(environmentButton);
    environmentSelector.append(environmentRow);
    document.body.append(authCard, environmentSelector);

    try {
      const cardStyles = getComputedStyle(authCard);
      const inputStyles = getComputedStyle(input);
      const rowStyles = getComputedStyle(environmentRow);
      const environmentButtonStyles = getComputedStyle(environmentButton);

      expect(cardStyles.borderTopWidth).toBe("0px");
      expect(cardStyles.borderTopLeftRadius).toBe("0");
      expect(cardStyles.boxShadow).toBe("none");
      expect(cardStyles.paddingTop).toBe("0px");
      expect(inputStyles.borderRadius).toBe("10px");
      expect(getComputedStyle(environmentSelector).display).toBe("block");
      expect(rowStyles.minHeight).toBe("52px");
      expect(rowStyles.borderTopLeftRadius).toBe("0");
      expect(environmentButtonStyles.minHeight).toBe("44px");
    } finally {
      authCard.remove();
      environmentSelector.remove();
      stylesheet.remove();
    }
  });

  it("keeps invalid email on the email stage and focuses the master-password field after a valid email submit", async () => {
    const { fixture, official } = await createPage();
    official.formGroup.controls.email.setValue("invalid");
    await official.submit();
    expect(official.loginUiState).toBe(official.LoginUiState.EMAIL_ENTRY);

    official.formGroup.controls.email.setValue("person@example.com");
    await official.submit();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    fixture.detectChanges();
    expect(official.loginUiState).toBe(official.LoginUiState.MASTER_PASSWORD_ENTRY);
    expect(document.activeElement).toBe(
      fixture.nativeElement.querySelector("[data-testid=login-master-password-input]"),
    );
  });

  it("focuses and fully describes the first invalid authentication field", async () => {
    const { fixture, official } = await createPage();
    const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLButtonElement>("[data-testid=login-continue-button]")!.focus();

    await official.submit();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    fixture.detectChanges();

    const email = host.querySelector<HTMLInputElement>("[data-testid=login-email-input]")!;
    const describedBy = email.getAttribute("aria-describedby");
    expect(document.activeElement).toBe(email);
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(describedBy).toBeTruthy();
    expect(host.querySelector(`#${describedBy}`)).not.toBeNull();
    expect(host.querySelector(`#${describedBy} .bwi-error`)?.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps password focus and selection while exposing a dynamic visibility name", async () => {
    const { fixture, official } = await createPage();
    official.formGroup.controls.email.setValue("person@example.com");
    await official.continuePressed();
    fixture.detectChanges();
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const input = host.querySelector<HTMLInputElement>(
      "[data-testid=login-master-password-input]",
    )!;
    const toggle = input.closest("bit-form-field")!
      .querySelector<HTMLButtonElement>("[data-testid=login-password-visibility]")!;
    input.value = "master-password";
    input.focus();
    input.setSelectionRange(3, 8);

    expect(toggle.getAttribute("aria-label")).toBe("显示密码");
    toggle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    toggle.click();
    fixture.detectChanges();
    await Promise.resolve();

    expect(input.type).toBe("text");
    expect(toggle.getAttribute("aria-label")).toBe("隐藏密码");
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([3, 8]);
  });

  it("clears stale credential feedback as the password is corrected", async () => {
    const store = new PopupStateStore();
    const { fixture, official } = await createPage({ store });
    official.formGroup.controls.email.setValue("person@example.com");
    await official.continuePressed();
    store.setLoginError("主密码无效。请重试。");
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector<HTMLInputElement>(
      "[data-testid=login-master-password-input]",
    )!;

    input.value = "next-attempt";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(store.snapshot().loginError).toBe("");
  });

  it("clears a stale startup error when a valid email advances to master-password entry", async () => {
    const store = new PopupStateStore();
    store.setLoginError("无法读取钥匙串中的账户信息。");
    const { official } = await createPage({ store });

    official.formGroup.controls.email.setValue("person@example.com");
    await official.continuePressed();

    expect(official.loginUiState).toBe(official.LoginUiState.MASTER_PASSWORD_ENTRY);
    expect(store.snapshot().loginError).toBe("");
  });

  it("preserves the email validation state while the environment menu takes focus", async () => {
    const { fixture, official } = await createPage();
    const host = fixture.nativeElement as HTMLElement;
    const email = official.formGroup.controls.email;
    const environmentTrigger = host.querySelector<HTMLButtonElement>(
      'bw-login-environment-selector button[aria-haspopup="menu"]',
    )!;

    expect(email.untouched).toBe(true);
    expect(email.pristine).toBe(true);
    environmentTrigger.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    email.markAsTouched();
    email.markAsDirty();
    environmentTrigger.click();
    fixture.detectChanges();
    await new Promise((resolve) => window.setTimeout(resolve));
    fixture.detectChanges();

    expect(email.untouched).toBe(true);
    expect(email.pristine).toBe(true);
    expect(host.textContent).not.toContain("必须输入内容");
  });

  it("keeps the active login email when opting out of remembered-email persistence", async () => {
    const rememberedEmail$ = new BehaviorSubject("");
    const { official } = await createPage({
      rememberedEmail$,
      rememberEmail: (email, remember) => rememberedEmail$.next(remember ? email : ""),
    });
    official.formGroup.controls.email.setValue("person@example.com");
    official.formGroup.controls.rememberEmail.setValue(false);

    await official.continuePressed();

    expect(official.loginUiState).toBe(official.LoginUiState.MASTER_PASSWORD_ENTRY);
    expect(official.formGroup.controls.email.value).toBe("person@example.com");
  });

  it.each([
    ["invalid email", "invalid", true, "https://vault.bitwarden.com"],
    ["invalid environment", "person@example.com", false, "http://vault.example.test"],
    ["valid continuation", "person@example.com", true, "https://vault.bitwarden.com"],
  ])("clears hidden/autofilled master password before %s", async (_case, email, environmentIsValid, serverUrl) => {
    const { official } = await createPage();
    official.formGroup.controls.email.setValue(email);
    official.formGroup.controls.masterPassword.setValue("autofilled-secret");
    official.environmentIsValid = environmentIsValid;
    official.selectEnvironment(serverUrl);
    official.formGroup.controls.masterPassword.setValue("autofilled-secret");
    await official.submit();
    expect(official.formGroup.controls.masterPassword.value).toBe("");
  });

  it.each(["", "not a url", "http://vault.example.test"])
  ("rejects invalid or HTTP environments and clears a supplied master password: %s", async (serverUrl) => {
    const { official, auth } = await createPage();
    enterPassword(official);
    official.selectEnvironment(serverUrl);
    await official.submit();
    expect(auth.login).not.toHaveBeenCalled();
    expect(official.formGroup.controls.masterPassword.value).toBe("");
  });

  it("maps US, EU, and normalized self-hosted environments without persisting opted-out email", async () => {
    const { official, auth } = await createPage();
    official.formGroup.controls.email.setValue("person@example.com");
    official.formGroup.controls.rememberEmail.setValue(false);
    official.selectEnvironment("https://vault.example.test/");
    official.continuePressed();
    expect(auth.rememberEmail).toHaveBeenCalledWith("person@example.com", false);
    expect(localStorage.getItem("barwarden.login-email")).toBeNull();

    for (const serverUrl of ["https://vault.bitwarden.com", "https://vault.bitwarden.eu", "https://vault.example.test/"]) {
      official.backButtonClicked();
      official.selectEnvironment(serverUrl);
      enterPassword(official);
      await official.submit();
      expect(auth.login).toHaveBeenLastCalledWith(expect.objectContaining({ serverUrl }));
    }
  });

  it.each([
    ["invalid credentials", "主密码无效。请确认电子邮箱和服务器地址。"],
    ["TLS/network", "无法登录。请检查服务器连接后重试。"],
    ["timeout", "无法登录。请检查服务器连接后重试。"],
    ["rate limit", "无法登录。请检查服务器连接后重试。"],
    ["server failure", "无法登录。请检查服务器连接后重试。"],
  ])("renders retained fixed %s feedback and clears the password", async (_kind, message) => {
    const store = new PopupStateStore();
    const { fixture, official } = await createPage({
      store,
      login: async () => {
        store.setLoginError(message);
        return "vault";
      },
    });
    enterPassword(official);
    await official.submit();
    fixture.detectChanges();
    const callout = fixture.nativeElement.querySelector<HTMLElement>(
      "bit-callout[data-testid=login-error]",
    );
    expect(official.loginUiState).toBe(official.LoginUiState.MASTER_PASSWORD_ENTRY);
    expect(callout?.textContent).toContain(message);
    expect(callout?.closest("form.macos-auth-card")).not.toBeNull();
    callout?.querySelector<HTMLButtonElement>("[aria-label='关闭']")?.click();
    fixture.detectChanges();
    expect(store.snapshot().loginError).toBe("");
    expect(official.formGroup.controls.masterPassword.value).toBe("");
  });

  it("clears the password for validation failure and facade rejection", async () => {
    const invalid = await createPage();
    enterPassword(invalid.official, "short");
    await invalid.official.submit();
    expect(invalid.official.formGroup.controls.masterPassword.value).toBe("");

    const rejected = await createPage({ login: async () => { throw new Error("transport detail"); } });
    enterPassword(rejected.official);
    await rejected.official.submit();
    expect(rejected.official.formGroup.controls.masterPassword.value).toBe("");
    expect(rejected.store.snapshot().loginError).not.toContain("transport detail");
  });

  it("keeps a successful password login stable until route takeover", async () => {
    const successful = await createPage({
      login: async () => {
        successful.store.setUnlocked("person@example.com");
        return "vault";
      },
    });
    successful.router.navigateByUrl = vi.fn(async () => true);
    enterPassword(successful.official);
    await successful.official.submit();
    successful.fixture.detectChanges();

    expect(successful.official.formGroup.controls.masterPassword.value).toBe("master-password");
    expect(successful.fixture.nativeElement.textContent).not.toContain("必须输入内容");
    expect(
      successful.fixture.debugElement.query(By.css("[data-testid=login-submit-button]"))
        .injector.get(ButtonComponent).disabled(),
    ).toBe(true);

    successful.fixture.destroy();
    expect(successful.official.formGroup.controls.masterPassword.value).toBe("");
  });

  it.each([
    ["vault", "/tabs/vault", (store: PopupStateStore) => store.setUnlocked("person@example.com")],
    ["twoFactor", "/2fa", (store: PopupStateStore) => store.setAuthChallenge({ type: "twoFactor", email: "person@example.com", serverUrl: "https://vault.bitwarden.com", providers: ["0"] })],
    ["newDeviceVerification", "/new-device-verification", (store: PopupStateStore) => store.setAuthChallenge({ type: "newDevice", email: "person@example.com", serverUrl: "https://vault.bitwarden.com" })],
  ] as const)("routes only when the retained %s state matches", async (result, expectedRoute, applyState) => {
    const store = new PopupStateStore();
    const { official, router } = await createPage({ store, login: async () => { applyState(store); return result; } });
    const navigate = vi.fn(async () => true);
    router.navigateByUrl = navigate;
    enterPassword(official);
    await official.submit();
    expect(navigate).toHaveBeenCalledWith(expectedRoute);
  });

  it("deduplicates submit and suppresses a route-to-hint stale completion", async () => {
    const pending = deferred<"vault">();
    const store = new PopupStateStore();
    const { fixture, official, auth, router } = await createPage({ store, login: () => pending.promise });
    const navigate = vi.fn(async () => false);
    router.navigateByUrl = navigate;
    enterPassword(official);
    const first = official.submit();
    const duplicate = official.submit();
    expect(auth.login).toHaveBeenCalledOnce();
    official.goToHint();
    store.setUnlocked("person@example.com");
    pending.resolve("vault");
    await Promise.all([first, duplicate]);
    expect(navigate).not.toHaveBeenCalled();

  });

  it("suppresses destroyed, locked, account-switched, and store-stale completions", async () => {
    const destroyed = deferred<"vault">();
    const second = await createPage({ store: new PopupStateStore(), login: () => destroyed.promise });
    enterPassword(second.official);
    const request = second.official.submit();
    second.fixture.destroy();
    expect(second.auth.cancel).toHaveBeenCalledOnce();
    second.store.setUnlocked("person@example.com");
    destroyed.resolve("vault");
    await request;
    expect(second.router.url).not.toBe("/tabs/vault");

    for (const mutate of [
      (store: PopupStateStore) => store.setLockedAccount("person@example.com", "https://vault.bitwarden.com"),
      (store: PopupStateStore) => store.setLockedAccount("other@example.com", "https://vault.bitwarden.eu"),
      (store: PopupStateStore) => store.setServerUrl("https://vault.bitwarden.eu"),
    ]) {
      const pending = deferred<"vault">();
      const page = await createPage({ store: new PopupStateStore(), login: () => pending.promise });
      const navigate = vi.fn(async () => true);
      page.router.navigateByUrl = navigate;
      enterPassword(page.official);
      const submit = page.official.submit();
      mutate(page.store);
      pending.resolve("vault");
      await submit;
      expect(navigate).not.toHaveBeenCalled();
      expect(page.official.formGroup.controls.masterPassword.value).toBe("");
    }
  });

  it("contains navigation rejection without an unhandled promise or stale redirect", async () => {
    const store = new PopupStateStore();
    const { official, router } = await createPage({
      store,
      login: async () => { store.setUnlocked("person@example.com"); return "vault"; },
    });
    const navigate = vi.fn(async () => { throw new Error("route rejected"); });
    router.navigateByUrl = navigate;
    enterPassword(official);
    await expect(official.submit()).resolves.toBeUndefined();
    expect(navigate).toHaveBeenCalledWith("/tabs/vault");
  });

  it("surfaces a fixed navigation status when Router.navigateByUrl resolves false", async () => {
    const store = new PopupStateStore();
    const { official, router } = await createPage({
      store,
      login: async () => { store.setUnlocked("person@example.com"); return "vault"; },
    });
    router.navigateByUrl = vi.fn(async () => false);
    enterPassword(official);
    await official.submit();
    expect(store.snapshot().loginError).toBe("");
    expect(store.snapshot().statusMessage).toBe("无法打开下一页。请重试。");
    expect(store.snapshot().isUnlocked).toBe(true);
  });

  it("preserves an opted-out email only as ephemeral hint navigation state and cancel returns it without persistence", async () => {
    const { official, auth } = await createPage();
    official.formGroup.controls.email.setValue("route-only@example.com");
    official.formGroup.controls.rememberEmail.setValue(false);
    official.goToHint();
    expect(auth.setNavigationEmail).toHaveBeenCalledWith("route-only@example.com");
    expect(auth.rememberEmail).not.toHaveBeenCalled();
    expect(localStorage.getItem("barwarden.login-email")).toBeNull();
  });

  it("prefills remembered email and Back returns to email entry, clears password, and cancels", async () => {
    const { official, auth } = await createPage({ rememberedEmail: "remembered@example.com" });
    expect(official.formGroup.controls.email.value).toBe("remembered@example.com");
    official.continuePressed();
    official.formGroup.controls.masterPassword.setValue("master-password");
    official.backButtonClicked();
    expect(official.loginUiState).toBe(official.LoginUiState.EMAIL_ENTRY);
    expect(official.formGroup.controls.masterPassword.value).toBe("");
    expect(auth.cancel).toHaveBeenCalledOnce();
  });

  it.each([
    ["vault", "/tabs/vault", (store: PopupStateStore) => store.setUnlocked("person@example.com")],
    ["twoFactor", "/2fa", (store: PopupStateStore) => store.setAuthChallenge({ type: "twoFactor", email: "person@example.com", serverUrl: "https://vault.bitwarden.com", providers: ["0"] })],
    ["newDeviceVerification", "/new-device-verification", (store: PopupStateStore) => store.setAuthChallenge({ type: "newDevice", email: "person@example.com", serverUrl: "https://vault.bitwarden.com" })],
  ] as const)("does not cancel a resolved %s challenge on route destruction", async (result, route, applyState) => {
    const store = new PopupStateStore();
    const { fixture, official, auth, router } = await createPage({
      store,
      login: async () => { applyState(store); return result; },
    });
    router.navigateByUrl = vi.fn(async () => true);
    enterPassword(official);
    await official.submit();
    fixture.destroy();
    expect(auth.cancel).not.toHaveBeenCalled();
    if (result === "vault") {
      expect(store.snapshot().isUnlocked).toBe(true);
    } else {
      expect(store.snapshot().authChallenge?.type).toBe(result === "twoFactor" ? "twoFactor" : "newDevice");
    }
  });

  it("preserves an existing facade error and treats rejected navigation as navigation status", async () => {
    const store = new PopupStateStore();
    const failed = await createPage({
      store,
      login: async () => { store.setLoginError("主密码无效。请确认电子邮箱和服务器地址。"); return "vault"; },
    });
    enterPassword(failed.official);
    await failed.official.submit();
    expect(store.snapshot().loginError).toBe("主密码无效。请确认电子邮箱和服务器地址。");

    const successful = await createPage({
      store: new PopupStateStore(),
      login: async () => { successful.store.setUnlocked("person@example.com"); return "vault"; },
    });
    successful.router.navigateByUrl = vi.fn(async () => { throw new Error("route failure"); });
    enterPassword(successful.official);
    await successful.official.submit();
    expect(successful.store.snapshot().loginError).toBe("");
    expect(successful.store.snapshot().statusMessage).toBe("无法打开下一页。请重试。");
  });
});
