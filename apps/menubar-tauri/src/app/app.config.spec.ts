import "zone.js";
import "@angular/compiler";

import { Location } from "@angular/common";
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { OVERLAY_DEFAULT_CONFIG } from "@angular/cdk/overlay";
import { NavigationEnd, Router } from "@angular/router";
import { filter } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { AppComponent } from "./app.component";
import { appConfig } from "./app.config";
import { AuthFacade, type AuthStartupResult } from "./auth/auth.facade";
import { ACCOUNT_LOGOUT_CLEANUP_PORT } from "./auth/account-logout-cleanup";
import { CompositeAccountCleanupService } from "./auth/composite-account-cleanup.service";
import {
  BIOMETRIC_PREFERENCE_PORT,
  UNLOCK_METHODS_PORT,
} from "./auth/unlock-methods.port";
import { UnlockMethodsService } from "./auth/unlock-methods.service";
import { VaultTimeoutService } from "./auth/vault-timeout.service";
import { PopupStateStore } from "./popup-state";
import { SETTINGS_EVIDENCE_STATE } from "./settings/settings-evidence-state";
import { SettingsService } from "./settings/settings.service";
import { VaultActionsService } from "./vault/vault-actions.service";
import { VAULT_MAIN_EVIDENCE_STATE } from "./vault/vault-main-evidence-state";
import {
  AUTOFILL_PROJECTION_HOST,
  NativeAutoFillProjectionHost,
} from "./autofill/autofill-projection.service";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("appConfig bootstrap router integration", () => {
  it("keeps Vault Main evidence disabled in the normal test build", async () => {
    await TestBed.configureTestingModule({ providers: [...appConfig.providers] }).compileComponents();
    expect(TestBed.inject(VAULT_MAIN_EVIDENCE_STATE, null)).toBeNull();
  });

  it("uses the cross-engine CDK overlay container instead of native popovers", async () => {
    await TestBed.configureTestingModule({ providers: [...appConfig.providers] }).compileComponents();

    expect(TestBed.inject(OVERLAY_DEFAULT_CONFIG)).toEqual({ usePopover: false });
  });

  it("binds the production alternative-unlock port to its real service", async () => {
    await TestBed.configureTestingModule({ providers: [...appConfig.providers] }).compileComponents();

    expect(TestBed.inject(UNLOCK_METHODS_PORT)).toBe(TestBed.inject(UnlockMethodsService));
  });

  it("binds native AutoFill projection commands explicitly in the production app graph", async () => {
    await TestBed.configureTestingModule({ providers: [...appConfig.providers] }).compileComponents();

    expect(TestBed.inject(AUTOFILL_PROJECTION_HOST)).toBeInstanceOf(NativeAutoFillProjectionHost);
  });

  it("binds account security preferences and logout cleanup to the composed services", async () => {
    await TestBed.configureTestingModule({ providers: [...appConfig.providers] }).compileComponents();

    expect(TestBed.inject(BIOMETRIC_PREFERENCE_PORT)).toBe(TestBed.inject(SettingsService));
    expect(TestBed.inject(ACCOUNT_LOGOUT_CLEANUP_PORT)).toBe(
      TestBed.inject(CompositeAccountCleanupService),
    );
  });

  it("boots an explicit Settings evidence state without restoring an account", async () => {
    const store = new PopupStateStore();
    const restoreStartup = vi.fn(async () => "login" as const);
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        ...appConfig.providers,
        { provide: SETTINGS_EVIDENCE_STATE, useValue: "appearance" },
        { provide: PopupStateStore, useValue: store },
        { provide: SettingsService, useValue: new SettingsService() },
        { provide: AuthFacade, useValue: { restoreStartup } },
        { provide: VaultTimeoutService, useValue: { recordActivity: vi.fn() } },
      ],
    }).compileComponents();
    const router = TestBed.inject(Router);
    const location = TestBed.inject(Location);
    TestBed.createComponent(AppComponent).detectChanges();

    await vi.waitFor(() => expect(location.path()).toBe("/appearance"));
    expect(router.url).toBe("/appearance");
    expect(restoreStartup).not.toHaveBeenCalled();
    expect(store.snapshot()).toMatchObject({
      activeSession: null,
      email: "m13-settings-runtime",
      serverUrl: "https://vault.example.test",
      isUnlocked: true,
    });
  });

  it("keeps the root URL until restore settles, then routes directly to unlocked without an intermediate login navigation", async () => {
    const restoreStartup = deferred<AuthStartupResult>();
    const { location, navigationEnds } = await renderApp(() => restoreStartup.promise);

    expect(location.path()).toBe("");
    expect(navigationEnds).toEqual([]);

    restoreStartup.resolve("unlocked");

    await vi.waitFor(() => expect(location.path()).toBe("/tabs/vault"));
    expect(navigationEnds).toEqual(["/tabs/vault"]);
    expect(navigationEnds).not.toContain("/login");
  });

  it.each([
    ["login", "/login"],
    ["locked", "/lock"],
  ] as const)("routes %s directly after restore settles", async (result, destination) => {
    const restoreStartup = deferred<AuthStartupResult>();
    const { location, navigationEnds } = await renderApp(() => restoreStartup.promise);

    expect(location.path()).toBe("");

    restoreStartup.resolve(result);

    await vi.waitFor(() => expect(location.path()).toBe(destination));
    expect(navigationEnds).toEqual([destination]);
  });
});

async function renderApp(restoreStartupImpl: () => Promise<AuthStartupResult>) {
  const store = new PopupStateStore();
  const timeout = { recordActivity: vi.fn() };
  const restoreStartup = vi.fn(async () => {
    const result = await restoreStartupImpl();
    if (result === "unlocked") {
      store.setUnlocked("user@example.test");
    } else if (result === "locked") {
      store.setLockedAccount("user@example.test", "https://vault.example.test");
    } else {
      store.setLoggedOut();
    }
    return result;
  });

  await TestBed.configureTestingModule({
    imports: [AppComponent],
    providers: [
      ...appConfig.providers,
      { provide: AuthFacade, useValue: { restoreStartup } },
      { provide: PopupStateStore, useValue: store },
      { provide: VaultTimeoutService, useValue: timeout },
      {
        provide: VaultActionsService,
        useValue: {
          copyField: async () => "Copied",
          fillField: async () => "Filled",
          launchItem: async () => "Opened URL",
          toggleFavorite: async () => "Added to favorites",
          archiveItem: async () => "Archived item",
          deleteItem: async () => "Moved item to trash",
          unarchiveItem: async () => "Item unarchived",
          deleteArchivedItem: async () => "Moved item to trash",
          restoreDeletedItem: async () => "Item restored",
          permanentlyDeleteItem: async () => "Item permanently deleted",
        },
      },
    ],
  }).compileComponents();

  const router = TestBed.inject(Router);
  const location = TestBed.inject(Location);
  const navigationEnds: string[] = [];

  router.events
    .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
    .subscribe((event) => navigationEnds.push(event.urlAfterRedirects));

  const fixture = TestBed.createComponent(AppComponent);
  fixture.detectChanges();

  return { fixture, location, navigationEnds, store, timeout };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
