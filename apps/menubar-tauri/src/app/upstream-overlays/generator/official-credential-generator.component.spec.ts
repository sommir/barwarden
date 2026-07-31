import "zone.js";
import "@angular/compiler";

import { BrowserTestingModule, platformBrowserTesting } from "@angular/platform-browser/testing";
import { By } from "@angular/platform-browser";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { Algorithm, CredentialGeneratorService } from "@bitwarden/generator-core";
import { GeneratorHistoryService } from "@bitwarden/generator-history";

import type { HostApi } from "../../../host/host-api";
import { PopupStateStore } from "../../popup-state";
import { officialCurrentAccountTestProviders } from "../../official-ui/official-current-account.test-support";
import { OfficialI18nService } from "../../official-ui/official-i18n.service";
import { PopupPageComponent } from "../../layout/popup-page.component";
import { TauriPopupPlatformUtilsAdapter } from "../pop-out/platform-utils.adapter";
import { ClipboardPolicyService } from "../../settings/clipboard-policy.service";
import {
  GENERATOR_CLIPBOARD_HOST,
  GENERATOR_CLIPBOARD_POLICY,
  GENERATOR_RUNTIME,
  GENERATOR_STATUS,
  type GeneratorClipboardPolicyPort,
} from "../../generator/generator-runtime.port";
import { GeneratorService, type GeneratorSettingsSnapshot } from "../../generator/generator.service";
import { OfficialCredentialGeneratorServiceAdapter } from "../../generator/official-credential-generator-service.adapter";
import { OfficialGeneratorAccountAdapter } from "../../generator/official-generator-account.adapter";
import { OfficialGeneratorHistoryAdapter } from "../../generator/official-generator-history.adapter";
import { OfficialGeneratorLogAdapter } from "../../generator/official-generator-log.adapter";
import { OfficialGeneratorToastAdapter } from "../../generator/official-generator-toast.adapter";
import { GeneratorClipboardDirective } from "../../generator/generator-clipboard.directive";
import { OfficialCredentialGeneratorComponent } from "./official-credential-generator.component";
import { OfficialGeneratorCoreComponent } from "./official-generator-core.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) throw error;
}

describe("OfficialCredentialGeneratorComponent", () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("retains the official popup shell, core hierarchy, value card, and history route", async () => {
    const { fixture } = await createFixture();
    await render(fixture);
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector("popup-page bw-official-generator-core")).not.toBeNull();
    expect(host.querySelector("popup-header bw-popup-header-actions")).not.toBeNull();
    expect(host.querySelector("bit-toggle-group + bit-card bit-color-password")).not.toBeNull();
    expect(host.querySelector('a[routerlink="/generator-history"]')).not.toBeNull();
    expect(host.querySelector("nudge-generator-spotlight")).toBeNull();
    expect(host.querySelector("bit-color-password")?.className).toMatch(/tw-break-words/);
  });

  it("generates initially, switches mode, and regenerates from the official icon actions", async () => {
    const service = generatorService();
    const { fixture } = await createFixture(service);
    await render(fixture);

    expect(service.generate).toHaveBeenCalledWith("password", expect.any(Function));
    expect(fixture.nativeElement.querySelector("bw-official-generator-core bit-color-password")?.textContent)
      .toContain("first-password");

    clickToggle(fixture.nativeElement, "密码短语");
    await render(fixture);
    expect(service.generate).toHaveBeenLastCalledWith("passphrase", expect.any(Function));
    expect(fixture.nativeElement.querySelector('button[aria-label="生成密码短语"]')).not.toBeNull();

    service.generate.mockResolvedValueOnce(result("next-passphrase", "passphrase"));
    fixture.nativeElement.querySelector<HTMLButtonElement>('button[aria-label="生成密码短语"]')?.click();
    await render(fixture);
    expect(fixture.nativeElement.querySelector("bit-color-password")?.textContent).toContain("next-passphrase");
  });

  it("publishes only the newest rapid regenerate completion", async () => {
    const service = generatorService();
    const { fixture } = await createFixture(service);
    await render(fixture);
    const first = deferred<GeneratedResult>();
    const second = deferred<GeneratedResult>();
    service.generate.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const generated = vi.fn();
    core(fixture).onGenerated.subscribe(generated);
    await core(fixture).generate("user request");
    await vi.waitFor(() => expect(service.generate).toHaveBeenCalledTimes(2));
    await core(fixture).generate("user request");
    second.resolve(result("newest-result", "password"));
    await settle(fixture);
    first.resolve(result("stale-result", "password"));
    await settle(fixture);

    expect(generated).toHaveBeenCalledTimes(1);
    expect(generated.mock.calls[0]?.[0].credential).toBe("newest-result");
    expect(fixture.nativeElement.textContent).toContain("newest-result");
    expect(fixture.nativeElement.textContent).not.toContain("stale-result");
  });

  it("waits for official settings persistence before regenerating", async () => {
    const persisted = deferred<GeneratorSettingsSnapshot>();
    const service = generatorService({ updatePasswordSettings: vi.fn(() => persisted.promise) });
    const { fixture } = await createFixture(service);
    await render(fixture);
    service.generate.mockClear();
    changeControl(fixture.nativeElement, "length", "128");
    await vi.waitFor(() => expect(service.updatePasswordSettings).toHaveBeenCalledOnce());
    expect(service.generate).not.toHaveBeenCalled();

    persisted.resolve(settings({ length: 128 }));
    await vi.waitFor(() => expect(service.generate).toHaveBeenCalledWith("password", expect.any(Function)));
  });

  it("tracks generated output against the account owned by the official core", async () => {
    const service = generatorService();
    const { fixture, store } = await createFixture(service);
    await render(fixture);
    const history = TestBed.inject(OfficialGeneratorHistoryAdapter);
    const track = vi.spyOn(history, "track");
    service.generate.mockResolvedValueOnce(result("owned-secret", "password"));

    await core(fixture).generate("user request");
    await vi.waitFor(() => expect(track).toHaveBeenCalledWith(
      "account-a", "owned-secret", "password", expect.any(Date), "password",
    ));
    expect(store.snapshot().statusMessage).not.toContain("owned-secret");
  });

  it("ignores generation completion after teardown without logging a credential", async () => {
    const generation = deferred<GeneratedResult>();
    const service = generatorService();
    const { fixture, store } = await createFixture(service);
    await render(fixture);
    service.generate.mockReturnValueOnce(generation.promise);
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await core(fixture).generate("user request");
    fixture.destroy();
    generation.resolve(result("destroyed-secret", "password"));
    await Promise.resolve();

    expect(store.snapshot().statusMessage).not.toContain("destroyed-secret");
    expect(JSON.stringify(logged.mock.calls)).not.toContain("destroyed-secret");
  });

  it("copies with the configured timeout and contains success/failure details", async () => {
    const host = new RecordingHost();
    const { fixture, store } = await createFixture(undefined, host);
    await render(fixture);

    await clipboardDirective(fixture).copy();
    expect(host.copied).toEqual(["first-password"]);
    expect(host.clearAfterSeconds).toEqual([30]);
    expect(store.snapshot().statusMessage).toBe("已复制生成结果");
    expect(store.snapshot().statusMessage).not.toContain("first-password");
    expect(window.location.href).not.toContain("first-password");
    expect(JSON.stringify(localStorage)).not.toContain("first-password");
    fixture.detectChanges();
    const copyButton = fixture.debugElement
      .query(By.directive(GeneratorClipboardDirective))
      .nativeElement as HTMLButtonElement;
    expect(copyButton?.querySelector(".bwi-check")).not.toBeNull();
    expect(copyButton?.getAttribute("aria-label")).toContain("已复制");

    host.failure = new Error("copy failed around first-password");
    await expect(clipboardDirective(fixture).copy()).rejects.toThrow("copy failed");
    expect(store.snapshot().statusMessage).not.toContain("first-password");
  });

  it("rechecks active unlocked ownership after clipboard completion before publishing success", async () => {
    const clipboard = deferred<void>();
    const policy: GeneratorClipboardPolicyPort = { copy: vi.fn(() => clipboard.promise) };
    const service = generatorService();
    const { fixture, store } = await createFixture(service, null, policy);
    await render(fixture);

    const copy = clipboardDirective(fixture).copy();
    await vi.waitFor(() => expect(policy.copy).toHaveBeenCalledOnce());
    service.activeSettings.mockRejectedValueOnce(new Error("Active account is locked"));
    clipboard.resolve();
    await copy;

    expect(store.snapshot().statusMessage).not.toBe("已复制生成结果");
  });

  it("keeps an active official generation alive while clipboard work completes", async () => {
    const generation = deferred<GeneratedResult>();
    const service = generatorService();
    const host = new RecordingHost();
    const { fixture } = await createFixture(service, host);
    await render(fixture);
    service.generate.mockReturnValueOnce(generation.promise);

    await core(fixture).generate("user request");
    await clipboardDirective(fixture).copy();
    generation.resolve(result("regenerated-value", "password"));
    await settle(fixture);

    expect(host.copied).toEqual(["first-password"]);
    expect(fixture.nativeElement.textContent).toContain("regenerated-value");
  });

  it("renders and generates through the official provider-free username settings branches", async () => {
    const service = generatorService();
    const { fixture } = await createFixture(service);
    await render(fixture);
    const state = coreState(fixture);

    expect(fixture.nativeElement.querySelectorAll("bit-toggle")).toHaveLength(3);
    state.onRootChanged({ nav: "identifier" });
    await settle(fixture);
    expect(fixture.nativeElement.querySelector('[data-testid="username-type"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector("tools-username-settings")).not.toBeNull();
    expect(fixture.nativeElement.querySelector("bw-generator-username-compatibility-host")).toBeNull();
    expect(service.generate).toHaveBeenCalledWith("username", expect.any(Function));

    state.username.controls.nav.setValue(JSON.stringify(Algorithm.plusAddress));
    await settle(fixture);
    expect(fixture.nativeElement.querySelector("tools-subaddress-settings")).not.toBeNull();
    expect(fixture.nativeElement.querySelector('input[formcontrolname="subaddressEmail"]')).not.toBeNull();

    state.username.controls.nav.setValue(JSON.stringify(Algorithm.catchall));
    await settle(fixture);
    expect(fixture.nativeElement.querySelector("tools-catchall-settings")).not.toBeNull();
    expect(fixture.nativeElement.querySelector('input[formcontrolname="catchallDomain"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toMatch(/forwarded|forwarder|转发服务/i);
  });

  it("blocks generation until active-account initialization settles", async () => {
    const active = deferred<{ accountId: string; settings: GeneratorSettingsSnapshot }>();
    const generated = deferred<GeneratedResult>();
    const service = generatorService({
      activeSettings: vi.fn(() => active.promise),
      generate: vi.fn(() => generated.promise),
    });
    const { fixture } = await createFixture(service);
    fixture.detectChanges(false);

    await Promise.resolve();
    expect(service.generate).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[role="status"]')?.textContent).toContain("正在生成");
    expect(fixture.nativeElement.querySelector("bit-color-password")).toBeNull();

    active.resolve({ accountId: "account-a", settings: settings() });
    await vi.waitFor(() => expect(service.generate).toHaveBeenCalledWith("password", expect.any(Function)));
    generated.resolve(result("initialized-password", "password"));
    await render(fixture);

    expect(fixture.nativeElement.textContent).toContain("initialized-password");
    expect(fixture.nativeElement.querySelector('[role="status"]')).toBeNull();
  });

  it("serializes overlapping official settings updates and publishes after each persistence", async () => {
    const first = deferred<GeneratorSettingsSnapshot>();
    const second = deferred<GeneratorSettingsSnapshot>();
    const service = generatorService();
    service.updatePasswordSettings
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { fixture } = await createFixture(service);
    await render(fixture);

    service.generate.mockClear();
    changeControl(fixture.nativeElement, "length", "20");
    changeControl(fixture.nativeElement, "length", "21");
    await vi.waitFor(() => expect(service.updatePasswordSettings).toHaveBeenCalledTimes(1));
    expect(service.generate).not.toHaveBeenCalled();

    first.resolve(settings({ length: 20 }));
    await vi.waitFor(() => expect(service.updatePasswordSettings).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(service.generate).toHaveBeenCalledTimes(1));

    second.resolve(settings({ length: 21 }));
    await vi.waitFor(() => expect(service.generate).toHaveBeenCalledTimes(2));
    await settle(fixture);
    expect(fixture.nativeElement.querySelector<HTMLInputElement>('input[formcontrolname="length"]')?.value)
      .toBe("21");
  });

  it("contains generation failures and recovers on retry", async () => {
    const service = generatorService();
    const { fixture, store } = await createFixture(service);
    await render(fixture);
    service.generate.mockRejectedValueOnce(new Error("failed around generated-secret"));

    await core(fixture).generate("user request");
    await settle(fixture);
    expect(store.snapshot().statusMessage).toBe("无法生成凭据。");
    expect(fixture.nativeElement.textContent).not.toContain("generated-secret");
    expect(store.snapshot().statusMessage).not.toContain("generated-secret");

    service.generate.mockResolvedValueOnce(result("recovered-password", "password"));
    await core(fixture).generate("user request");
    await settle(fixture);
    expect(fixture.nativeElement.textContent).toContain("recovered-password");
  });

  it("reloads active-account settings when the retained route is re-entered", async () => {
    const service = generatorService();
    let routeAccount = { accountId: "account-a", settings: settings({ length: 14 }) };
    service.activeSettings.mockImplementation(async () => routeAccount);

    const first = await createFixture(service);
    await render(first.fixture);
    await vi.waitFor(() => expect(
      first.fixture.nativeElement.querySelector<HTMLInputElement>('input[formcontrolname="length"]')?.value,
    ).toBe("14"));
    first.fixture.destroy();
    TestBed.resetTestingModule();

    routeAccount = { accountId: "account-b", settings: settings({ length: 24 }) };
    const second = await createFixture(service);
    await render(second.fixture);
    await vi.waitFor(() => expect(
      second.fixture.nativeElement.querySelector<HTMLInputElement>('input[formcontrolname="length"]')?.value,
    ).toBe("24"));
  });
});

type GeneratedResult = Awaited<ReturnType<GeneratorService["generate"]>>;

async function createFixture(
  generator = generatorService(),
  clipboard: HostApi | null = null,
  clipboardPolicy: GeneratorClipboardPolicyPort | null = null,
) {
  const store = new PopupStateStore();
  TestBed.overrideComponent(PopupPageComponent, { set: { template: "<ng-content />" } });
  await TestBed.configureTestingModule({
    imports: [OfficialCredentialGeneratorComponent],
    providers: [
      provideRouter([]),
      OfficialI18nService,
      { provide: I18nService, useExisting: OfficialI18nService },
      ...officialCurrentAccountTestProviders(),
      { provide: PopupStateStore, useValue: store },
      { provide: GENERATOR_CLIPBOARD_HOST, useValue: clipboard },
      { provide: GENERATOR_RUNTIME, useValue: generator },
      { provide: GENERATOR_STATUS, useValue: store },
      OfficialGeneratorAccountAdapter,
      OfficialCredentialGeneratorServiceAdapter,
      OfficialGeneratorHistoryAdapter,
      OfficialGeneratorLogAdapter,
      OfficialGeneratorToastAdapter,
      TauriPopupPlatformUtilsAdapter,
      { provide: PlatformUtilsService, useExisting: TauriPopupPlatformUtilsAdapter },
      { provide: CredentialGeneratorService, useExisting: OfficialCredentialGeneratorServiceAdapter },
      { provide: GeneratorHistoryService, useExisting: OfficialGeneratorHistoryAdapter },
      { provide: LogService, useExisting: OfficialGeneratorLogAdapter },
      clipboardPolicy
        ? { provide: GENERATOR_CLIPBOARD_POLICY, useValue: clipboardPolicy }
        : { provide: GENERATOR_CLIPBOARD_POLICY, useExisting: ClipboardPolicyService },
    ],
  }).compileComponents();
  return { fixture: TestBed.createComponent(OfficialCredentialGeneratorComponent), store };
}

function generatorService(overrides: Record<string, unknown> = {}) {
  const service = {
    activeSettings: vi.fn(async () => ({ accountId: "account-a", settings: settings() })),
    generate: vi.fn(async (mode: "password" | "passphrase" | "username") =>
      result(mode === "password" ? "first-password" : mode === "passphrase" ? "first-passphrase" : "first-username", mode)),
    updatePasswordSettings: vi.fn((_accountId: string, patch: object) => settings(patch)),
    updatePassphraseSettings: vi.fn((_accountId: string, patch: object) => settings({}, patch)),
    updateUsernameSettings: vi.fn((_accountId: string, patch: object) => settings({}, {}, patch)),
    ...overrides,
  };
  return service as typeof service & GeneratorService;
}

function settings(password: object = {}, passphrase: object = {}, username: object = {}): GeneratorSettingsSnapshot {
  return {
    password: {
      length: 14, ambiguous: true, uppercase: true, minUppercase: 1,
      lowercase: true, minLowercase: 1, number: true, minNumber: 1,
      special: false, minSpecial: 0, ...password,
    },
    passphrase: { numWords: 6, wordSeparator: "-", capitalize: false, includeNumber: false, ...passphrase },
    username: {
      type: "word", wordCapitalize: false, wordIncludeNumber: false,
      subaddressEmail: "", catchallDomain: "", ...username,
    },
  };
}

function result(credential: string, algorithm: "password" | "passphrase" | "username"): GeneratedResult {
  return {
    credential,
    category: algorithm === "username" ? "username" : "password",
    generationDate: new Date("2026-07-19T00:00:00.000Z"),
    algorithm,
  };
}

async function render(fixture: ReturnType<typeof TestBed.createComponent<OfficialCredentialGeneratorComponent>>) {
  fixture.detectChanges(false);
  await new Promise((resolve) => setTimeout(resolve));
  await fixture.whenStable();
  fixture.changeDetectorRef.detectChanges();
}

function clickToggle(host: HTMLElement, label: string): void {
  const toggle = Array.from(host.querySelectorAll<HTMLElement>("bit-toggle"))
    .find((candidate) => candidate.textContent?.trim() === label);
  expect(toggle).toBeDefined();
  toggle?.querySelector<HTMLInputElement>('input[type="radio"]')?.click();
}

function core(
  fixture: ReturnType<typeof TestBed.createComponent<OfficialCredentialGeneratorComponent>>,
): {
  readonly onGenerated: { subscribe(listener: (value: { credential: string }) => void): unknown };
  generate(source: string): Promise<void>;
} {
  return fixture.debugElement.query(By.directive(OfficialGeneratorCoreComponent)).componentInstance;
}

type GeneratorCoreState = {
  onRootChanged(value: { nav: string }): void;
  username: { controls: { nav: { setValue(value: string): void } } };
};

function coreState(
  fixture: ReturnType<typeof TestBed.createComponent<OfficialCredentialGeneratorComponent>>,
): GeneratorCoreState {
  return core(fixture) as unknown as GeneratorCoreState;
}

function clipboardDirective(
  fixture: ReturnType<typeof TestBed.createComponent<OfficialCredentialGeneratorComponent>>,
): GeneratorClipboardDirective {
  return fixture.debugElement
    .query(By.directive(GeneratorClipboardDirective))
    .injector.get(GeneratorClipboardDirective);
}

function changeControl(host: HTMLElement, control: string, value: string): void {
  const input = host.querySelector<HTMLInputElement>(`input[formcontrolname="${control}"]`)!;
  input.value = value;
  input.dispatchEvent(new Event("input"));
  input.dispatchEvent(new Event("change"));
}

async function settle(
  fixture: ReturnType<typeof TestBed.createComponent<OfficialCredentialGeneratorComponent>>,
): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve));
  fixture.changeDetectorRef.detectChanges();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

class RecordingHost implements HostApi {
  copied: string[] = [];
  clearAfterSeconds: Array<number | undefined> = [];
  failure: Error | null = null;
  showPopup = async () => undefined;
  hidePopup = async () => undefined;
  secureGet = async () => null;
  secureSet = async () => undefined;
  secureDelete = async () => undefined;
  pasteText = async () => undefined;
  openUrl = async () => undefined;
  copyText = async (value: string, clearAfterSeconds?: number) => {
    if (this.failure) throw this.failure;
    this.copied.push(value);
    this.clearAfterSeconds.push(clearAfterSeconds);
  };
}
