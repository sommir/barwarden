import "zone.js";
import "@angular/compiler";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BrowserTestingModule, platformBrowserTesting } from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { provideRouter, Router } from "@angular/router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OfficialLockComponent } from "../upstream-overlays/auth/lock/official-lock.component";
import { OfficialMasterPasswordLockComponent } from "../upstream-overlays/auth/lock/official-master-password-lock.component";
import { OfficialPinLockComponent } from "../upstream-overlays/auth/lock/official-pin-lock.component";
import { AuthFacade, AuthUnlockError } from "./auth.facade";
import { LockPageComponent } from "./lock-page.component";
import { OfficialMasterPasswordUnlockAdapter } from "./official-master-password-unlock.adapter";
import { ButtonComponent } from "../official-ui/official-components";
import {
  AlternativeUnlockError,
  UNLOCK_METHODS_PORT,
  type UnlockMethodAvailability,
  type UnlockMethodsPort,
} from "./unlock-methods.port";
import { OfficialI18nService } from "../official-ui/official-i18n.service";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function installLockVisualCss(): () => void {
  const style = document.createElement("style");
  const source = ["macos-tokens.css", "global.css"]
    .map((filename) => readFileSync(join(process.cwd(), "apps/menubar-tauri/src/styles", filename), "utf8"))
    .join("\n")
    .replace(/^@import[^;]+;\s*/gm, "");
  const rootDeclarations = source.match(/^:root\s*{([\s\S]*?)^}/m)?.[1] ?? "";
  const tokens = new Map(
    [...rootDeclarations.matchAll(/(--mac-[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [
      name,
      value.trim(),
    ]),
  );

  style.textContent = source.replace(/var\((--mac-[\w-]+)\)/g, (reference, name) =>
    tokens.get(name) ?? reference,
  );
  document.head.append(style);
  return () => style.remove();
}

describe("LockPageComponent", () => {
  afterEach(async () => {
    await new OfficialI18nService().setLocale("zh-CN");
  });

  const account = {
    id: "account-1",
    email: "user@example.test",
    serverUrl: "https://vault.example.test",
    status: "locked" as const,
    isActive: true,
  };

  type AlternativeHarness = {
    readonly availability?: UnlockMethodAvailability;
    readonly unlockWithPin?: ReturnType<typeof vi.fn>;
    readonly unlockWithBiometric?: ReturnType<typeof vi.fn>;
    readonly currentLockEpoch?: ReturnType<typeof vi.fn>;
    readonly consumeAutomaticBiometricPrompt?: ReturnType<typeof vi.fn>;
  };

  async function create(
    unlock = vi.fn(async () => "unlocked" as const),
    logout = vi.fn(async () => undefined),
    alternative: AlternativeHarness = {},
  ) {
    const unlockWithPin = alternative.unlockWithPin ?? vi.fn(async () => undefined);
    const unlockWithBiometric =
      alternative.unlockWithBiometric ?? vi.fn(async () => undefined);
    const availability = vi.fn(async () => alternative.availability ?? {
      pinEnabled: false,
      biometricEnabled: false,
      biometricAvailability: "not-available" as const,
    });
    const currentLockEpoch = alternative.currentLockEpoch ?? vi.fn(() => 1);
    const consumeAutomaticBiometricPrompt =
      alternative.consumeAutomaticBiometricPrompt ?? vi.fn(() => false);
    const unlockMethods = {
      availability,
      currentLockEpoch,
      consumeAutomaticBiometricPrompt,
    } as unknown as UnlockMethodsPort;
    await TestBed.configureTestingModule({
      imports: [LockPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: AuthFacade,
          useValue: {
            accounts: async () => [account],
            unlock,
            logout,
            unlockWithPin,
            unlockWithBiometric,
          },
        },
        { provide: UNLOCK_METHODS_PORT, useValue: unlockMethods },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(LockPageComponent);
    fixture.detectChanges();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
    fixture.detectChanges();
    return {
      fixture,
      unlock,
      logout,
      unlockWithPin,
      unlockWithBiometric,
      unlockMethods,
    };
  }

  function passwordInput(host: HTMLElement): HTMLInputElement {
    return host.querySelector('[data-testid="lock-master-password-input"]') as HTMLInputElement;
  }

  function enterPassword(host: HTMLElement, value = "master-password"): HTMLInputElement {
    const input = passwordInput(host);
    input.value = value;
    input.dispatchEvent(new Event("input"));
    return input;
  }

  function submit(host: HTMLElement): void {
    host.querySelector("form")?.dispatchEvent(new Event("submit"));
  }

  it("runs the official lock hierarchy with authoritative active account identity and server", async () => {
    const { fixture } = await create();
    const host = fixture.nativeElement as HTMLElement;

    expect(fixture.debugElement.query((node) => node.componentInstance instanceof OfficialLockComponent)).not.toBeNull();
    expect(fixture.debugElement.query((node) => node.componentInstance instanceof OfficialMasterPasswordLockComponent)).not.toBeNull();
    expect(host.textContent).toContain(account.email);
    expect(host.textContent).toContain(account.serverUrl);
    expect(passwordInput(host)).not.toBeNull();
    expect(host.querySelector('[data-testid="lock-unlock-button"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="lock-switch-account"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="lock-logout-button"]')).not.toBeNull();
    expect(host.querySelector('input[type="email"]')).toBeNull();
  });

  it("uses the macOS auth canvas, card, and wrapping account identity hooks", async () => {
    const { fixture } = await create();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector(".macos-auth-page")).not.toBeNull();
    expect(host.querySelector(".macos-auth-identity")).not.toBeNull();
    expect(host.querySelector(".macos-auth-identity__icon.bwi-user")).not.toBeNull();
    expect(host.querySelector(".macos-auth-identity__primary")?.textContent).toContain(account.email);
    expect(host.querySelector(".macos-auth-identity__secondary")?.textContent).toContain(account.serverUrl);
    expect(host.querySelector("bw-official-master-password-lock form.macos-auth-card")).not.toBeNull();
    expect(host.querySelector("[data-testid=lock-unlock-button].macos-primary-action")).not.toBeNull();
  });

  it("renders the biometric identity and alternatives as flat continuous rows", async () => {
    const cleanupCss = installLockVisualCss();
    const { fixture } = await create(vi.fn(async () => "unlocked" as const), vi.fn(async () => undefined), {
      availability: {
        pinEnabled: true,
        biometricEnabled: true,
        biometricAvailability: "available",
      },
    });
    const host = fixture.nativeElement as HTMLElement;
    const identity = host.querySelector<HTMLElement>(".macos-auth-identity");
    const biometric = host.querySelector<HTMLElement>('[data-testid="lock-biometric-button"]');
    const alternativeIds = [
      "lock-switch-pin",
      "lock-switch-master-password",
      "lock-logout-button",
      "lock-switch-account",
    ];
    const alternatives = alternativeIds.map((testId) =>
      host.querySelector<HTMLElement>(`[data-testid="${testId}"]`),
    );

    try {
      expect(identity).not.toBeNull();
      expect(biometric).not.toBeNull();
      expect(alternatives).not.toContain(null);
      expect([...host.querySelectorAll(".macos-primary-action")]).toEqual([biometric]);
      expect(identity!.compareDocumentPosition(biometric!) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
      for (let index = 0; index < alternatives.length - 1; index += 1) {
        expect(
          alternatives[index]!.compareDocumentPosition(alternatives[index + 1]!)
            & Node.DOCUMENT_POSITION_FOLLOWING,
        ).not.toBe(0);
      }

      const identityStyles = getComputedStyle(identity!);
      expect(identityStyles.borderTopWidth).toBe("0px");
      expect(identityStyles.borderRightWidth).toBe("0px");
      expect(identityStyles.borderBottomWidth).toBe("1px");
      expect(identityStyles.borderLeftWidth).toBe("0px");
      expect(identityStyles.borderRadius).toBe("0px");
      expect(identityStyles.backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(identityStyles.boxShadow).toBe("none");

      for (const alternative of alternatives) {
        const styles = getComputedStyle(alternative!);
        expect(styles.minHeight).toBe("44px");
        expect(styles.borderTopWidth).toBe("0px");
        expect(styles.borderRightWidth).toBe("0px");
        expect(styles.borderBottomWidth).toBe("1px");
        expect(styles.borderLeftWidth).toBe("0px");
        expect(styles.borderRadius).toBe("0px");
        expect(styles.backgroundColor).toBe("rgba(0, 0, 0, 0)");
        expect(styles.boxShadow).toBe("none");
      }
      expect(getComputedStyle(alternatives[2]!).color).toBe("rgb(215, 0, 21)");
    } finally {
      fixture.destroy();
      cleanupCss();
    }
  });

  it("groups biometric alternatives into adjacent used-height rows", async () => {
    const cleanupCss = installLockVisualCss();
    const { fixture } = await create(vi.fn(async () => "unlocked" as const), vi.fn(async () => undefined), {
      availability: {
        pinEnabled: true,
        biometricEnabled: true,
        biometricAvailability: "available",
      },
    });
    const host = fixture.nativeElement as HTMLElement;
    const group = host.querySelector<HTMLElement>('[data-testid="lock-unlock-methods"]');

    try {
      expect(group).not.toBeNull();
      expect(group?.classList.contains("tw-space-y-3")).toBe(false);
      expect([...group!.querySelectorAll<HTMLElement>("[data-testid]")].map((element) => element.dataset.testid))
        .toEqual([
          "lock-switch-pin",
          "lock-switch-master-password",
          "lock-logout-button",
          "lock-switch-account",
        ]);

      const groupStyles = getComputedStyle(group!);
      expect(groupStyles.display).toBe("flex");
      expect(groupStyles.flexDirection).toBe("column");
      expect(groupStyles.gap).toBe("0px");
      const switchAccountStyles = getComputedStyle(
        group!.querySelector<HTMLElement>('[data-testid="lock-switch-account"]')!,
      );
      expect(switchAccountStyles.display).toBe("flex");
      expect(switchAccountStyles.alignItems).toBe("center");
      expect(switchAccountStyles.width).toBe("100%");
      expect(switchAccountStyles.minHeight).toBe("44px");
    } finally {
      fixture.destroy();
      cleanupCss();
    }
  });

  it("renders one Barwarden heading without a provider subtitle", async () => {
    const { fixture } = await create();
    const host = fixture.nativeElement as HTMLElement;
    const headings = Array.from(host.querySelectorAll<HTMLElement>(".macos-auth-heading"));

    expect(headings.map((heading) => heading.textContent?.trim())).toEqual(["Barwarden"]);
    expect(host.querySelector(".macos-auth-provider")).toBeNull();
    expect(host.textContent).not.toContain("Bitwarden 服务");
  });

  it("localizes the master-password visibility control in the active locale", async () => {
    const i18n = new OfficialI18nService();
    await i18n.setLocale("en-US");
    const { fixture } = await create();
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="lock-password-visibility"]',
    ) as HTMLButtonElement;

    expect(toggle.getAttribute("aria-label")).toBe("Show password");
    toggle.click();
    fixture.detectChanges();
    expect(toggle.getAttribute("aria-label")).toBe("Hide password");

  });

  it("keeps the successful master-password form stable until route takeover", async () => {
    const unlock = vi.fn(async () => "unlocked" as const);
    const { fixture } = await create(unlock);
    const router = TestBed.inject(Router);
    const navigateByUrl = vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);
    const input = enterPassword(fixture.nativeElement);

    submit(fixture.nativeElement);
    submit(fixture.nativeElement);
    await fixture.whenStable();

    expect(unlock).toHaveBeenCalledOnce();
    expect(navigateByUrl).toHaveBeenCalledWith("/tabs/vault");
    expect(input.value).toBe("master-password");
    expect(
      fixture.debugElement.query(By.css('[data-testid="lock-unlock-button"]'))
        .injector.get(ButtonComponent).disabled(),
    ).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-testid="lock-unlock-error"]')).toBeNull();

    const component = fixture.debugElement.query(
      By.directive(OfficialMasterPasswordLockComponent),
    ).componentInstance as OfficialMasterPasswordLockComponent;
    fixture.destroy();
    expect(component.formGroup.controls.masterPassword.value).toBe("");
  });

  it.each([
    ["twoFactor", "/2fa"],
    ["newDeviceVerification", "/new-device-verification"],
  ] as const)("navigates retained %s unlock challenges to the existing auth flow", async (
    outcome,
    destination,
  ) => {
    const unlock = vi.fn(async () => outcome);
    const { fixture } = await create(unlock);
    const router = TestBed.inject(Router);
    const navigateByUrl = vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);
    enterPassword(fixture.nativeElement);

    submit(fixture.nativeElement);
    await fixture.whenStable();

    expect(unlock).toHaveBeenCalledOnce();
    expect(navigateByUrl).toHaveBeenCalledWith(destination);
    expect(navigateByUrl).not.toHaveBeenCalledWith("/tabs/vault");
  });

  it("shows fixed unlock failure feedback, clears the password, and never navigates to vault", async () => {
    const unlock = vi.fn(async () => {
      throw new Error("server=https://private.example password=master-password session=private-token");
    });
    const { fixture } = await create(unlock);
    const router = TestBed.inject(Router);
    const navigateByUrl = vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);
    const input = enterPassword(fixture.nativeElement);

    submit(fixture.nativeElement);
    await fixture.whenStable();
    fixture.detectChanges();

    const error = fixture.nativeElement.querySelector('[data-testid="lock-unlock-error"]') as HTMLElement;
    expect(error.querySelector("p")?.textContent?.trim()).toBe("无法解锁。请重试。");
    expect(fixture.nativeElement.textContent).not.toContain("private.example");
    expect(fixture.nativeElement.textContent).not.toContain("master-password");
    expect(fixture.nativeElement.textContent).not.toContain("private-token");
    expect(navigateByUrl).not.toHaveBeenCalledWith("/tabs/vault");
    expect(input.value).toBe("");
  });

  it("lets the user clear a compact master-password failure before retrying", async () => {
    const { fixture } = await create(vi.fn(async () => {
      throw new AuthUnlockError("invalid-credentials");
    }));
    const host = fixture.nativeElement as HTMLElement;
    enterPassword(host);

    submit(host);
    await fixture.whenStable();
    fixture.detectChanges();

    const error = host.querySelector<HTMLElement>('[data-testid="lock-unlock-error"]')!;
    expect(error.querySelector(".macos-alert-strip__title")?.textContent?.trim()).toBe("");
    const dismiss = error.querySelector<HTMLButtonElement>('[aria-label="关闭"]');
    expect(dismiss).not.toBeNull();

    dismiss!.click();
    fixture.detectChanges();

    expect(host.querySelector('[data-testid="lock-unlock-error"]')).toBeNull();
  });

  it.each([
    [
      "invalid credentials",
      new AuthUnlockError("invalid-credentials"),
      "主密码无效。请确认后重试。",
    ],
    [
      "Keychain persistence",
      new AuthUnlockError("storage-unavailable"),
      "已验证主密码，但无法访问钥匙串。请允许访问后重试。",
    ],
    [
      "server connection",
      new AuthUnlockError("connection-unavailable"),
      "无法连接服务器。请检查网络和服务器地址后重试。",
    ],
  ] as const)("shows specific sanitized feedback for %s failure", async (_case, failure, message) => {
    const unlock = vi.fn(async () => {
      throw failure;
    });
    const { fixture } = await create(unlock);
    enterPassword(fixture.nativeElement);

    submit(fixture.nativeElement);
    await fixture.whenStable();
    fixture.detectChanges();

    const error = fixture.nativeElement.querySelector('[data-testid="lock-unlock-error"]') as HTMLElement;
    expect(error.querySelector("p")?.textContent?.trim()).toBe(message);
  });

  it("keeps navigation failure separate from unlock failure feedback", async () => {
    const { fixture } = await create();
    const router = TestBed.inject(Router);
    vi.spyOn(router, "navigateByUrl").mockRejectedValue(new Error("private route detail"));
    enterPassword(fixture.nativeElement);

    submit(fixture.nativeElement);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="lock-unlock-error"]')).toBeNull();
    const error = fixture.nativeElement.querySelector('[data-testid="lock-navigation-error"]') as HTMLElement;
    expect(error.textContent).toContain("无法完成页面跳转。请重试。");
    expect(fixture.nativeElement.textContent).not.toContain("private route detail");
  });

  it("shows fixed navigation feedback when unlock navigation is canceled", async () => {
    const unlock = vi.fn(async () => "unlocked" as const);
    const { fixture } = await create(unlock);
    const router = TestBed.inject(Router);
    const navigateByUrl = vi.spyOn(router, "navigateByUrl").mockResolvedValue(false);
    enterPassword(fixture.nativeElement);

    submit(fixture.nativeElement);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(unlock).toHaveBeenCalledOnce();
    expect(navigateByUrl).toHaveBeenCalledWith("/tabs/vault");
    expect(fixture.nativeElement.querySelector('[data-testid="lock-unlock-error"]')).toBeNull();
    const error = fixture.nativeElement.querySelector('[data-testid="lock-navigation-error"]') as HTMLElement;
    expect(error.textContent).toContain("无法完成页面跳转。请重试。");
  });

  it("clears the form on destroy while unlock remains pending and the adapter retains no password", async () => {
    const pending = deferred<void>();
    const { fixture } = await create(vi.fn(() => pending.promise));
    const component = fixture.debugElement.query(
      (node) => node.componentInstance instanceof OfficialMasterPasswordLockComponent,
    ).componentInstance as OfficialMasterPasswordLockComponent;
    const adapter = TestBed.inject(OfficialMasterPasswordUnlockAdapter);
    enterPassword(fixture.nativeElement);

    submit(fixture.nativeElement);
    expect(component.formGroup.controls.masterPassword.value).toBe("master-password");
    fixture.destroy();

    expect(component.formGroup.controls.masterPassword.value).toBe("");
    expect(Object.getOwnPropertyNames(adapter)).not.toContain("transientPassword");
    expect(Object.values(adapter)).not.toContain("master-password");
    pending.resolve();
    await Promise.resolve();
  });

  it("clears the form on logout and navigates to login", async () => {
    const logout = vi.fn(async () => undefined);
    const { fixture } = await create(vi.fn(), logout);
    const router = TestBed.inject(Router);
    const navigateByUrl = vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);
    const input = enterPassword(fixture.nativeElement);

    (fixture.nativeElement.querySelector('[data-testid="lock-logout-button"]') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(logout).toHaveBeenCalledOnce();
    expect(navigateByUrl).toHaveBeenCalledWith("/login");
    expect(input.value).toBe("");
  });

  it("does not emit logout success or navigate when account removal fails", async () => {
    const logout = vi.fn(async () => { throw new Error("Unable to log out account"); });
    const { fixture } = await create(vi.fn(), logout);
    const router = TestBed.inject(Router);
    const navigateByUrl = vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);
    const component = fixture.debugElement.query(
      (node) => node.componentInstance instanceof OfficialMasterPasswordLockComponent,
    ).componentInstance as OfficialMasterPasswordLockComponent;
    const emitted = vi.fn();
    component.loggedOut.subscribe(emitted);

    await component.logout();

    expect(logout).toHaveBeenCalledOnce();
    expect(emitted).not.toHaveBeenCalled();
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it("serializes logout against duplicate logout and unlock submissions", async () => {
    const pending = deferred<void>();
    const unlock = vi.fn(async () => undefined);
    const logout = vi.fn(() => pending.promise);
    const { fixture } = await create(unlock, logout);
    const component = fixture.debugElement.query(
      (node) => node.componentInstance instanceof OfficialMasterPasswordLockComponent,
    ).componentInstance as OfficialMasterPasswordLockComponent;
    enterPassword(fixture.nativeElement);

    const firstLogout = component.logout();
    const duplicateLogout = component.logout();
    await component.submit();
    fixture.detectChanges();

    expect(logout).toHaveBeenCalledOnce();
    expect(unlock).not.toHaveBeenCalled();
    expect(fixture.debugElement.query(By.css('[data-testid="lock-unlock-button"]'))
      .injector.get(ButtonComponent).disabled()).toBe(true);
    expect(fixture.debugElement.query(By.css('[data-testid="lock-logout-button"]'))
      .injector.get(ButtonComponent).disabled()).toBe(true);

    pending.resolve();
    await Promise.all([firstLogout, duplicateLogout]);
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('[data-testid="lock-logout-button"]'))
      .injector.get(ButtonComponent).disabled()).toBe(false);
  });

  it("shows fixed navigation feedback when logout navigation is canceled", async () => {
    const logout = vi.fn(async () => undefined);
    const { fixture } = await create(vi.fn(), logout);
    const router = TestBed.inject(Router);
    const navigateByUrl = vi.spyOn(router, "navigateByUrl").mockResolvedValue(false);

    (fixture.nativeElement.querySelector('[data-testid="lock-logout-button"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(logout).toHaveBeenCalledOnce();
    expect(navigateByUrl).toHaveBeenCalledWith("/login");
    const error = fixture.nativeElement.querySelector('[data-testid="lock-navigation-error"]') as HTMLElement;
    expect(error.textContent).toContain("无法完成页面跳转。请重试。");
  });

  it("shows fixed navigation feedback when logout navigation rejects", async () => {
    const logout = vi.fn(async () => undefined);
    const { fixture } = await create(vi.fn(), logout);
    const router = TestBed.inject(Router);
    vi.spyOn(router, "navigateByUrl").mockRejectedValue(new Error("private route detail"));

    (fixture.nativeElement.querySelector('[data-testid="lock-logout-button"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(logout).toHaveBeenCalledOnce();
    const error = fixture.nativeElement.querySelector('[data-testid="lock-navigation-error"]') as HTMLElement;
    expect(error.textContent).toContain("无法完成页面跳转。请重试。");
    expect(fixture.nativeElement.textContent).not.toContain("private route detail");
  });

  it("defaults to Touch ID, then offers PIN and master password", async () => {
    const { fixture } = await create(undefined, undefined, {
      availability: {
        pinEnabled: true,
        biometricEnabled: true,
        biometricAvailability: "available",
      },
    });
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('[data-testid="lock-biometric-button"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="lock-switch-pin"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="lock-switch-master-password"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="lock-pin-input"]')).toBeNull();
    expect(passwordInput(host)).toBeNull();
  });

  it("keeps every unlock form unavailable until method initialization completes", async () => {
    const pendingAvailability = deferred<UnlockMethodAvailability>();
    const unlock = vi.fn(async () => "unlocked" as const);
    const unlockWithBiometric = vi.fn(async () => {
      throw new AlternativeUnlockError("biometric-cancelled");
    });
    await TestBed.configureTestingModule({
      imports: [LockPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: AuthFacade,
          useValue: {
            accounts: async () => [account],
            unlock,
            logout: vi.fn(),
            unlockWithPin: vi.fn(),
            unlockWithBiometric,
          },
        },
        {
          provide: UNLOCK_METHODS_PORT,
          useValue: {
            availability: () => pendingAvailability.promise,
            currentLockEpoch: () => 1,
            consumeAutomaticBiometricPrompt: () => true,
          } as unknown as UnlockMethodsPort,
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(LockPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('[data-testid="lock-methods-loading"]')).not.toBeNull();
    expect(passwordInput(host)).toBeNull();
    expect(host.querySelector('[data-testid="lock-pin-input"]')).toBeNull();
    expect(host.querySelector('[data-testid="lock-biometric-button"]')).toBeNull();

    pendingAvailability.resolve({
      pinEnabled: true,
      biometricEnabled: true,
      biometricAvailability: "available",
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(unlock).not.toHaveBeenCalled();
    expect(unlockWithBiometric).toHaveBeenCalledOnce();
  });

  it("refreshes the lock view when asynchronous method initialization completes", async () => {
    const pendingAvailability = deferred<UnlockMethodAvailability>();
    await TestBed.configureTestingModule({
      imports: [LockPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: AuthFacade,
          useValue: {
            accounts: async () => [account],
            unlock: vi.fn(),
            logout: vi.fn(),
            unlockWithPin: vi.fn(),
            unlockWithBiometric: vi.fn(),
          },
        },
        {
          provide: UNLOCK_METHODS_PORT,
          useValue: {
            availability: () => pendingAvailability.promise,
            currentLockEpoch: () => 1,
            consumeAutomaticBiometricPrompt: () => false,
          } as unknown as UnlockMethodsPort,
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(LockPageComponent);
    fixture.detectChanges();
    const component = fixture.debugElement.query(
      (node) => node.componentInstance instanceof OfficialLockComponent,
    ).componentInstance as OfficialLockComponent;
    const changeDetectorRef = (
      component as unknown as {
        changeDetectorRef: { detectChanges(): void };
      }
    ).changeDetectorRef;
    const detectChanges = vi.spyOn(changeDetectorRef, "detectChanges");

    pendingAvailability.resolve({
      pinEnabled: false,
      biometricEnabled: false,
      biometricAvailability: "not-available",
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();

    expect(detectChanges).toHaveBeenCalled();
  });

  it("falls back to a recoverable master-password view when account discovery fails", async () => {
    await TestBed.configureTestingModule({
      imports: [LockPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: AuthFacade,
          useValue: {
            accounts: async () => {
              throw new Error("private Keychain detail");
            },
            unlock: vi.fn(),
            logout: vi.fn(),
            unlockWithPin: vi.fn(),
            unlockWithBiometric: vi.fn(),
          },
        },
        {
          provide: UNLOCK_METHODS_PORT,
          useValue: {
            availability: vi.fn(),
          } as unknown as UnlockMethodsPort,
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(LockPageComponent);
    fixture.detectChanges();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('[data-testid="lock-methods-loading"]')).toBeNull();
    expect(passwordInput(host)).not.toBeNull();
    expect(host.textContent).toContain(
      "无法读取账户信息。请重试或使用主密码解锁。",
    );
    expect(host.textContent).not.toContain("private Keychain detail");
  });

  it("auto-prompts Touch ID only once per lock epoch", async () => {
    const consume = vi.fn()
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    const unlockWithBiometric = vi.fn(async () => {
      throw new AlternativeUnlockError("biometric-cancelled");
    });
    const { fixture } = await create(undefined, undefined, {
      availability: {
        pinEnabled: true,
        biometricEnabled: true,
        biometricAvailability: "available",
      },
      unlockWithBiometric,
      consumeAutomaticBiometricPrompt: consume,
    });

    await fixture.whenStable();
    const secondFixture = TestBed.createComponent(LockPageComponent);
    secondFixture.detectChanges();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await secondFixture.whenStable();
    secondFixture.detectChanges();

    expect(consume).toHaveBeenCalledTimes(2);
    expect(unlockWithBiometric).toHaveBeenCalledOnce();
    secondFixture.destroy();
  });

  it("does not initialize or prompt Touch ID after the lock view is destroyed", async () => {
    const availability = vi.fn(async () => ({
      pinEnabled: false,
      biometricEnabled: true,
      biometricAvailability: "available" as const,
    }));
    const unlockWithBiometric = vi.fn(async () => undefined);
    await TestBed.configureTestingModule({
      imports: [LockPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: AuthFacade,
          useValue: {
            accounts: async () => [account],
            unlock: vi.fn(),
            logout: vi.fn(),
            unlockWithPin: vi.fn(),
            unlockWithBiometric,
          },
        },
        {
          provide: UNLOCK_METHODS_PORT,
          useValue: {
            availability,
            currentLockEpoch: () => 1,
            consumeAutomaticBiometricPrompt: () => true,
          } as unknown as UnlockMethodsPort,
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(LockPageComponent);
    fixture.detectChanges();

    fixture.destroy();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(availability).not.toHaveBeenCalled();
    expect(unlockWithBiometric).not.toHaveBeenCalled();
  });

  it("does not auto-reprompt after cancellation but permits a manual retry", async () => {
    const unlockWithBiometric = vi.fn(async () => {
      throw new AlternativeUnlockError("biometric-cancelled");
    });
    const { fixture } = await create(undefined, undefined, {
      availability: {
        pinEnabled: false,
        biometricEnabled: true,
        biometricAvailability: "available",
      },
      unlockWithBiometric,
      consumeAutomaticBiometricPrompt: vi.fn(() => true),
    });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(unlockWithBiometric).toHaveBeenCalledOnce();
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="lock-alternative-error"]',
      ),
    ).toBeNull();
    (fixture.nativeElement.querySelector(
      '[data-testid="lock-biometric-button"]',
    ) as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(unlockWithBiometric).toHaveBeenCalledTimes(2);
  });

  it("shows remaining PIN attempts without exposing the PIN", async () => {
    const unlockWithPin = vi.fn(async () => {
      throw new AlternativeUnlockError("incorrect-pin", 4);
    });
    const { fixture } = await create(undefined, undefined, {
      availability: {
        pinEnabled: true,
        biometricEnabled: false,
        biometricAvailability: "not-available",
      },
      unlockWithPin,
    });
    const host = fixture.nativeElement as HTMLElement;
    const input = host.querySelector('[data-testid="lock-pin-input"]') as HTMLInputElement;
    input.value = "123456";
    input.dispatchEvent(new Event("input"));
    host.querySelector('[data-testid="lock-pin-form"]')
      ?.dispatchEvent(new Event("submit"));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host.textContent).toContain("PIN 不正确，还可尝试 4 次。");
    expect(host.textContent).not.toContain("123456");
    expect(input.value).toBe("");
  });

  it("keeps a successful PIN submission stable until route takeover", async () => {
    const { fixture } = await create(undefined, undefined, {
      availability: {
        pinEnabled: true,
        biometricEnabled: false,
        biometricAvailability: "not-available",
      },
      unlockWithPin: vi.fn(async () => undefined),
    });
    const router = TestBed.inject(Router);
    const navigateByUrl = vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);
    const host = fixture.nativeElement as HTMLElement;
    const input = host.querySelector<HTMLInputElement>('[data-testid="lock-pin-input"]')!;
    input.value = "123456";
    input.dispatchEvent(new Event("input"));

    host.querySelector('[data-testid="lock-pin-form"]')
      ?.dispatchEvent(new Event("submit"));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(navigateByUrl).toHaveBeenCalledWith("/tabs/vault");
    expect(input.value).toBe("123456");
    expect(host.textContent).not.toContain("必须输入内容");
    expect(
      fixture.debugElement.query(By.css('[data-testid="lock-pin-button"]'))
        .injector.get(ButtonComponent).disabled(),
    ).toBe(true);

    const component = fixture.debugElement.query(By.directive(OfficialPinLockComponent))
      .componentInstance as OfficialPinLockComponent;
    fixture.destroy();
    expect(component.formGroup.controls.pin.value).toBe("");
  });

  it("retains the official logout command on the PIN branch", async () => {
    const logout = vi.fn(async () => undefined);
    const { fixture } = await create(undefined, logout, {
      availability: {
        pinEnabled: true,
        biometricEnabled: false,
        biometricAvailability: "not-available",
      },
    });
    const router = TestBed.inject(Router);
    const navigateByUrl = vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);

    (fixture.nativeElement.querySelector(
      '[data-testid="lock-logout-button"]',
    ) as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(logout).toHaveBeenCalledOnce();
    expect(navigateByUrl).toHaveBeenCalledWith("/login");
  });

  it("removes PIN after exhaustion and keeps master-password fallback", async () => {
    let attempt = 0;
    const unlockWithPin = vi.fn(async () => {
      attempt += 1;
      throw attempt < 5
        ? new AlternativeUnlockError("incorrect-pin", 5 - attempt)
        : new AlternativeUnlockError("pin-exhausted");
    });
    const { fixture } = await create(undefined, undefined, {
      availability: {
        pinEnabled: true,
        biometricEnabled: false,
        biometricAvailability: "not-available",
      },
      unlockWithPin,
    });
    const host = fixture.nativeElement as HTMLElement;

    for (let index = 0; index < 5; index += 1) {
      const input = host.querySelector('[data-testid="lock-pin-input"]') as HTMLInputElement;
      input.value = "000000";
      input.dispatchEvent(new Event("input"));
      host.querySelector('[data-testid="lock-pin-form"]')
        ?.dispatchEvent(new Event("submit"));
      await fixture.whenStable();
      fixture.detectChanges();
    }

    expect(unlockWithPin).toHaveBeenCalledTimes(5);
    expect(host.querySelector('[data-testid="lock-pin-input"]')).toBeNull();
    expect(passwordInput(host)).not.toBeNull();
    expect(host.textContent).toContain("PIN 已失效，请使用主密码解锁。");
  });

  it("falls back to PIN before master password when Touch ID is unavailable", async () => {
    const unlockWithBiometric = vi.fn(async () => {
      throw new AlternativeUnlockError("biometric-unavailable");
    });
    const { fixture } = await create(undefined, undefined, {
      availability: {
        pinEnabled: true,
        biometricEnabled: true,
        biometricAvailability: "available",
      },
      unlockWithBiometric,
      consumeAutomaticBiometricPrompt: vi.fn(() => true),
    });
    await fixture.whenStable();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('[data-testid="lock-biometric-button"]')).toBeNull();
    expect(host.querySelector('[data-testid="lock-pin-input"]')).not.toBeNull();
    expect(passwordInput(host)).toBeNull();
  });

  it("never navigates before alternative session sync succeeds", async () => {
    const pending = deferred<void>();
    const unlockWithPin = vi.fn(() => pending.promise);
    const { fixture } = await create(undefined, undefined, {
      availability: {
        pinEnabled: true,
        biometricEnabled: false,
        biometricAvailability: "not-available",
      },
      unlockWithPin,
    });
    const router = TestBed.inject(Router);
    const navigateByUrl = vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);
    const host = fixture.nativeElement as HTMLElement;
    const input = host.querySelector('[data-testid="lock-pin-input"]') as HTMLInputElement;
    input.value = "123456";
    input.dispatchEvent(new Event("input"));
    host.querySelector('[data-testid="lock-pin-form"]')
      ?.dispatchEvent(new Event("submit"));

    await vi.waitFor(() => expect(unlockWithPin).toHaveBeenCalledOnce());
    expect(navigateByUrl).not.toHaveBeenCalled();
    pending.resolve();
    await fixture.whenStable();

    expect(navigateByUrl).toHaveBeenCalledWith("/tabs/vault");
  });

  it("never navigates before Touch ID session sync succeeds", async () => {
    const pending = deferred<void>();
    const unlockWithBiometric = vi.fn(() => pending.promise);
    const { fixture } = await create(undefined, undefined, {
      availability: {
        pinEnabled: false,
        biometricEnabled: true,
        biometricAvailability: "available",
      },
      unlockWithBiometric,
    });
    const router = TestBed.inject(Router);
    const navigateByUrl = vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);
    (fixture.nativeElement.querySelector(
      '[data-testid="lock-biometric-button"]',
    ) as HTMLButtonElement).click();

    await vi.waitFor(() => expect(unlockWithBiometric).toHaveBeenCalledOnce());
    expect(navigateByUrl).not.toHaveBeenCalled();
    pending.resolve();
    await fixture.whenStable();

    expect(navigateByUrl).toHaveBeenCalledWith("/tabs/vault");
  });

  it("falls back to master password when alternative session sync fails", async () => {
    const unlockWithBiometric = vi.fn(async () => {
      throw new AlternativeUnlockError("sync-failed");
    });
    const { fixture } = await create(undefined, undefined, {
      availability: {
        pinEnabled: false,
        biometricEnabled: true,
        biometricAvailability: "available",
      },
      unlockWithBiometric,
    });
    const router = TestBed.inject(Router);
    const navigateByUrl = vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);
    (fixture.nativeElement.querySelector(
      '[data-testid="lock-biometric-button"]',
    ) as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(navigateByUrl).not.toHaveBeenCalled();
    expect(passwordInput(fixture.nativeElement)).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain(
      "无法恢复密码库会话。请使用主密码解锁。",
    );
  });
});
