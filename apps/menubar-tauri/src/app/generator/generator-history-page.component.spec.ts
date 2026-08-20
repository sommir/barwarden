import "zone.js";
import "@angular/compiler";

import { Location } from "@angular/common";
import { By } from "@angular/platform-browser";
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "../../auth/auth-session-store";
import type { HostApi } from "../../host/host-api";
import { PopupStateStore } from "../popup-state";
import { LocalCopyFeedbackService } from "../official-ui/local-copy-feedback.service";
import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { OfficialGeneratorHistoryComponent } from "../upstream-overlays/generator/official-generator-history.component";
import { GeneratedCredential as OfficialGeneratedCredential } from "./official-generator-history.boundary";
import {
  GENERATOR_HISTORY_CLIPBOARD_HOST,
  GeneratorHistoryPageComponent,
} from "./generator-history-page.component";
import { OfficialGeneratorHistoryViewAdapter } from "./official-generator-history-view.adapter";
import { GeneratorService, type GeneratedCredential } from "./generator.service";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("GeneratorHistoryPageComponent", () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it("keeps the retained official popup shell busy while owned history loads", async () => {
    const pending = deferred<readonly GeneratedCredential[]>();
    const { fixture } = await setup(generatorService({ history: vi.fn(() => pending.promise) }));
    fixture.detectChanges(false);
    await Promise.resolve();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector("popup-page")).not.toBeNull();
    expect(host.querySelector("popup-header")).not.toBeNull();
    expect(host.querySelector("popup-footer")).toBeNull();
    expect(host.querySelector('popup-page[aria-busy="true"]')).not.toBeNull();
    expect(clearButtonOrNull(host)).toBeNull();

    pending.resolve([]);
    await settle(fixture);
    expect(host.querySelector('popup-page[aria-busy="true"]')).toBeNull();
  });

  it("marks the history subroute as an in-flow page without the main switcher", async () => {
    const { fixture } = await setup();
    await render(fixture);

    const host = fixture.nativeElement as HTMLElement;
    expect(host.classList).toContain("macos-page--generator-history");
    expect(host.querySelector("bw-floating-tab-switcher")).toBeNull();
    expect(host.querySelector("popup-header")).not.toBeNull();
  });

  it("renders the exact official empty state and hides clear", async () => {
    const { fixture } = await setup();
    await render(fixture);
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector("bit-empty-credential-history bit-no-items")).not.toBeNull();
    expect(host.querySelectorAll('[data-testid="generator-history-content"]')).toHaveLength(1);
    expect(host.querySelector('[data-testid="generator-history-content"]')?.hasAttribute("aria-live"))
      .toBe(false);
    expect(host.textContent).toContain("没有可显示的内容");
    expect(host.textContent).toContain("您最近没有生成任何内容");
    expect(clearButtonOrNull(host)).toBeNull();
  });

  it("renders history for an unlocked route even when no transport session is retained", async () => {
    const { fixture } = await setup(
      generatorService(),
      new RecordingHost(),
      { activeSession: null },
    );

    await render(fixture);

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector("bit-empty-credential-history bit-no-items")).not.toBeNull();
    expect(host.textContent).toContain("没有可显示的内容");
  });

  it("keeps asynchronous credential history out of live regions while retaining safe row names", async () => {
    const history = [
      credential("password", "password-value", "2026-07-11T08:09:10.000Z"),
      credential("passphrase", "passphrase-value", "2026-07-10T08:09:10.000Z"),
      credential("username", "username-value", "2026-07-09T08:09:10.000Z"),
      credential("password", ""),
    ];
    const { fixture } = await setup(generatorService({ history: vi.fn(async () => history) }));
    await render(fixture);
    const host = fixture.nativeElement as HTMLElement;
    const content = host.querySelector<HTMLElement>(
      '[data-testid="generator-history-content"]',
    );
    const rows = host.querySelectorAll("bit-credential-generator-history [role=listitem]");
    const liveRegions = host.querySelectorAll('[aria-live], [role="status"], [role="alert"]');

    expect(rows).toHaveLength(3);
    expect(content).not.toBeNull();
    expect(content?.hasAttribute("aria-live")).toBe(false);
    for (const liveRegion of liveRegions) {
      expect(liveRegion.textContent).not.toContain("password-value");
      expect(liveRegion.textContent).not.toContain("passphrase-value");
      expect(liveRegion.textContent).not.toContain("username-value");
    }
    expect(host.querySelectorAll(".macos-generator-history__row")).toHaveLength(3);
    expect([...rows].every((row) => row.classList.contains("macos-row"))).toBe(true);
    expect([...rows].every((row) => row.classList.contains("macos-row--double"))).toBe(true);
    expect(rows[0]?.querySelector("bit-color-password")?.textContent).toContain("password-value");
    expect(rows[0]?.getAttribute("role")).toBe("listitem");
    expect(rows[0]?.closest('[role="list"]')).not.toBeNull();
    expect(rows[0]?.getAttribute("aria-label")).toBe("密码");
    expect(rows[1]?.getAttribute("aria-label")).toBe("密码短语");
    expect(rows[2]?.getAttribute("aria-label")).toBe("用户名");
    expect([...rows].map((row) => row.getAttribute("aria-label")).join("\n"))
      .not.toMatch(/password-value|passphrase-value|username-value/);
    const readableValues = host.querySelectorAll("bit-color-password");
    expect([...readableValues].map((value) => value.textContent?.trim()))
      .toEqual(["password-value", "passphrase-value", "username-value"]);
    for (const value of readableValues) {
      let node: HTMLElement | null = value as HTMLElement;
      while (node) {
        expect(node.getAttribute("aria-hidden")).not.toBe("true");
        expect(node.hidden).toBe(false);
        expect(node.hasAttribute("inert")).toBe(false);
        if (node === content) break;
        node = node.parentElement;
      }
      expect(node).toBe(content);
    }
    expect(rows[0]?.querySelector('[slot="secondary"]')?.textContent?.trim()).not.toBe("");
    expect(button(host, "复制密码").querySelector(".bwi-clone")).not.toBeNull();
    expect(button(host, "复制密码短语")).toBeDefined();
    expect(button(host, "复制用户名")).toBeDefined();
    expect(clearButton(host).disabled).toBe(false);
  });

  it("publishes structural history-row focus keys without exposing credential values", async () => {
    const sensitiveCredential = "orbit-lantern-copper-signal";
    const { fixture } = await setup(
      generatorService({
        history: vi.fn(async () => [
          credential("password", sensitiveCredential, "2026-07-11T08:09:10.000Z"),
        ]),
      }),
    );
    await render(fixture);
    const host = fixture.nativeElement as HTMLElement;
    const generatorKeys = [...host.querySelectorAll<HTMLElement>("[data-popup-focus-key]")].map(
      (node) => node.getAttribute("data-popup-focus-key"),
    );

    expect(
      generatorKeys.some((key) => /^generator-history:\d{1,16}:\d{1,4}$/.test(key ?? "")),
    ).toBe(true);
    expect(generatorKeys.join("\n")).not.toContain(sensitiveCredential);
    expect(host.querySelector("[data-bw-focus-key]")).toBeNull();
  });

  it("copies only through the native clipboard policy host", async () => {
    const clipboard = new RecordingHost();
    const entry = credential("username", "copied-user");
    const { fixture } = await setup(
      generatorService({ history: vi.fn(async () => [entry]) }),
      clipboard,
    );
    await render(fixture);

    button(fixture.nativeElement as HTMLElement, "复制用户名").click();
    await settle(fixture);

    expect(clipboard.copyText).toHaveBeenCalledWith("copied-user", 30);
  });

  it("morphs the exact history-row copy icon for explicit and repeated receipts", async () => {
    const firstCopy = deferred<void>();
    const clipboard = new RecordingHost();
    clipboard.copyText
      .mockImplementationOnce(() => firstCopy.promise)
      .mockResolvedValueOnce(undefined);
    const harness = await setup(
      generatorService({
        history: vi.fn(async () => [credential("password", "copied-password")]),
      }),
      clipboard,
    );
    await render(harness.fixture);
    const host = harness.fixture.nativeElement as HTMLElement;
    const copy = button(host, "复制密码");

    copy.click();
    harness.store.setStatus("Unrelated background status");
    harness.fixture.detectChanges();
    expect(copy.querySelector(".bwi-check")).toBeNull();

    firstCopy.resolve();
    await settle(harness.fixture);
    expect(copy.classList).toContain("is-copy-confirmed");
    expect(copy.querySelector(".bwi-check")).not.toBeNull();

    copy.click();
    await settle(harness.fixture);
    expect(clipboard.copyText).toHaveBeenCalledTimes(2);
    expect(copy.classList).toContain("is-copy-confirmed");
    expect(copy.querySelector(".bwi-check")).not.toBeNull();
  });

  it("keeps a pending load owned when copy completes concurrently", async () => {
    const pendingLoad = deferred<readonly GeneratedCredential[]>();
    const clipboard = new RecordingHost();
    const service = generatorService({ history: vi.fn(() => pendingLoad.promise) });
    const harness = await setup(
      service,
      clipboard,
    );
    harness.fixture.detectChanges(false);
    await waitFor(() => service.history.mock.calls.length === 1);

    await historyAdapter(harness.fixture).copy(new OfficialGeneratedCredential(
      "concurrent-copy",
      "password",
      new Date("2026-07-11T00:00:00.000Z"),
      "password",
    ));
    expect(historyAdapter(harness.fixture).loading.value).toBe(true);

    pendingLoad.resolve([credential("password", "loaded-after-copy")]);
    await settle(harness.fixture);
    expect(historyAdapter(harness.fixture).loading.value).toBe(false);
    expect(harness.fixture.nativeElement.textContent).toContain("loaded-after-copy");
  });

  it("sanitizes load failures", async () => {
    const loadSecret = "history-storage-secret";
    const failedLoad = await setup(generatorService({
      history: vi.fn().mockRejectedValue(new Error(loadSecret)),
    }));
    await render(failedLoad.fixture);
    const alert = failedLoad.fixture.nativeElement.querySelector('[role="alert"]');
    expect(historyAdapter(failedLoad.fixture).statusMessage.value).toBe(
      "无法加载生成器历史记录。",
    );
    expect(alert?.textContent).toContain("无法加载生成器历史记录。");
    expect(alert?.textContent).not.toContain(loadSecret);
    expect(historyAdapter(failedLoad.fixture).statusMessage.value).not.toContain(loadSecret);
  });

  it("sanitizes copy failures without changing retained rows", async () => {
    const copySecret = "copy-secret-must-not-leak";
    const clipboard = new RecordingHost();
    clipboard.copyText.mockRejectedValue(new Error(copySecret));
    const failedCopy = await setup(
      generatorService({ history: vi.fn(async () => [credential("password", "visible-value")]) }),
      clipboard,
    );
    await render(failedCopy.fixture);
    button(failedCopy.fixture.nativeElement as HTMLElement, "复制密码").click();
    await settle(failedCopy.fixture);

    const alert = failedCopy.fixture.nativeElement.querySelector('[role="alert"]');
    expect(historyAdapter(failedCopy.fixture).statusMessage.value).toBe("无法复制生成的内容。");
    expect(alert?.textContent).toContain("无法复制生成的内容。");
    expect(alert?.textContent).not.toContain(copySecret);
    expect(historyAdapter(failedCopy.fixture).statusMessage.value).not.toContain(copySecret);
    expect(failedCopy.fixture.nativeElement.textContent).toContain("visible-value");
  });

  it("uses the native dialog copy, initial focus, cancel, Escape, and trigger restoration", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const { fixture } = await setup(generatorService({
      history: vi.fn(async () => [credential("password", "value")]),
    }));
    await render(fixture);
    const host = fixture.nativeElement as HTMLElement;
    const trigger = clearButton(host);
    const clearDialog = dialog(host);
    useDialogFallback(clearDialog);
    trigger.focus();

    expect(clearDialog.classList).toContain("app-bottom-sheet");
    expect(clearDialog.querySelectorAll(".app-bottom-sheet-panel")).toHaveLength(1);
    expect(clearDialog.querySelector(":scope > form.app-bottom-sheet-panel")).not.toBeNull();

    trigger.click();
    await settle(fixture);
    expect(clearDialog.hasAttribute("open")).toBe(true);
    expect(clearDialog.textContent).toContain("清除生成器历史记录");
    expect(clearDialog.textContent).toContain("若继续，所有条目将从生成器历史记录中永久删除。确定要继续吗？");
    const cancel = button(host, "取消", "dialog");
    const dangerClear = button(host, "清除历史记录", "dialog");
    expect(document.activeElement).toBe(cancel);
    expect(cancel.compareDocumentPosition(dangerClear) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(dangerClear.getAttribute("buttontype")).toBe("danger");

    cancel.click();
    await settle(fixture);
    expect(clearDialog.hasAttribute("open")).toBe(false);
    expect(document.activeElement).toBe(trigger);

    trigger.click();
    await settle(fixture);
    clearDialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    await settle(fixture);
    expect(clearDialog.hasAttribute("open")).toBe(false);
    expect(document.activeElement).toBe(trigger);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("does not let a nested close transition or its fallback restore focus early", async () => {
    const { fixture } = await setup(generatorService({
      history: vi.fn(async () => [credential("password", "value")]),
    }));
    await render(fixture);
    const host = fixture.nativeElement as HTMLElement;
    const trigger = clearButton(host);
    const clearDialog = dialog(host);
    useDialogFallback(clearDialog);
    clearDialog.style.transitionProperty = "transform";
    clearDialog.style.transitionDuration = "200ms";
    clearDialog.style.transitionDelay = "0s";
    trigger.focus();
    trigger.click();
    await settle(fixture);
    const cancel = button(host, "取消", "dialog");

    expect(document.activeElement).toBe(cancel);
    cancel.click();
    expect(clearDialog.getAttribute("data-state")).toBe("closing");
    expect(document.activeElement).toBe(cancel);

    const nested = clearDialog.querySelector<HTMLElement>(".app-bottom-sheet-footer")!;
    nested.dispatchEvent(transformTransitionEnd());
    expect(clearDialog.hasAttribute("open")).toBe(true);
    expect(document.activeElement).toBe(cancel);

    clearDialog.dispatchEvent(transformTransitionEnd());
    expect(clearDialog.hasAttribute("open")).toBe(false);
    expect(document.activeElement).toBe(trigger);

    const copy = button(host, "复制密码");
    copy.focus();
    await new Promise((resolve) => window.setTimeout(resolve, 275));
    expect(document.activeElement).toBe(copy);
  });

  it("suppresses duplicate clear and changes to the official empty state only after success", async () => {
    const clearing = deferred<void>();
    const service = generatorService({
      history: vi.fn(async () => [credential("password", "retained-until-clear")]),
      clearHistory: vi.fn(() => clearing.promise),
    });
    const { fixture } = await setup(service);
    await render(fixture);
    const host = fixture.nativeElement as HTMLElement;
    useDialogFallback(dialog(host));

    clearButton(host).click();
    await settle(fixture);
    const confirmClear = button(host, "清除历史记录", "dialog");
    confirmClear.click();
    confirmClear.click();
    await waitFor(() => service.clearHistory.mock.calls.length === 1);
    fixture.detectChanges(false);

    expect(service.clearHistory).toHaveBeenCalledOnce();
    expect(confirmClear.getAttribute("aria-disabled")).toBe("true");
    expect(host.textContent).toContain("retained-until-clear");

    clearing.resolve();
    await settle(fixture);
    expect(host.textContent).toContain("没有可显示的内容");
  });

  it("keeps a pending clear owned when copy completes concurrently", async () => {
    const pendingClear = deferred<void>();
    const clipboard = new RecordingHost();
    const harness = await setup(
      generatorService({
        history: vi.fn(async () => [credential("password", "clear-after-copy")]),
        clearHistory: vi.fn(() => pendingClear.promise),
      }),
      clipboard,
    );
    await render(harness.fixture);
    useDialogFallback(dialog(harness.fixture.nativeElement));
    clearButton(harness.fixture.nativeElement).click();
    await settle(harness.fixture);
    button(harness.fixture.nativeElement, "清除历史记录", "dialog").click();
    await waitFor(() => historyAdapter(harness.fixture).clearing.value);

    await historyAdapter(harness.fixture).copy(new OfficialGeneratedCredential(
      "concurrent-copy",
      "password",
      new Date("2026-07-11T00:00:00.000Z"),
      "password",
    ));
    expect(historyAdapter(harness.fixture).clearing.value).toBe(true);

    pendingClear.resolve();
    await settle(harness.fixture);
    expect(historyAdapter(harness.fixture).clearing.value).toBe(false);
    expect(harness.fixture.nativeElement.textContent).toContain("没有可显示的内容");
  });

  it("keeps rows on failed clear and allows a retry", async () => {
    const service = generatorService({
      history: vi.fn(async () => [credential("password", "visible-value")]),
      clearHistory: vi.fn()
        .mockRejectedValueOnce(new Error("secret clear failure"))
        .mockResolvedValueOnce(undefined),
    });
    const { fixture } = await setup(service);
    await render(fixture);
    const host = fixture.nativeElement as HTMLElement;
    useDialogFallback(dialog(host));

    await openAndConfirm(fixture);
    expect(host.textContent).toContain("visible-value");
    expect(historyAdapter(fixture).statusMessage.value).toBe("无法清除生成器历史记录。");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "无法清除生成器历史记录。",
    );

    await openAndConfirm(fixture);
    expect(service.clearHistory).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("没有可显示的内容");
  });

  it("rejects a stale same-ID session load without publishing rows", async () => {
    const pending = deferred<readonly GeneratedCredential[]>();
    const service = generatorService({ history: vi.fn(() => pending.promise) });
    const harness = await setup(service);
    harness.fixture.detectChanges(false);
    await waitFor(() => service.history.mock.calls.length === 1);

    harness.store.setActiveSession(fakeSession("replacement"));
    pending.resolve([credential("password", "stale-load-secret")]);
    await settle(harness.fixture);

    expect(harness.fixture.nativeElement.textContent).not.toContain("stale-load-secret");
  });

  it("rejects a stale load after authoritative active account replacement", async () => {
    const pending = deferred<readonly GeneratedCredential[]>();
    let activeAccountId = "account-a";
    const service = generatorService({
      activeSettings: vi.fn(async () => ({ accountId: activeAccountId, settings: {} })),
      history: vi.fn(() => pending.promise),
    });
    const harness = await setup(service);
    harness.fixture.detectChanges(false);
    await waitFor(() => service.history.mock.calls.length === 1);

    activeAccountId = "account-b";
    pending.resolve([credential("password", "wrong-account-secret")]);
    await settle(harness.fixture);

    expect(historyAdapter(harness.fixture).loading.value).toBe(false);
    expect(harness.fixture.nativeElement.textContent).not.toContain("wrong-account-secret");
  });

  it("keeps rows when clear becomes stale for a replacement same-ID session", async () => {
    const clearing = deferred<void>();
    const harness = await setup(generatorService({
      history: vi.fn(async () => [credential("password", "keep-after-stale-clear")]),
      clearHistory: vi.fn(() => clearing.promise),
    }));
    await render(harness.fixture);
    useDialogFallback(dialog(harness.fixture.nativeElement));

    clearButton(harness.fixture.nativeElement).click();
    await settle(harness.fixture);
    button(harness.fixture.nativeElement, "清除历史记录", "dialog").click();
    harness.store.setActiveSession(fakeSession("replacement"));
    clearing.resolve();
    await settle(harness.fixture);

    expect(harness.fixture.nativeElement.textContent).toContain("keep-after-stale-clear");
  });

  it("publishes no stale copy status after same-ID session replacement", async () => {
    const copying = deferred<void>();
    const clipboard = new RecordingHost();
    clipboard.copyText.mockReturnValue(copying.promise);
    const harness = await setup(
      generatorService({ history: vi.fn(async () => [credential("password", "copy-value")]) }),
      clipboard,
    );
    await render(harness.fixture);
    button(harness.fixture.nativeElement, "复制密码").click();
    harness.store.setActiveSession(fakeSession("replacement"));
    copying.reject(new Error("private clipboard rejection"));
    await settle(harness.fixture);
    expect(historyAdapter(harness.fixture).statusMessage.value).toBeNull();
  });

  it("publishes no stale load after route teardown", async () => {
    const teardown = deferred<readonly GeneratedCredential[]>();
    const destroyed = await setup(generatorService({ history: vi.fn(() => teardown.promise) }));
    destroyed.fixture.detectChanges(false);
    destroyed.fixture.destroy();
    teardown.resolve([credential("password", "destroyed-secret")]);
    await Promise.resolve();
  });
});

async function setup(
  service = generatorService(),
  clipboard: HostApi = new RecordingHost(),
  stateOverrides: Partial<ReturnType<PopupStateStore["snapshot"]>> = {},
) {
  const location = { back: vi.fn() };
  const store = new PopupStateStore();
  store.restore({
    ...store.snapshot(),
    isUnlocked: true,
    email: "person@example.test",
    serverUrl: "https://vault.example.test",
    activeSession: fakeSession("initial"),
    ...stateOverrides,
  });

  await TestBed.configureTestingModule({
    imports: [GeneratorHistoryPageComponent],
    providers: [
      provideRouter([]),
      OfficialI18nService,
      { provide: I18nService, useExisting: OfficialI18nService },
      { provide: PopupStateStore, useValue: store },
      { provide: GeneratorService, useValue: service },
      { provide: GENERATOR_HISTORY_CLIPBOARD_HOST, useValue: clipboard },
      { provide: Location, useValue: location },
    ],
  }).compileComponents();
  TestBed.inject(LocalCopyFeedbackService).start();

  return { fixture: TestBed.createComponent(GeneratorHistoryPageComponent), location, store };
}

async function render(
  fixture: ReturnType<typeof TestBed.createComponent<GeneratorHistoryPageComponent>>,
): Promise<void> {
  fixture.detectChanges(false);
  await settle(fixture);
}

async function settle(
  fixture: ReturnType<typeof TestBed.createComponent<GeneratorHistoryPageComponent>>,
): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve));
  await fixture.whenStable();
  fixture.changeDetectorRef.detectChanges();
  await new Promise((resolve) => setTimeout(resolve));
}

async function openAndConfirm(
  fixture: ReturnType<typeof TestBed.createComponent<GeneratorHistoryPageComponent>>,
): Promise<void> {
  const host = fixture.nativeElement as HTMLElement;
  clearButton(host).click();
  await settle(fixture);
  button(host, "清除历史记录", "dialog").click();
  await settle(fixture);
}

function generatorService(overrides: Record<string, unknown> = {}) {
  return {
    activeSettings: vi.fn(async () => ({ accountId: "account-a", settings: {} })),
    history: vi.fn(async () => []),
    clearHistory: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as GeneratorService & {
    activeSettings: ReturnType<typeof vi.fn>;
    history: ReturnType<typeof vi.fn>;
    clearHistory: ReturnType<typeof vi.fn>;
  };
}

function historyAdapter(
  fixture: ReturnType<typeof TestBed.createComponent<GeneratorHistoryPageComponent>>,
): OfficialGeneratorHistoryViewAdapter {
  return fixture.debugElement
    .query(By.directive(OfficialGeneratorHistoryComponent))
    .injector.get(OfficialGeneratorHistoryViewAdapter);
}

function credential(
  algorithm: GeneratedCredential["algorithm"],
  value: string,
  generationDate = "2026-07-11T00:00:00.000Z",
): GeneratedCredential {
  return {
    credential: value,
    category: algorithm === "username" ? "username" : "password",
    generationDate: new Date(generationDate),
    algorithm,
  };
}

function fakeSession(id: string): AuthSession {
  return {
    environment: {
      apiUrl: "https://vault.example.test/api",
      identityUrl: "https://vault.example.test/identity",
    },
    token: {
      accessToken: `access-${id}`,
      refreshToken: `refresh-${id}`,
      tokenType: "Bearer",
      expiresIn: 3600,
    },
  };
}

function clearButton(host: HTMLElement): HTMLButtonElement {
  return button(host, "清除历史记录", "popup-footer");
}

function clearButtonOrNull(host: HTMLElement): HTMLButtonElement | null {
  return Array.from(host.querySelectorAll<HTMLButtonElement>("popup-footer button")).find(
    (candidate) =>
      candidate.getAttribute("aria-label") === "清除历史记录"
      || candidate.textContent?.trim() === "清除历史记录",
  ) ?? null;
}

function button(host: HTMLElement, label: string, within?: string): HTMLButtonElement {
  const root = within ? host.querySelector(within) : host;
  const result = Array.from(root?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
    (candidate) => candidate.getAttribute("aria-label") === label || candidate.textContent?.trim() === label,
  );
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}

function dialog(host: HTMLElement): HTMLDialogElement {
  const result = host.querySelector<HTMLDialogElement>("dialog");
  if (!result) throw new Error("Missing clear-history dialog");
  return result;
}

function useDialogFallback(element: HTMLDialogElement): void {
  Object.defineProperty(element, "showModal", { configurable: true, value: undefined });
  Object.defineProperty(element, "close", { configurable: true, value: undefined });
}

function transformTransitionEnd(): Event {
  const event = new Event("transitionend", { bubbles: true });
  Object.defineProperty(event, "propertyName", { value: "transform" });
  return event;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("Condition did not become true");
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

class RecordingHost implements HostApi {
  showPopup = vi.fn(async () => undefined);
  hidePopup = vi.fn(async () => undefined);
  copyText = vi.fn(async (_value: string) => undefined);
  pasteText = vi.fn(async () => undefined);
  openUrl = vi.fn(async () => undefined);
  secureGet = vi.fn(async () => null);
  secureSet = vi.fn(async () => undefined);
  secureDelete = vi.fn(async () => undefined);
}
