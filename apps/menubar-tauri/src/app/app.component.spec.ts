import "@angular/compiler";
import "zone.js";

import { TestBed } from "@angular/core/testing";
import { BrowserTestingModule, platformBrowserTesting } from "@angular/platform-browser/testing";
import { provideRouter, Router } from "@angular/router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { PopupStateStore } from "./popup-state";
import { OfficialI18nService } from "./official-ui/official-i18n.service";
import {
  AppComponent,
  routeHasMainSwitcher,
  startupFailurePresentation,
} from "./app.component";
import { AUTH_EVIDENCE_STATE, type AuthEvidenceState } from "./auth/auth-evidence-preview";
import { AuthFacade, AuthStartupError } from "./auth/auth.facade";
import { VaultTimeoutService } from "./auth/vault-timeout.service";
import { PopupWindowSizeService } from "./window-size/popup-window-size.service";
import {
  PROCESS_SESSION_BROKER,
  ProcessSessionBrokerService,
  type ProcessSessionEventSource,
  type ProcessSessionBrokerPort,
} from "./auth/process-session-broker.service";
import type {
  ProcessSessionBrokerHost,
  ProcessSessionMutation,
  ProcessSessionSnapshot,
} from "../host/host-api";
import { ReplaySubject } from "rxjs";
import * as bitwardenApiModule from "../bitwarden-api/bitwarden-api";
import { AutoFillSetupService } from "./autofill/autofill-setup.service";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("AppComponent", () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    });
  });

  it.each([
    ["secure-storage", "无法访问钥匙串", "允许钥匙串访问后重试。", "重试"],
    ["session-missing", "会话已失效", "请重新解锁此账户。", "重新解锁"],
    ["transport", "无法连接服务器", "请检查网络和服务器地址后重试。", "重试"],
    ["sync-failed", "同步未完成", "已保留本地数据；连接恢复后可重试。", "重试"],
    ["local-data-corrupt", "本地账户数据不可用", "请重新登录以重建本地账户数据。", "重新登录"],
    ["broker-unavailable", "窗口会话不可用", "无法连接 Barwarden 的共享窗口会话。", "重试"],
  ] as const)(
    "maps %s to an accurate startup Alert title, message and action",
    (code, title, message, actionLabel) => {
      expect(startupFailurePresentation(new AuthStartupError(code), true)).toMatchObject({
        code,
        title,
        message,
        actionLabel,
      });
    },
  );

  it("does not present arbitrary programming TypeErrors as transport failures", () => {
    expect(
      startupFailurePresentation(new TypeError("undefined is not iterable"), true),
    ).toMatchObject({
      code: "unexpected",
      title: "无法恢复 Barwarden",
    });
  });

  it("immediately routes an active popup to unlock when the vault locks", async () => {
    const store = new PopupStateStore();
    store.setUnlocked("user@example.com");
    const navigateByUrl = vi.fn().mockResolvedValue(true);
    const component = new AppComponent(
      { restoreStartup: vi.fn() } as any,
      {
        navigateByUrl,
        url: "/tabs/vault",
        events: { subscribe: () => ({ unsubscribe() {} }) },
      } as any,
      { recordActivity: vi.fn() } as any,
      store,
    );

    store.setLocked();

    await vi.waitFor(() =>
      expect(navigateByUrl).toHaveBeenCalledWith("/lock", { replaceUrl: true }),
    );
    component.ngOnDestroy();
  });

  it.each(["autofill-menu", "autofill-shortcut", "autofill-floating"])(
    "routes the dedicated %s entry to the shared picker without resetting the vault route",
    async (entrySource) => {
      const store = new PopupStateStore();
      const navigateByUrl = vi.fn().mockResolvedValue(true);
      const component = new AppComponent(
        { restoreStartup: vi.fn() } as any,
        {
          navigateByUrl,
          url: "/tabs/vault",
          events: { subscribe: () => ({ unsubscribe() {} }) },
        } as any,
        { recordActivity: vi.fn() } as any,
        store,
      );

      component.restorePopupComposition(new CustomEvent("barwarden:popup-shown", {
        detail: { reset: true, entrySource },
      }));

      await vi.waitFor(() => expect(navigateByUrl).toHaveBeenCalledWith(
        "/autofill-picker",
        { replaceUrl: true },
      ));
      expect(store.snapshot().activeTab).toBe("vault");
      component.ngOnDestroy();
    },
  );

  it("awaits native AutoFill enablement before opening a dedicated entry", async () => {
    const store = new PopupStateStore();
    const navigateByUrl = vi.fn().mockResolvedValue(true);
    let finishEnable: (() => void) | undefined;
    const enableFromEntry = vi.fn(() => new Promise<"ready">((resolve) => {
      finishEnable = () => resolve("ready");
    }));
    const component = Reflect.construct(AppComponent, [
      { restoreStartup: vi.fn() },
      { navigateByUrl, url: "/tabs/vault", events: { subscribe: () => ({ unsubscribe() {} }) } },
      { recordActivity: vi.fn() },
      store,
      null, null, null, null, null, null, null, null, null, null, null, null, null, null,
      { enableFromEntry },
    ]) as AppComponent;

    component.restorePopupComposition(new CustomEvent("barwarden:popup-shown", {
      detail: { entrySource: "autofill-shortcut" },
    }));
    await vi.waitFor(() => expect(enableFromEntry).toHaveBeenCalledOnce());
    expect(navigateByUrl).not.toHaveBeenCalled();

    finishEnable?.();
    await vi.waitFor(() => expect(navigateByUrl).toHaveBeenCalledWith(
      "/autofill-picker",
      { replaceUrl: true },
    ));
    component.ngOnDestroy();
  });

  it("does not reopen the picker when a concurrent Turn Off wins enablement", async () => {
    const store = new PopupStateStore();
    const navigateByUrl = vi.fn().mockResolvedValue(true);
    const enableFromEntry = vi.fn(async () => "disabled" as const);
    const component = Reflect.construct(AppComponent, [
      { restoreStartup: vi.fn() },
      { navigateByUrl, url: "/tabs/vault", events: { subscribe: () => ({ unsubscribe() {} }) } },
      { recordActivity: vi.fn() },
      store,
      null, null, null, null, null, null, null, null, null, null, null, null, null, null,
      { enableFromEntry },
    ]) as AppComponent;

    component.restorePopupComposition(new CustomEvent("barwarden:popup-shown", {
      detail: { entrySource: "autofill-shortcut" },
    }));
    await vi.waitFor(() => expect(enableFromEntry).toHaveBeenCalledOnce());

    expect(navigateByUrl).not.toHaveBeenCalled();
    component.ngOnDestroy();
  });

  it("retries pending AutoFill cleanup after a cold locked restore with no vault owner", async () => {
    const store = new PopupStateStore();
    const restoreStartup = vi.fn(async () => "locked" as const);
    const recoverAtStartup = vi.fn(async () => "disabled" as const);
    const component = Reflect.construct(AppComponent, [
      { restoreStartup },
      { navigateByUrl: vi.fn().mockResolvedValue(true), url: "/tabs/vault", events: { subscribe: () => ({ unsubscribe() {} }) } },
      { recordActivity: vi.fn() },
      store,
      null, null, null, null, null, null, null, null, null, null, null, null, null, null,
      { recoverAtStartup },
    ]) as AppComponent;

    await component.ngOnInit();

    expect(restoreStartup.mock.invocationCallOrder[0]).toBeLessThan(
      recoverAtStartup.mock.invocationCallOrder[0],
    );
    expect(store.snapshot().vaultOwnerAccountId).toBeNull();
    component.ngOnDestroy();
  });

  it("retries AutoFill setup when a locked vault becomes unlocked", async () => {
    const store = new PopupStateStore();
    const recoverAtStartup = vi.fn(async () => "ready" as const);
    const component = Reflect.construct(AppComponent, [
      { restoreStartup: vi.fn() },
      { navigateByUrl: vi.fn().mockResolvedValue(true), url: "/lock", events: { subscribe: () => ({ unsubscribe() {} }) } },
      { recordActivity: vi.fn() },
      store,
      null, null, null, null, null, null, null, null, null, null, null, null, null, null,
      { recoverAtStartup },
    ]) as AppComponent;

    store.setUnlocked("user@example.com");

    await vi.waitFor(() => expect(recoverAtStartup).toHaveBeenCalledOnce());
    component.ngOnDestroy();
  });

  it("does not route away while login temporarily hides a synchronized candidate state", async () => {
    const store = new PopupStateStore();
    store.setUnlocked("user@example.com");
    const navigateByUrl = vi.fn().mockResolvedValue(true);
    const component = new AppComponent(
      { restoreStartup: vi.fn() } as any,
      {
        navigateByUrl,
        url: "/login",
        events: { subscribe: () => ({ unsubscribe() {} }) },
      } as any,
      { recordActivity: vi.fn() } as any,
      store,
    );

    store.restore({ ...store.snapshot(), isUnlocked: false, isLoggingIn: true });
    await Promise.resolve();

    expect(navigateByUrl).not.toHaveBeenCalled();
    component.ngOnDestroy();
  });

  it("presents only a dedicated typed transport failure as transport", () => {
    expect(startupFailurePresentation(startupTransportFailure(), true)).toMatchObject({
      code: "transport",
      title: "无法连接服务器",
    });
  });

  it("preserves a secondary route when a peer snapshot changes shared state without changing tabs", async () => {
    const store = new PopupStateStore();
    store.setActiveTab("vault");
    const attachProcessSession = vi.fn().mockResolvedValue("unlocked");
    const navigateByUrl = vi.fn().mockResolvedValue(true);
    const broker = new FakeAppProcessSessionBroker(
      "attach",
      appBrokerSnapshot({
        version: 1,
        authorization: "unlocked",
        activeAccountId: "account-1",
      }),
    );
    const component = new AppComponent(
      {
        restoreStartup: vi.fn(),
        attachProcessSession,
        publishProcessStartupState: vi.fn(),
        publishProcessStateProjection: vi.fn(),
      } as any,
      {
        navigateByUrl,
        url: "/view-cipher/item-1",
        events: { subscribe: () => ({ unsubscribe() {} }) },
      } as any,
      { recordActivity: vi.fn() } as any,
      store,
      null,
      null,
      null,
      null,
      null,
      null,
      { hidePopup: vi.fn() } as any,
      broker,
    );
    await component.ngOnInit();
    navigateByUrl.mockClear();
    attachProcessSession.mockClear();

    broker.emit(appBrokerSnapshot({
      version: 2,
      authorization: "unlocked",
      activeAccountId: "account-1",
      originWindowLabel: "popup",
    }));

    await vi.waitFor(() => expect(attachProcessSession).toHaveBeenCalledTimes(1));
    expect(navigateByUrl).not.toHaveBeenCalled();
    component.ngOnDestroy();
  });

  it("leaves a secondary route when a peer snapshot carries a new tab-navigation intent", async () => {
    const store = new PopupStateStore();
    store.setActiveTab("vault");
    const attachProcessSession = vi.fn(async (snapshot: ProcessSessionSnapshot) => {
      if (snapshot.version === 2) {
        store.setActiveTab("otp");
      }
      return "unlocked" as const;
    });
    const navigateByUrl = vi.fn().mockResolvedValue(true);
    const broker = new FakeAppProcessSessionBroker(
      "attach",
      appBrokerSnapshot({
        version: 1,
        authorization: "unlocked",
        activeAccountId: "account-1",
      }),
    );
    const component = new AppComponent(
      {
        restoreStartup: vi.fn(),
        attachProcessSession,
        publishProcessStartupState: vi.fn(),
        publishProcessStateProjection: vi.fn(),
      } as any,
      {
        navigateByUrl,
        url: "/view-cipher/item-1",
        events: { subscribe: () => ({ unsubscribe() {} }) },
      } as any,
      { recordActivity: vi.fn() } as any,
      store,
      null,
      null,
      null,
      null,
      null,
      null,
      { hidePopup: vi.fn() } as any,
      broker,
    );
    await component.ngOnInit();
    navigateByUrl.mockClear();

    broker.emit(appBrokerSnapshot({
      version: 2,
      authorization: "unlocked",
      activeAccountId: "account-1",
      originWindowLabel: "popup",
    }));

    await vi.waitFor(() =>
      expect(navigateByUrl).toHaveBeenCalledWith("/tabs/otp", { replaceUrl: true }),
    );
    component.ngOnDestroy();
  });

  it("renders one startup failure surface and one live region", async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter([]),
        {
          provide: AuthFacade,
          useValue: {
            restoreStartup: vi.fn().mockRejectedValue(
              new AuthStartupError("broker-unavailable"),
            ),
          },
        },
        { provide: VaultTimeoutService, useValue: { recordActivity: vi.fn() } },
        PopupStateStore,
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AppComponent);

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    await vi.waitFor(() =>
      expect(host.querySelector(".app-bootstrap-loading")).toBeNull(),
    );
    fixture.detectChanges();

    expect(host.querySelectorAll(".app-startup-alert .macos-alert-strip")).toHaveLength(1);
    expect(host.querySelectorAll("[role='alert'], [role='status'], [aria-live]")).toHaveLength(1);
    expect(host.textContent).toContain("窗口会话不可用");
  });

  it("dismisses a stale startup Alert after an interactive login unlocks the store", async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter([]),
        {
          provide: AuthFacade,
          useValue: {
            restoreStartup: vi.fn().mockRejectedValue(
              new AuthStartupError("timeout"),
            ),
          },
        },
        { provide: VaultTimeoutService, useValue: { recordActivity: vi.fn() } },
        PopupStateStore,
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AppComponent);
    const store = TestBed.inject(PopupStateStore);

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector(".app-startup-alert")).not.toBeNull();

    store.setUnlocked("test@example.com");
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector(".app-startup-alert")).toBeNull();
  });

  it.each([
    ["a confirmed logout", (store: PopupStateStore) => {
      store.setLoggedOut();
      store.setStatus("Logged out");
    }],
    ["a new interactive login", (store: PopupStateStore) => store.setLoggingIn(true)],
  ])("dismisses a stale startup Alert after %s", async (_scenario, transition) => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter([]),
        {
          provide: AuthFacade,
          useValue: {
            restoreStartup: vi.fn().mockRejectedValue(
              new AuthStartupError("timeout"),
            ),
          },
        },
        { provide: VaultTimeoutService, useValue: { recordActivity: vi.fn() } },
        PopupStateStore,
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AppComponent);
    const store = TestBed.inject(PopupStateStore);

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector(".app-startup-alert")).not.toBeNull();

    transition(store);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector(".app-startup-alert")).toBeNull();
  });

  it("classifies OTP as a main-switcher route so feedback clears the floating footer", () => {
    expect(routeHasMainSwitcher("/tabs/otp")).toBe(true);
    expect(routeHasMainSwitcher("/tabs/otp?issuer=Example")).toBe(true);
    expect(routeHasMainSwitcher("/view-cipher/example")).toBe(false);
  });

  it("is a routed root component", () => {
    const component = new AppComponent(
      { restoreStartup: vi.fn() } as any,
      { navigateByUrl: vi.fn() } as any,
      { recordActivity: vi.fn() } as any,
      new PopupStateStore(),
    );

    expect(component).toBeInstanceOf(AppComponent);
  });

  it("measures only the routed-content wrapper and keeps the sheet host as its sibling", async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter([]),
        { provide: AuthFacade, useValue: { restoreStartup: vi.fn().mockResolvedValue("login") } },
        { provide: VaultTimeoutService, useValue: { recordActivity: vi.fn() } },
        PopupStateStore,
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    const source = fixture.nativeElement.querySelector(".popup-window-size-source");
    const sheet = fixture.nativeElement.querySelector("bw-app-bottom-sheet-dialog-host");
    const feedback = fixture.nativeElement.querySelector("bw-app-feedback");
    expect(source?.contains(sheet)).toBe(false);
    expect(source?.contains(feedback)).toBe(false);
    expect(source?.querySelector("router-outlet")).not.toBeNull();
  });

  it("initializes persisted popup sizing without observing routed content", async () => {
    const popupWindowSize = { start: vi.fn(), destroy: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter([]),
        { provide: AuthFacade, useValue: { restoreStartup: vi.fn().mockResolvedValue("login") } },
        { provide: VaultTimeoutService, useValue: { recordActivity: vi.fn() } },
        { provide: PopupWindowSizeService, useValue: popupWindowSize },
        PopupStateStore,
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(popupWindowSize.start).toHaveBeenCalledOnce();
    fixture.destroy();
    expect(popupWindowSize.destroy).toHaveBeenCalledOnce();
  });

  it("records user activity for vault timeout resets after startup", async () => {
    const timeout = { recordActivity: vi.fn() };
    const component = new AppComponent(
      { restoreStartup: vi.fn() } as any,
      { navigateByUrl: vi.fn() } as any,
      timeout as any,
      new PopupStateStore(),
    );

    await component.ngOnInit();
    component.recordActivity();

    expect(timeout.recordActivity).toHaveBeenCalledTimes(1);
  });

  it("ignores activity until deferred startup restoration has settled", async () => {
    const restoring = deferred<"login" | "locked" | "unlocked">();
    const timeout = { recordActivity: vi.fn() };
    const component = new AppComponent(
      { restoreStartup: vi.fn(() => restoring.promise) } as any,
      { navigateByUrl: vi.fn().mockResolvedValue(true) } as any,
      timeout as any,
      new PopupStateStore(),
    );

    const startup = component.ngOnInit();
    component.recordActivity();

    expect(timeout.recordActivity).not.toHaveBeenCalled();

    restoring.resolve("unlocked");
    await startup;
    component.recordActivity();

    expect(timeout.recordActivity).toHaveBeenCalledTimes(1);
  });

  it("renders the startup restoration state until deferred startup settles", async () => {
    const restoring = deferred<"login" | "locked" | "unlocked">();
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter([]),
        { provide: AuthFacade, useValue: { restoreStartup: vi.fn(() => restoring.promise) } },
        { provide: VaultTimeoutService, useValue: { recordActivity: vi.fn() } },
        PopupStateStore,
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector(".app-bootstrap-loading")?.textContent)
      .toContain("正在启动");
    expect(fixture.nativeElement.querySelector("router-outlet")).not.toBeNull();

    restoring.resolve("login");
    await vi.waitFor(() => {
      expect((fixture.componentInstance as any).startupPending()).toBe(false);
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector(".app-bootstrap-loading")).toBeNull();
  });

  it("does not report a keychain failure when startup navigation and login fallback both fail", async () => {
    const store = new PopupStateStore();
    const component = new AppComponent(
      { restoreStartup: vi.fn().mockResolvedValue("unlocked") } as any,
      {
        navigateByUrl: vi
          .fn()
          .mockRejectedValueOnce(new Error("primary route failed"))
          .mockRejectedValueOnce(new Error("fallback route failed")),
      } as any,
      { recordActivity: vi.fn() } as any,
      store,
    );

    await expect(component.ngOnInit()).resolves.toBeUndefined();
    expect(store.snapshot().loginError).toBe(
      "无法完成启动页面加载。请重新打开应用。",
    );
  });

  it.each([
    ["login", "/login"],
    ["locked", "/lock"],
    ["unlocked", "/tabs/vault"],
  ] as const)("routes startup result %s to %s", async (result, route) => {
    const navigateByUrl = vi.fn().mockResolvedValue(true);
    const component = new AppComponent(
      { restoreStartup: vi.fn().mockResolvedValue(result) } as any,
      { navigateByUrl } as any,
      { recordActivity: vi.fn() } as any,
      new PopupStateStore(),
    );

    await component.ngOnInit();

    expect(navigateByUrl).toHaveBeenCalledWith(route, { replaceUrl: true });
    expect(navigateByUrl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["two-factor", "/2fa"],
    ["new-device", "/new-device-verification"],
    ["locked", "/lock"],
    ["restored-vault", "/tabs/vault"],
  ] as const)("isolates %s evidence startup from restore and timeout activity", async (evidenceState, route) => {
    const restoreStartup = vi.fn();
    const navigateByUrl = vi.fn().mockResolvedValue(true);
    const timeout = { recordActivity: vi.fn() };
    const component = new AppComponent(
      { restoreStartup } as any,
      { navigateByUrl } as any,
      timeout as any,
      new PopupStateStore(),
      evidenceState as AuthEvidenceState,
    );

    await component.ngOnInit();
    component.recordActivity();

    expect(restoreStartup).toHaveBeenCalledTimes(0);
    expect(navigateByUrl).toHaveBeenCalledTimes(1);
    expect(navigateByUrl).toHaveBeenCalledWith(route, { replaceUrl: true });
    expect(timeout.recordActivity).not.toHaveBeenCalled();
  });

  it("keeps restored-vault evidence activity side-effect free after repeated document input", async () => {
    const restoreStartup = vi.fn();
    const timeout = { recordActivity: vi.fn() };
    const component = new AppComponent(
      { restoreStartup } as any,
      { navigateByUrl: vi.fn().mockResolvedValue(true) } as any,
      timeout as any,
      new PopupStateStore(),
      "restored-vault",
    );

    await component.ngOnInit();
    component.recordActivity();
    component.recordActivity();
    component.recordActivity();

    expect(restoreStartup).not.toHaveBeenCalled();
    expect(timeout.recordActivity).not.toHaveBeenCalled();
  });

  it("runs normal startup and activity without evidence mode", async () => {
    const restoreStartup = vi.fn().mockResolvedValue("locked");
    const timeout = { recordActivity: vi.fn() };
    const component = new AppComponent(
      { restoreStartup } as any,
      { navigateByUrl: vi.fn().mockResolvedValue(true) } as any,
      timeout as any,
      new PopupStateStore(),
      null,
    );

    await component.ngOnInit();
    component.recordActivity();

    expect(restoreStartup).toHaveBeenCalledTimes(1);
    expect(timeout.recordActivity).toHaveBeenCalledTimes(1);
  });

  it("uses the native process broker rather than URL parameters to choose attach startup", async () => {
    window.history.replaceState({}, "", "/?uilocation=popout#/tabs/generator");
    const restoreStartup = vi.fn().mockResolvedValue("unlocked");
    const attachProcessSession = vi.fn().mockResolvedValue("unlocked");
    const navigateByUrl = vi.fn().mockResolvedValue(true);
    const routeCache = { restore: vi.fn().mockResolvedValue(true) };
    const broker = new FakeAppProcessSessionBroker("attach", appBrokerSnapshot({
      authorization: "unlocked",
      activeAccountId: "account-1",
    }));
    const component = new AppComponent(
      {
        restoreStartup,
        attachProcessSession,
        publishProcessStartupState: vi.fn(),
      } as any,
      { navigateByUrl } as any,
      { recordActivity: vi.fn() } as any,
      new PopupStateStore(),
      null,
      null,
      null,
      null,
      null,
      routeCache as any,
      { hidePopup: vi.fn() } as any,
      broker,
    );

    await component.ngOnInit();

    expect(restoreStartup).not.toHaveBeenCalled();
    expect(attachProcessSession).toHaveBeenCalledWith(broker.snapshot);
    expect(routeCache.restore).not.toHaveBeenCalled();
    expect(navigateByUrl).toHaveBeenCalledWith("/tabs/generator", { replaceUrl: true });
    window.history.replaceState({}, "", "/");
  });

  it("recovers a popout from the persisted active session when an attach snapshot is unexpectedly signed out", async () => {
    window.history.replaceState({}, "", "/?uilocation=popout#/tabs/otp");
    const restoreStartup = vi.fn().mockResolvedValue("unlocked");
    const attachProcessSession = vi.fn().mockResolvedValue("login");
    const publishProcessStartupState = vi.fn().mockResolvedValue(
      appBrokerSnapshot({
        version: 1,
        authorization: "unlocked",
        activeAccountId: "account-1",
      }),
    );
    const navigateByUrl = vi.fn().mockResolvedValue(true);
    const broker = new FakeAppProcessSessionBroker("attach", appBrokerSnapshot());
    const component = new AppComponent(
      {
        restoreStartup,
        attachProcessSession,
        publishProcessStartupState,
      } as any,
      { navigateByUrl } as any,
      { recordActivity: vi.fn() } as any,
      new PopupStateStore(),
      null,
      null,
      null,
      null,
      null,
      null,
      { hidePopup: vi.fn() } as any,
      broker,
    );

    await component.ngOnInit();

    expect(attachProcessSession).toHaveBeenCalledWith(broker.snapshot);
    expect(restoreStartup).toHaveBeenCalledWith("additional-window");
    expect(publishProcessStartupState).toHaveBeenCalledWith("unlocked");
    expect(navigateByUrl).toHaveBeenCalledWith("/tabs/otp", { replaceUrl: true });
    window.history.replaceState({}, "", "/");
  });

  it("lets the process broker assign cold ownership even when the first surface is a popout", async () => {
    window.history.replaceState({}, "", "/?uilocation=popout#/tabs/settings");
    const restoreStartup = vi.fn().mockResolvedValue("locked");
    const attachProcessSession = vi.fn();
    const publishProcessStartupState = vi.fn().mockResolvedValue(null);
    const broker = new FakeAppProcessSessionBroker("cold", appBrokerSnapshot());
    const component = new AppComponent(
      { restoreStartup, attachProcessSession, publishProcessStartupState } as any,
      { navigateByUrl: vi.fn().mockResolvedValue(true) } as any,
      { recordActivity: vi.fn() } as any,
      new PopupStateStore(),
      null,
      null,
      null,
      null,
      null,
      null,
      { hidePopup: vi.fn() } as any,
      broker,
    );

    await component.ngOnInit();

    expect(restoreStartup).toHaveBeenCalledWith("cold");
    expect(attachProcessSession).not.toHaveBeenCalled();
    expect(publishProcessStartupState).toHaveBeenCalledWith("locked");
    window.history.replaceState({}, "", "/");
  });

  it("reconciles a newer process lock event and routes every surface to lock", async () => {
    const attachProcessSession = vi
      .fn()
      .mockResolvedValueOnce("unlocked")
      .mockResolvedValueOnce("locked");
    const navigateByUrl = vi.fn().mockResolvedValue(true);
    const broker = new FakeAppProcessSessionBroker(
      "attach",
      appBrokerSnapshot({
        version: 1,
        authorization: "unlocked",
        activeAccountId: "account-1",
      }),
    );
    const component = new AppComponent(
      {
        restoreStartup: vi.fn(),
        attachProcessSession,
        publishProcessStartupState: vi.fn(),
      } as any,
      { navigateByUrl, url: "/tabs/vault", events: { subscribe: () => ({ unsubscribe() {} }) } } as any,
      { recordActivity: vi.fn() } as any,
      new PopupStateStore(),
      null,
      null,
      null,
      null,
      null,
      null,
      { hidePopup: vi.fn() } as any,
      broker,
    );
    await component.ngOnInit();
    navigateByUrl.mockClear();

    broker.emit(appBrokerSnapshot({
      version: 2,
      authorization: "locked",
      activeAccountId: "account-1",
      originWindowLabel: "popout",
    }));

    await vi.waitFor(() =>
      expect(navigateByUrl).toHaveBeenCalledWith("/lock", { replaceUrl: true }),
    );
    expect(attachProcessSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ version: 2, authorization: "locked" }),
    );
  });

  it("keeps attached hydration alive when sync-started emits before its native invoke resolves", async () => {
    const initial = appBrokerSnapshot({
      authorization: "unlocked",
      activeAccountId: "account-1",
      syncState: "stale",
    });
    let current = initial;
    let listener: (() => void) | null = null;
    const events: ProcessSessionEventSource = {
      listen: async (next) => {
        listener = next;
        return () => {
          listener = null;
        };
      },
    };
    const host: ProcessSessionBrokerHost = {
      attachProcessSession: vi.fn(async () => ({
        startupMode: "attach" as const,
        snapshot: initial,
      })),
      processSessionSnapshot: vi.fn(async () => current),
      mutateProcessSession: vi.fn(async (mutation) => {
        current = snapshotAfterMutation(current, mutation);
        // Tauri can deliver the event before the invoke Promise resolves.
        listener?.();
        return current;
      }),
    };
    const broker = new ProcessSessionBrokerService(host, events);
    const store = new PopupStateStore();
    const activeSession = {
      environment: {
        apiUrl: "https://api.example.com",
        identityUrl: "https://identity.example.com",
      },
      token: {
        accessToken: "access",
        refreshToken: "refresh",
        tokenType: "Bearer",
        expiresIn: 3600,
        obtainedAtEpochMs: Date.now(),
      },
    };
    const sync = vi.fn(async () => emptyVaultSyncResult());
    const account = {
      id: "account-1",
      email: "person@example.com",
      serverUrl: "https://vault.example.com",
      status: "unlocked" as const,
      isActive: true,
    };
    const auth = new AuthFacade(
      store,
      null,
      { sync },
      null,
      undefined,
      {
        list: vi.fn(async () => [account]),
        readSession: vi.fn(async () => activeSession),
      } as any,
      undefined,
      null,
      undefined,
      null,
      null,
      null,
      broker,
    );
    const attachProcessSession = vi.spyOn(auth, "attachProcessSession");
    const component = new AppComponent(
      auth,
      {
        navigateByUrl: vi.fn().mockResolvedValue(true),
        url: "/tabs/vault",
        events: { subscribe: () => ({ unsubscribe() {} }) },
      } as any,
      { recordActivity: vi.fn() } as any,
      store,
      null,
      null,
      null,
      null,
      null,
      null,
      { hidePopup: vi.fn() } as any,
      broker,
    );

    await component.ngOnInit();
    await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(1));

    expect(attachProcessSession).toHaveBeenCalledTimes(1);
    expect(store.snapshot()).toMatchObject({
      isUnlocked: true,
      vaultSyncStatus: "fresh",
    });
    component.ngOnDestroy();
  });

  it.each([
    ["popup", "popout"],
    ["popout", "popup"],
  ] as const)(
    "reconciles the shared OTP tab from %s to %s without waiting for another auth boundary",
    async (originWindowLabel) => {
      const store = new PopupStateStore();
      const attachProcessSession = vi.fn(async (snapshot: ProcessSessionSnapshot) => {
        if (snapshot.version === 2) {
          store.setActiveTab("otp");
        }
        return "unlocked";
      });
      const navigateByUrl = vi.fn().mockResolvedValue(true);
      const broker = new FakeAppProcessSessionBroker(
        "attach",
        appBrokerSnapshot({
          version: 1,
          authorization: "unlocked",
          activeAccountId: "account-1",
        }),
      );
      const component = new AppComponent(
        {
          restoreStartup: vi.fn(),
          attachProcessSession,
          publishProcessStartupState: vi.fn(),
          publishProcessStateProjection: vi.fn(),
        } as any,
        {
          navigateByUrl,
          url: "/tabs/generator",
          events: { subscribe: () => ({ unsubscribe() {} }) },
        } as any,
        { recordActivity: vi.fn() } as any,
        store,
        null,
        null,
        null,
        null,
        null,
        null,
        { hidePopup: vi.fn() } as any,
        broker,
      );
      await component.ngOnInit();
      navigateByUrl.mockClear();

      broker.emit(appBrokerSnapshot({
        version: 2,
        authorization: "unlocked",
        activeAccountId: "account-1",
        originWindowLabel,
      }));

      await vi.waitFor(() =>
        expect(navigateByUrl).toHaveBeenCalledWith("/tabs/otp", { replaceUrl: true }),
      );
    },
  );

  it("publishes a tab switch without rebuilding the vault projection", async () => {
    const store = new PopupStateStore();
    store.setActiveSession({
      environment: {
        apiUrl: "https://api.example.com",
        identityUrl: "https://identity.example.com",
      },
      token: {
        accessToken: "access",
        refreshToken: "refresh",
        tokenType: "Bearer",
        expiresIn: 3600,
      },
    });
    store.setUnlocked("person@example.com");
    const publishProcessStateProjection = vi.fn();
    const publishProcessActiveTab = vi
      .fn()
      .mockResolvedValue(appBrokerSnapshot({ version: 2 }));
    const broker = new FakeAppProcessSessionBroker(
      "attach",
      appBrokerSnapshot({
        version: 1,
        authorization: "unlocked",
        activeAccountId: "account-1",
      }),
    );
    const component = new AppComponent(
      {
        restoreStartup: vi.fn(),
        attachProcessSession: vi.fn().mockResolvedValue("unlocked"),
        publishProcessStartupState: vi.fn(),
        publishProcessStateProjection,
        publishProcessActiveTab,
      } as any,
      {
        navigateByUrl: vi.fn().mockResolvedValue(true),
        url: "/tabs/vault",
        events: { subscribe: () => ({ unsubscribe() {} }) },
      } as any,
      { recordActivity: vi.fn() } as any,
      store,
      null,
      null,
      null,
      null,
      null,
      null,
      { hidePopup: vi.fn() } as any,
      broker,
    );
    await component.ngOnInit();
    publishProcessStateProjection.mockClear();
    publishProcessActiveTab.mockClear();

    store.setActiveTab("otp");

    await vi.waitFor(() =>
      expect(publishProcessActiveTab).toHaveBeenCalledWith("otp"),
    );
    expect(publishProcessStateProjection).not.toHaveBeenCalled();
  });

  it("debounces committed filter and hierarchy changes into a live shared projection", async () => {
    const store = new PopupStateStore();
    store.setActiveSession({
      environment: {
        apiUrl: "https://api.example.com",
        identityUrl: "https://identity.example.com",
      },
      token: {
        accessToken: "access",
        refreshToken: "refresh",
        tokenType: "Bearer",
        expiresIn: 3600,
      },
    });
    store.setUnlocked("person@example.com");
    const published = appBrokerSnapshot({
      version: 2,
      authorization: "unlocked",
      activeAccountId: "account-1",
    });
    const publishProcessStateProjection = vi.fn().mockResolvedValue(published);
    const attachProcessSession = vi.fn().mockResolvedValue("unlocked");
    const broker = new FakeAppProcessSessionBroker(
      "attach",
      appBrokerSnapshot({
        version: 1,
        authorization: "unlocked",
        activeAccountId: "account-1",
      }),
    );
    const component = new AppComponent(
      {
        restoreStartup: vi.fn(),
        attachProcessSession,
        publishProcessStartupState: vi.fn(),
        publishProcessStateProjection,
      } as any,
      {
        navigateByUrl: vi.fn().mockResolvedValue(true),
        url: "/tabs/vault",
        events: { subscribe: () => ({ unsubscribe() {} }) },
      } as any,
      { recordActivity: vi.fn() } as any,
      store,
      null,
      null,
      null,
      null,
      null,
      null,
      { hidePopup: vi.fn() } as any,
      broker,
    );
    await component.ngOnInit();
    publishProcessStateProjection.mockClear();

    store.setFilterType("card");
    store.setFilterVisible(false);
    store.toggleVaultSection("favorites");
    store.setActiveTab("otp");

    await vi.waitFor(() =>
      expect(publishProcessStateProjection).toHaveBeenCalledTimes(1),
    );
    expect(attachProcessSession).toHaveBeenCalledTimes(1);
  });

  it("retries the same projection after a transient broker publication failure", async () => {
    const store = new PopupStateStore();
    store.setActiveSession({
      environment: {
        apiUrl: "https://api.example.com",
        identityUrl: "https://identity.example.com",
      },
      token: {
        accessToken: "access",
        refreshToken: "refresh",
        tokenType: "Bearer",
        expiresIn: 3600,
      },
    });
    store.setUnlocked("person@example.com");
    const publishProcessStateProjection = vi
      .fn()
      .mockResolvedValue(appBrokerSnapshot({ version: 1 }));
    const broker = new FakeAppProcessSessionBroker(
      "attach",
      appBrokerSnapshot({
        version: 1,
        authorization: "unlocked",
        activeAccountId: "account-1",
      }),
    );
    const component = new AppComponent(
      {
        restoreStartup: vi.fn(),
        attachProcessSession: vi.fn().mockResolvedValue("unlocked"),
        publishProcessStartupState: vi.fn(),
        publishProcessStateProjection,
      } as any,
      {
        navigateByUrl: vi.fn().mockResolvedValue(true),
        url: "/tabs/vault",
        events: { subscribe: () => ({ unsubscribe() {} }) },
      } as any,
      { recordActivity: vi.fn() } as any,
      store,
      null,
      null,
      null,
      null,
      null,
      null,
      { hidePopup: vi.fn() } as any,
      broker,
    );
    await component.ngOnInit();
    publishProcessStateProjection
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(appBrokerSnapshot({ version: 2 }));

    store.setFilterType("card");
    await vi.waitFor(() =>
      expect(publishProcessStateProjection).toHaveBeenCalledTimes(1),
    );

    store.setFilterType("card");
    await vi.waitFor(() =>
      expect(publishProcessStateProjection).toHaveBeenCalledTimes(2),
    );
  });

  it("does not poll forever after a deterministic invalid projection", async () => {
    vi.useFakeTimers();
    const store = new PopupStateStore();
    store.setActiveSession({
      environment: { apiUrl: "https://api.example.com", identityUrl: "https://identity.example.com" },
      token: { accessToken: "access", refreshToken: "refresh", tokenType: "Bearer", expiresIn: 3600 },
    });
    store.setUnlocked("person@example.com");
    const publishProcessStateProjection = vi.fn().mockResolvedValue(undefined);
    const broker = new FakeAppProcessSessionBroker(
      "attach",
      appBrokerSnapshot({ version: 1, authorization: "unlocked", activeAccountId: "account-1" }),
    );
    const component = new AppComponent(
      {
        restoreStartup: vi.fn(),
        attachProcessSession: vi.fn().mockResolvedValue("unlocked"),
        publishProcessStartupState: vi.fn(),
        publishProcessStateProjection,
      } as any,
      {
        navigateByUrl: vi.fn().mockResolvedValue(true),
        url: "/tabs/vault",
        events: { subscribe: () => ({ unsubscribe() {} }) },
      } as any,
      { recordActivity: vi.fn() } as any,
      store,
      null,
      null,
      null,
      null,
      null,
      null,
      { hidePopup: vi.fn() } as any,
      broker,
    );
    await component.ngOnInit();
    publishProcessStateProjection.mockClear();

    store.setFilterType("card");
    await Promise.resolve();
    await Promise.resolve();
    expect(publishProcessStateProjection).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(publishProcessStateProjection).toHaveBeenCalledTimes(1);
    expect(store.snapshot().isUnlocked).toBe(true);
    component.ngOnDestroy();
    vi.useRealTimers();
  });

  it("isolates Send evidence startup from account restore and timeout activity", async () => {
    const restoreStartup = vi.fn();
    const navigateByUrl = vi.fn().mockResolvedValue(true);
    const timeout = { recordActivity: vi.fn() };
    const store = new PopupStateStore();
    const component = new (AppComponent as any)(
      { restoreStartup },
      { navigateByUrl },
      timeout,
      store,
      null,
      null,
      "populated",
    ) as AppComponent;

    await component.ngOnInit();
    component.recordActivity();

    expect(restoreStartup).not.toHaveBeenCalled();
    expect(navigateByUrl).toHaveBeenCalledWith("/tabs/send", { replaceUrl: true });
    expect(store.snapshot().sends[0]?.id).toBe("m12-text-send");
    expect(timeout.recordActivity).not.toHaveBeenCalled();
  });

  it("uses the token factory default so TestBed startup restores normally", async () => {
    const restoreStartup = vi.fn().mockResolvedValue("login");
    const timeout = { recordActivity: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter([]),
        { provide: AuthFacade, useValue: { restoreStartup } },
        { provide: VaultTimeoutService, useValue: timeout },
        PopupStateStore,
      ],
    }).compileComponents();

    expect(TestBed.inject(AUTH_EVIDENCE_STATE)).toBeNull();
    const fixture = TestBed.createComponent(AppComponent);
    const router = TestBed.inject(Router);
    const navigateByUrl = vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);
    fixture.detectChanges();
    await vi.waitFor(() => expect(restoreStartup).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(navigateByUrl).toHaveBeenCalledWith("/login", { replaceUrl: true }));
    await Promise.resolve();
    fixture.componentInstance.recordActivity();

    expect(restoreStartup).toHaveBeenCalledTimes(1);
    expect(navigateByUrl).toHaveBeenCalledWith("/login", { replaceUrl: true });
    expect(timeout.recordActivity).toHaveBeenCalledTimes(1);
  });

  it("honors a TestBed evidence token override without startup or activity side effects", async () => {
    const restoreStartup = vi.fn();
    const timeout = { recordActivity: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter([]),
        { provide: AuthFacade, useValue: { restoreStartup } },
        { provide: VaultTimeoutService, useValue: timeout },
        { provide: AUTH_EVIDENCE_STATE, useValue: "new-device" },
        PopupStateStore,
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AppComponent);
    const router = TestBed.inject(Router);
    const navigateByUrl = vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(navigateByUrl).toHaveBeenCalledWith("/new-device-verification", { replaceUrl: true }),
    );
    fixture.componentInstance.recordActivity();

    expect(restoreStartup).not.toHaveBeenCalled();
    expect(navigateByUrl).toHaveBeenCalledWith("/new-device-verification", { replaceUrl: true });
    expect(timeout.recordActivity).not.toHaveBeenCalled();
  });

  it("does not hide the popup when an overlay already consumed Escape", () => {
    const hidePopup = vi.fn().mockResolvedValue(undefined);
    const component = appComponentForEscape(hidePopup);
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
    });
    event.preventDefault();

    component.hideOnEscape(event);

    expect(hidePopup).not.toHaveBeenCalled();
  });

  it("keeps the popup visible while a menu or native select owns Escape", () => {
    const hidePopup = vi.fn().mockResolvedValue(undefined);
    const component = appComponentForEscape(hidePopup);
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.setAttribute("data-overlay-open", "true");
    document.body.append(menu);

    component.hideOnEscape(new KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
    }));
    expect(hidePopup).not.toHaveBeenCalled();

    menu.remove();
    const select = document.createElement("select");
    document.body.append(select);
    select.focus();
    component.hideOnEscape(new KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
    }));

    expect(hidePopup).not.toHaveBeenCalled();
    select.remove();
  });

  it("hides only the menu-bar popup when no overlay owns Escape", () => {
    window.history.replaceState({}, "", "/");
    const hidePopup = vi.fn().mockResolvedValue(undefined);
    const component = appComponentForEscape(hidePopup);
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
    });

    component.hideOnEscape(event);

    expect(event.defaultPrevented).toBe(true);
    expect(hidePopup).toHaveBeenCalledTimes(1);
  });

  it("preserves native macOS Escape behavior in a popout window", () => {
    window.history.replaceState({}, "", "/?uilocation=popout");
    const hidePopup = vi.fn().mockResolvedValue(undefined);
    const component = appComponentForEscape(hidePopup);
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      cancelable: true,
    });

    component.hideOnEscape(event);

    expect(event.defaultPrevented).toBe(false);
    expect(hidePopup).not.toHaveBeenCalled();
    window.history.replaceState({}, "", "/");
  });
});

function appComponentForEscape(hidePopup: ReturnType<typeof vi.fn>): AppComponent {
  return new AppComponent(
    { restoreStartup: vi.fn() } as any,
    { navigateByUrl: vi.fn() } as any,
    { recordActivity: vi.fn() } as any,
    new PopupStateStore(),
    null,
    null,
    null,
    null,
    null,
    null,
    { hidePopup } as any,
  );
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

class FakeAppProcessSessionBroker implements ProcessSessionBrokerPort {
  private readonly changesSubject = new ReplaySubject<ProcessSessionSnapshot>(1);
  readonly changes$ = this.changesSubject.asObservable();
  readonly mutations: ProcessSessionMutation[] = [];

  constructor(
    private readonly startupMode: "cold" | "attach",
    readonly snapshot: ProcessSessionSnapshot,
  ) {}

  async attach() {
    return { startupMode: this.startupMode, snapshot: this.snapshot };
  }

  async mutate(mutation: ProcessSessionMutation): Promise<ProcessSessionSnapshot> {
    this.mutations.push(mutation);
    return this.snapshot;
  }

  emit(snapshot: ProcessSessionSnapshot): void {
    this.changesSubject.next(snapshot);
  }

  destroy(): void {
    this.changesSubject.complete();
  }
}

function appBrokerSnapshot(
  overrides: Partial<ProcessSessionSnapshot> = {},
): ProcessSessionSnapshot {
  return {
    processGeneration: "process-generation",
    version: 0,
    syncVersion: 0,
    authorization: "signed-out",
    activeAccountId: null,
    syncState: "idle",
    failureCode: null,
    sharedSnapshot: null,
    originWindowLabel: null,
    ...overrides,
  };
}

function snapshotAfterMutation(
  current: ProcessSessionSnapshot,
  mutation: ProcessSessionMutation,
): ProcessSessionSnapshot {
  return {
    ...current,
    version: current.version + 1,
    authorization:
      mutation.type === "unlocked"
        ? "unlocked"
        : mutation.type === "locked" || mutation.type === "account-selected"
          ? "locked"
          : mutation.type === "logged-out"
            ? "signed-out"
            : mutation.type === "recovery-required"
              ? "recovery-required"
              : current.authorization,
    activeAccountId:
      "activeAccountId" in mutation
        ? mutation.activeAccountId
        : mutation.type === "logged-out"
          ? null
          : current.activeAccountId,
    syncState:
      mutation.type === "sync-started"
        ? "syncing"
        : mutation.type === "sync-succeeded"
          ? "fresh"
          : mutation.type === "sync-failed"
            ? "stale"
            : current.syncState,
    failureCode:
      "code" in mutation
        ? mutation.code
        : mutation.type === "sync-started" || mutation.type === "sync-succeeded"
          ? null
          : current.failureCode,
    sharedSnapshot:
      "sharedSnapshot" in mutation
        ? mutation.sharedSnapshot ?? current.sharedSnapshot
        : current.sharedSnapshot,
  };
}

function emptyVaultSyncResult() {
  return {
    items: [],
    archivedItems: [],
    deletedItems: [],
    folders: [],
    organizations: [],
    collections: [],
    sends: [],
    sendPolicy: { disabled: false, hideEmailAllowed: true },
    cipherCount: 0,
    encryptedCipherCount: 0,
    folderCount: 0,
    sendCount: 0,
  } as const;
}

function startupTransportFailure(): Error {
  const TransportError = (
    bitwardenApiModule as unknown as {
      HttpTransportError?: new (code: "unavailable") => Error;
    }
  ).HttpTransportError;
  return TransportError
    ? new TransportError("unavailable")
    : new Error("opaque synthetic failure");
}
