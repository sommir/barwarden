import "zone.js";
import "@angular/compiler";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { AuthFacade } from "./auth/auth.facade";
import { VaultTimeoutService } from "./auth/vault-timeout.service";
import { AppComponent } from "./app.component";
import { PopupStateStore } from "./popup-state";
import { POPUP_LIFECYCLE_HOST } from "./app.component";
import { OfficialI18nService } from "./official-ui/official-i18n.service";
import { PopupRouterCacheService } from "./platform/popup-router-cache.service";
import { VaultFacade } from "./vault/vault.facade";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [
      OfficialI18nService,
      { provide: I18nService, useExisting: OfficialI18nService },
    ],
  });
});

afterEach(() => {
  TestBed.resetTestingModule();
});

async function renderRoot({
  restoreStartup = vi.fn().mockResolvedValue("login"),
  navigateByUrl,
  routeCache = {
    clear: vi.fn(),
    restore: vi.fn(async () => false),
    hasBackTarget: vi.fn().mockReturnValue(false),
    back: vi.fn(async () => true),
  },
  store = new PopupStateStore(),
}: {
  restoreStartup?: ReturnType<typeof vi.fn>;
  navigateByUrl?: (url: string, options?: { replaceUrl?: boolean }) => Promise<boolean>;
  routeCache?: {
    clear: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
    hasBackTarget: ReturnType<typeof vi.fn>;
    back: ReturnType<typeof vi.fn>;
  };
  store?: PopupStateStore;
} = {}) {
  const timeout = { recordActivity: vi.fn() };
  const popupLifecycleHost = { hidePopup: vi.fn().mockResolvedValue(undefined) };

  await TestBed.configureTestingModule({
    imports: [AppComponent],
    providers: [
      provideRouter([]),
      OfficialI18nService,
      { provide: I18nService, useExisting: OfficialI18nService },
      { provide: AuthFacade, useValue: { restoreStartup } },
      { provide: PopupStateStore, useValue: store },
      { provide: VaultTimeoutService, useValue: timeout },
      { provide: POPUP_LIFECYCLE_HOST, useValue: popupLifecycleHost },
      { provide: PopupRouterCacheService, useValue: routeCache },
    ],
  }).compileComponents();

  const router = TestBed.inject(Router);
  const navigate = vi
    .spyOn(router, "navigateByUrl")
    .mockImplementation(navigateByUrl ?? (async () => true));

  const fixture = TestBed.createComponent(AppComponent);
  fixture.detectChanges();

  await vi.waitFor(() => expect(restoreStartup).toHaveBeenCalledTimes(1));

  return {
    fixture,
    navigateByUrl: navigate,
    popupLifecycleHost,
    routeCache,
    restoreStartup,
    store,
    timeout,
  };
}

describe("AppComponent rendering", () => {
  it("renders the router outlet root", async () => {
    const { fixture } = await renderRoot();

    const testHost = fixture.nativeElement as HTMLElement;
    const host = testHost.querySelector<HTMLElement>("barwarden-root") ?? testHost;
    expect(host.querySelector("router-outlet")).not.toBeNull();
  });

  it("keeps the pinned focus wrapper on the root host around the measured route source", async () => {
    const { fixture } = await renderRoot();

    const testHost = fixture.nativeElement as HTMLElement;
    const host = testHost.querySelector<HTMLElement>("barwarden-root") ?? testHost;
    expect(host.querySelector("router-outlet")?.parentElement?.className)
      .toBe("popup-window-size-source");
    expect(host.querySelectorAll(":scope > div[tabindex=\"0\"][aria-hidden=\"true\"]")).toHaveLength(2);
  });

  it("forces a fresh popup composition pass when the native window becomes visible again", async () => {
    const { fixture } = await renderRoot();
    const host = fixture.nativeElement as HTMLElement;
    const source = host.querySelector<HTMLElement>(".popup-window-size-source")!;

    expect(source.classList.contains("popup-window-size-source--render-recovery")).toBe(false);

    window.dispatchEvent(new Event("barwarden:popup-shown"));
    fixture.detectChanges();

    expect(source.classList.contains("popup-window-size-source--render-recovery")).toBe(true);
  });

  it("resets an unlocked popup to the vault search after one minute hidden", async () => {
    const store = new PopupStateStore();
    store.setUnlocked("user@example.com");
    store.setActiveTab("settings");
    store.setFilterFolderId("folder-1");
    store.setFilterType("login");
    const { fixture, navigateByUrl } = await renderRoot({
      restoreStartup: vi.fn().mockResolvedValue("unlocked"),
      store,
    });
    const vault = TestBed.inject(VaultFacade);
    vault.setSearch("github");
    const search = document.createElement("input");
    search.type = "search";
    const searchHost = document.createElement("bw-root-search");
    searchHost.append(search);
    (fixture.nativeElement as HTMLElement).append(searchHost);
    navigateByUrl.mockClear();

    window.dispatchEvent(new CustomEvent("barwarden:popup-entry", {
      detail: { reset: true },
    }));

    await vi.waitFor(() => expect(navigateByUrl).toHaveBeenCalledWith(
      "/tabs/vault",
      { replaceUrl: true },
    ));
    expect(store.snapshot().activeTab).toBe("vault");
    expect(store.snapshot().filterFolderId).toBe("");
    expect(store.snapshot().filterType).toBe("");
    expect(vault.queryValue()).toBe("");
    await vi.waitFor(() => expect(document.activeElement).toBe(search));
  });

  it("wraps focus through the root sentinels and removes listeners on teardown", async () => {
    TestBed.resetTestingModule();
    TestBed.overrideComponent(AppComponent, {
      set: {
        template: `
          <button type="button" class="first-control">First</button>
          <button type="button" class="last-control">Last</button>
          <router-outlet />
        `,
      },
    });

    const { fixture } = await renderRoot();
    const host = fixture.nativeElement as HTMLElement;
    const [start, end] = [...host.querySelectorAll<HTMLElement>(
      ':scope > div[tabindex="0"][aria-hidden="true"]',
    )];
    const first = host.querySelector<HTMLButtonElement>(".first-control")!;
    const last = host.querySelector<HTMLButtonElement>(".last-control")!;

    for (const control of [first, last]) {
      Object.defineProperty(control, "offsetParent", { configurable: true, value: host });
    }

    end!.focus();
    expect(document.activeElement).toBe(first);
    start!.focus();
    expect(document.activeElement).toBe(last);

    fixture.destroy();
    end!.focus();
    expect(document.activeElement).toBe(end);
  });

  it.each([
    ["login", "/login"],
    ["locked", "/lock"],
    ["unlocked", "/tabs/vault"],
  ] as const)("navigates %s startup state to %s", async (result, destination) => {
    const restoreStartup = vi.fn().mockResolvedValue(result);
    const { navigateByUrl } = await renderRoot({ restoreStartup });

    expect(restoreStartup).toHaveBeenCalledOnce();
    expect(navigateByUrl).toHaveBeenCalledWith(destination, { replaceUrl: true });
  });

  it("keeps startup failures on login with a sanitized status", async () => {
    const restoreStartup = vi
      .fn()
      .mockRejectedValue(new Error("secret keychain payload"));
    const { fixture, navigateByUrl, store } = await renderRoot({ restoreStartup });

    expect(navigateByUrl).toHaveBeenCalledWith("/login", { replaceUrl: true });
    expect(store.snapshot().loginError).toBe("");
    const host = fixture.nativeElement as HTMLElement;
    await vi.waitFor(() =>
      expect(host.querySelector('[data-testid="startup-failure-alert"]')).not.toBeNull(),
    );
    expect(host.textContent).toContain("无法恢复 Barwarden");
    expect(host.textContent).not.toContain("secret keychain payload");
  });

  it("keeps a known account on the lock screen when its saved session cannot be restored", async () => {
    const store = new PopupStateStore();
    const restoreStartup = vi.fn(async () => {
      store.setLockedAccount("user@example.test", "https://vault.example.test");
      throw new Error("keychain access denied");
    });
    const rendered = await renderRoot({ restoreStartup, store });
    await vi.waitFor(() => expect(rendered.navigateByUrl).toHaveBeenCalled());

    expect(rendered.navigateByUrl).toHaveBeenCalledWith("/lock", { replaceUrl: true });
    expect(store.snapshot().loginError).toBe("");
    const host = rendered.fixture.nativeElement as HTMLElement;
    await vi.waitFor(() =>
      expect(host.querySelector('[data-testid="startup-failure-alert"]')).not.toBeNull(),
    );
    expect(host.textContent).toContain("账户信息仍保留，请重新解锁。");
  });

  it("calls restoreStartup only once across repeated change detection", async () => {
    const restoreStartup = vi.fn().mockResolvedValue("login");
    const { fixture } = await renderRoot({ restoreStartup });

    fixture.detectChanges();

    expect(restoreStartup).toHaveBeenCalledOnce();
  });

  it("records keyboard and pointer activity through the host listeners", async () => {
    const { timeout } = await renderRoot();

    document.dispatchEvent(new Event("keydown"));
    document.dispatchEvent(new Event("pointerdown"));

    expect(timeout.recordActivity).toHaveBeenCalledTimes(2);
  });

  it("hides the native popup when Escape is pressed", async () => {
    const { popupLifecycleHost } = await renderRoot();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    await vi.waitFor(() => expect(popupLifecycleHost.hidePopup).toHaveBeenCalledOnce());
  });

  it("uses mounted root Escape to return a secondary route before hiding", async () => {
    const routeCache = {
      clear: vi.fn(),
      restore: vi.fn(async () => false),
      hasBackTarget: vi.fn().mockReturnValue(true),
      back: vi.fn(async () => true),
    };
    const { popupLifecycleHost } = await renderRoot({ routeCache });

    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }));

    expect(routeCache.back).toHaveBeenCalledOnce();
    expect(popupLifecycleHost.hidePopup).not.toHaveBeenCalled();
  });

  it("leaves Escape to an open native dialog", async () => {
    const { popupLifecycleHost } = await renderRoot();
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    document.body.append(dialog);
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });

    dialog.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(popupLifecycleHost.hidePopup).not.toHaveBeenCalled();
    dialog.remove();
  });
});
