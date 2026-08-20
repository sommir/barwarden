import "zone.js";
import "@angular/compiler";

import { BrowserTestingModule, platformBrowserTesting } from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { provideRouter, Router } from "@angular/router";
import { of } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { PopupStateStore } from "../popup-state";
import { PopupRouterCacheService } from "../platform/popup-router-cache.service";
import { OfficialPasswordHintComponent } from "../upstream-overlays/auth/login/official-password-hint.component";
import { OfficialPasswordAuthAdapter } from "./official-password-auth.adapter";
import { OfficialPasswordHintApiAdapter } from "./official-password-hint-api.adapter";
import { PasswordHintPageComponent } from "./password-hint-page.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) throw error;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

describe("PasswordHintPageComponent", () => {
  async function createPage(options: {
    request?: (serverUrl: string, email: string) => Promise<void>;
    rememberedEmail?: string;
    navigationEmail?: string;
    store?: PopupStateStore;
  } = {}) {
    TestBed.resetTestingModule();
    const store = options.store ?? new PopupStateStore();
    const request = vi.fn(options.request ?? (async () => undefined));
    const auth = {
      rememberedEmail$: of(options.rememberedEmail ?? ""),
      takeNavigationEmail: vi.fn(() => options.navigationEmail ?? ""),
      setNavigationEmail: vi.fn(),
      cancel: vi.fn(),
      rememberEmail: vi.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [PasswordHintPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        { provide: OfficialPasswordAuthAdapter, useValue: auth },
        { provide: OfficialPasswordHintApiAdapter, useValue: { request } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(PasswordHintPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return {
      fixture,
      request,
      auth,
      store,
      router: TestBed.inject(Router),
      official: fixture.debugElement.query(By.directive(OfficialPasswordHintComponent))
        .componentInstance as OfficialPasswordHintComponent,
    };
  }

  it("owns the hint route through official primitives and prefers ephemeral route email", async () => {
    const { fixture, official } = await createPage({
      rememberedEmail: "persisted@example.com",
      navigationEmail: "route-only@example.com",
    });
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector("bw-official-anonymous-shell")).not.toBeNull();
    expect(host.querySelector("bit-form-field input[bitinput][formcontrolname=email]")).not.toBeNull();
    expect(host.querySelector("button[bitbutton][bitformbutton][type=submit]")).not.toBeNull();
    expect(official.formGroup.controls.email.value).toBe("route-only@example.com");
  });

  it("renders the secondary hint route with the shared popup back control", async () => {
    const { fixture, auth, router } = await createPage();
    const host = fixture.nativeElement as HTMLElement;
    const navigate = vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);

    expect(host.querySelectorAll("popup-page")).toHaveLength(1);
    expect(host.querySelector("popup-page h1")?.textContent?.trim()).toBe("请求密码提示");
    const headerBack = host.querySelector<HTMLButtonElement>(
      'popup-header button[aria-label="返回"], popup-header button[aria-label="Back"]',
    );
    expect(headerBack).not.toBeNull();
    headerBack!.click();
    await fixture.whenStable();

    expect(auth.cancel).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("/login");
  });

  it("lets the mounted route owner handle secondary Escape through the popup navigator", async () => {
    const { fixture, auth, router } = await createPage();
    const navigate = vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);

    await TestBed.inject(PopupRouterCacheService).back();
    await fixture.whenStable();

    expect(auth.cancel).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("/login");
    expect(navigate).not.toHaveBeenCalledWith("/tabs/vault", expect.anything());
  });

  it.each([
    ["https://vault.bitwarden.com", "https://vault.bitwarden.com"],
    ["https://vault.bitwarden.eu", "https://vault.bitwarden.eu"],
    ["https://vault.example.test", "https://vault.example.test"],
  ])("uses %s and returns only after the current request completes", async (serverUrl, expected) => {
    const store = new PopupStateStore();
    store.setServerUrl(serverUrl);
    const { official, request, router } = await createPage({ store });
    const navigate = vi.fn(async () => true);
    router.navigateByUrl = navigate;
    official.formGroup.controls.email.setValue("person@example.com");
    await official.submit();
    expect(request).toHaveBeenCalledWith(expected, "person@example.com");
    expect(navigate).toHaveBeenCalledWith("/login");
  });

  it("keeps generic success and failure messages, rejects invalid email, and deduplicates submits", async () => {
    const pending = deferred<void>();
    const { official, request, store } = await createPage({ request: () => pending.promise });
    official.formGroup.controls.email.setValue("invalid");
    await official.submit();
    expect(request).not.toHaveBeenCalled();

    official.formGroup.controls.email.setValue("person@example.com");
    const first = official.submit();
    const duplicate = official.submit();
    expect(request).toHaveBeenCalledOnce();
    pending.resolve();
    await Promise.all([first, duplicate]);
    expect(store.snapshot().statusMessage).toBe("我们已经向您发送了一封包含主密码提示的电子邮件。");

    const failure = await createPage({ request: async () => { throw new Error("server secret"); } });
    failure.official.formGroup.controls.email.setValue("person@example.com");
    await failure.official.submit();
    expect(failure.store.snapshot().statusMessage).toBe("无法请求密码提示。请检查服务器连接后重试。");
    expect(failure.store.snapshot().statusMessage).not.toContain("server secret");
  });

  it("cancels to login with ephemeral email only and suppresses stale route and destroy completions", async () => {
    const { official, auth, router } = await createPage();
    const navigate = vi.fn(async () => true);
    router.navigateByUrl = navigate;
    official.formGroup.controls.email.setValue("route-only@example.com");
    await official.cancel();
    expect(auth.setNavigationEmail).toHaveBeenCalledWith("route-only@example.com");
    expect(auth.rememberEmail).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/login");

    const pending = deferred<void>();
    const stale = await createPage({ request: () => pending.promise });
    const staleNavigate = vi.fn(async () => false);
    stale.router.navigateByUrl = staleNavigate;
    stale.official.formGroup.controls.email.setValue("person@example.com");
    const submit = stale.official.submit();
    await stale.official.cancel();
    pending.resolve();
    await submit;
    expect(staleNavigate).toHaveBeenCalledTimes(1);

    const destroyed = deferred<void>();
    const page = await createPage({ request: () => destroyed.promise });
    page.official.formGroup.controls.email.setValue("person@example.com");
    const request = page.official.submit();
    page.fixture.destroy();
    destroyed.resolve();
    await request;
    expect(page.router.url).not.toBe("/login");
  });

  it("consumes route email once and does not retain it when the hint route is abandoned", async () => {
    const { fixture, official, auth } = await createPage({ navigationEmail: "route-only@example.com" });
    expect(official.formGroup.controls.email.value).toBe("route-only@example.com");
    expect(auth.takeNavigationEmail).toHaveBeenCalledOnce();
    fixture.destroy();
    expect(auth.setNavigationEmail).not.toHaveBeenCalled();
  });
});
