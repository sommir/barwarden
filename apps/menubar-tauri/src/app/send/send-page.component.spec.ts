import "zone.js";
import "@angular/compiler";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { ActivatedRoute, provideRouter, Router } from "@angular/router";
import { of, Subject } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { DialogService } from "@bitwarden/components";

import type { AuthSession } from "../../auth/auth-session-store";
import { buildSelfHostedEnvironmentFromServerUrl } from "../../bitwarden-api/bitwarden-api";
import type { HostApi } from "../../host/host-api";
import { PopupStateStore } from "../popup-state";
import { AppFeedbackService } from "../official-ui/app-feedback.service";
import { LocalCopyFeedbackService } from "../official-ui/local-copy-feedback.service";
import {
  OfficialI18nService,
  translateOfficialMessage,
} from "../official-ui/official-i18n.service";
import { POP_OUT_HOST, type PopOutHost } from "../popup-header-actions.component";
import { GeneratorService, type GeneratedCredential } from "../generator/generator.service";
import { SendAddEditPageComponent, textSendDeletionPresetHours } from "./send-add-edit-page.component";
import { BitwardenSendActions } from "./send-actions.service";
import type { SendItem } from "./send-item.model";
import { SEND_CREATED_HOST, SendCreatedPageComponent, SendLinkBuilder } from "./send-created-page.component";
import { SEND_ACTION_PORT, SendPageComponent, type SendActionPort } from "./send-page.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

const openSimpleDialog = vi.fn(async () => true);

beforeEach(() => {
  openSimpleDialog.mockReset();
  openSimpleDialog.mockResolvedValue(true);
  TestBed.configureTestingModule({
    providers: [
      OfficialI18nService,
      { provide: I18nService, useExisting: OfficialI18nService },
    ],
  });
});

describe("SendPageComponent", () => {
  it("marks Send form and confirmation subroutes as in-flow pages without the main switcher", () => {
    const root = resolve(process.cwd(), "apps/menubar-tauri/src/app/send");
    const form = readFileSync(resolve(root, "send-add-edit-page.component.ts"), "utf8");
    const created = readFileSync(resolve(root, "send-created-page.component.ts"), "utf8");

    expect(form).toContain('host: { class: "macos-page macos-page--secondary macos-page--send-form" }');
    expect(created).toContain('host: { class: "macos-page macos-page--secondary macos-page--send-created" }');
    expect(form).not.toContain("bw-floating-tab-switcher");
    expect(created).not.toContain("bw-floating-tab-switcher");
  });

  it("marks the main Send route for the shared solid macOS presentation", async () => {
    await TestBed.configureTestingModule({
      imports: [SendPageComponent],
      providers: [PopupStateStore, provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(SendPageComponent);

    fixture.detectChanges();
    await fixture.whenStable();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.classList).toContain("macos-page--send");
    expect(host.querySelector("bw-floating-tab-switcher")).toBeNull();
    expect(host.querySelector("popup-header")).not.toBeNull();
  });

  it("does not expose File Send creation from the production Send action boundary", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/menubar-tauri/src/app/send/send-actions.service.ts"),
      "utf8",
    );
    expect(source).not.toContain("createFileSend");
    expect(source).not.toContain("FileSendUploadService");
    expect(source).not.toContain("buildFileSendCreateRequest");
  });

  it("rejects File Send mutations before issuing a network request", async () => {
    const fetchJson = vi.fn(async () => undefined);
    const actions = new BitwardenSendActions(
      fakeAuthSession(),
      { fetchJson } as unknown as HostApi,
    ) as unknown as {
      deleteSend(session: AuthSession, send: SendItem): Promise<void>;
      removePassword(session: AuthSession, send: SendItem): Promise<void>;
    };
    const fileSend = demoSend({ id: "file-send", type: "file", fileName: "excluded.pdf" });

    await expect(actions.deleteSend(fakeAuthSession(), fileSend)).rejects.toThrow("File Send mutations are excluded");
    await expect(actions.removePassword(fakeAuthSession(), fileSend)).rejects.toThrow("File Send mutations are excluded");
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("renders the official Send empty state", async () => {
    await TestBed.configureTestingModule({
      imports: [SendPageComponent],
      providers: [PopupStateStore, provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(SendPageComponent);

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector("popup-page > main")).not.toBeNull();
    expect(host.querySelector("popup-page popup-header h1")?.textContent).toContain("Send");
    expect(host.querySelector("bit-search")).toBeNull();
    expect(host.querySelector("bit-no-items")).not.toBeNull();
    expect(host.textContent).toContain("安全地发送敏感信息");
    expect(host.textContent).toContain("创建 Send");
    expect(host.textContent).not.toContain("not connected");
    expect(host.querySelector(".send-unavailable")).toBeNull();
    expect(host.querySelector('[aria-label="新增文本 Send"]')?.hasAttribute("disabled")).toBe(false);
  });

  it("renders the official loading skeleton during initial Send sync", async () => {
    await TestBed.configureTestingModule({
      imports: [SendPageComponent],
      providers: [PopupStateStore, provideRouter([])],
    }).compileComponents();
    const store = TestBed.inject(PopupStateStore);
    store.setSyncing(true);
    const fixture = TestBed.createComponent(SendPageComponent);

    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('bit-item-group[aria-label="正在加载 Send"]')).not.toBeNull();
    expect(host.querySelectorAll("bit-skeleton")).toHaveLength(10);
    expect(host.textContent).not.toContain("安全地发送敏感信息");

    expect(host.querySelector(".vault-loading-skeleton")).toBeNull();
  });

  it("renders the official Send disabled policy callout and hides create actions", async () => {
    await TestBed.configureTestingModule({
      imports: [SendPageComponent],
      providers: [PopupStateStore, provideRouter([])],
    }).compileComponents();
    const store = TestBed.inject(PopupStateStore);
    store.setSendDisabled(true);
    const fixture = TestBed.createComponent(SendPageComponent);

    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector("bit-callout.send-disabled-callout .macos-alert-strip")).not.toBeNull();
    expect(host.querySelector(".bit-callout")).toBeNull();
    expect(host.textContent).toContain("Send 已禁用");
    expect(host.textContent).toContain("组织策略已关闭 Bitwarden Send。");
    expect(host.querySelector(".primary-action")).toBeNull();
    expect(host.querySelector('[aria-label="新增文本 Send"]')).toBeNull();
  });

  it("routes the official Text-only new action to the add host", async () => {
    await TestBed.configureTestingModule({
      imports: [SendPageComponent],
      providers: [PopupStateStore, provideRouter([])],
    }).compileComponents();
    const router = TestBed.inject(Router);
    const navigations: unknown[] = [];
    router.navigate = async (commands, extras) => {
      navigations.push({ commands, extras });
      return true;
    };
    const fixture = TestBed.createComponent(SendPageComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLButtonElement>('[aria-label="新增文本 Send"]')?.click();

    expect(navigations).toEqual([
      { commands: ["/add-send"], extras: { queryParams: { type: "text" } } },
    ]);
    expect(host.textContent).not.toContain("文件 Send");
  });

  it("renders Send search, filters, and matching rows when sends are synced", async () => {
    await TestBed.configureTestingModule({
      imports: [SendPageComponent],
      providers: [PopupStateStore, provideRouter([])],
    }).compileComponents();
    const store = TestBed.inject(PopupStateStore);
    store.setSends([
      demoSend({ id: "send-1", name: "Payroll token", type: "text", accessCount: 1 }),
      demoSend({ id: "send-2", name: "Wire instructions", type: "file" }),
    ]);
    const fixture = TestBed.createComponent(SendPageComponent);

    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector(".send-empty")).toBeNull();
    expect(host.querySelector("bit-search")).not.toBeNull();
    expect(host.querySelector("bit-item-group")).not.toBeNull();
    expect(host.querySelector("bit-item")).not.toBeNull();
    expect(host.textContent).toContain("所有 Send");
    expect(host.textContent).toContain("Payroll token");
    expect(host.textContent).not.toContain("Wire instructions");
    expect(store.snapshot().sends).toHaveLength(2);

    host.querySelector<HTMLInputElement>('bit-search input')!.value = "payroll";
    host.querySelector<HTMLInputElement>('bit-search input')!.dispatchEvent(new Event("input"));
    fixture.detectChanges();

    expect(host.textContent).toContain("Payroll token");
    expect(host.textContent).not.toContain("Wire instructions");

    expect(host.querySelector('option[value="file"]')).toBeNull();
    expect(host.querySelector(".bit-search")).toBeNull();
    expect(host.querySelector(".bit-item")).toBeNull();
  });

  it("places Send search and filters in the official above-scroll area", async () => {
    await TestBed.configureTestingModule({
      imports: [SendPageComponent],
      providers: [PopupStateStore, provideRouter([])],
    }).compileComponents();
    const store = TestBed.inject(PopupStateStore);
    store.setSends([demoSend({ id: "send-1", name: "Payroll token", type: "text" })]);
    const fixture = TestBed.createComponent(SendPageComponent);

    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector("popup-page > main")).not.toBeNull();
    expect(host.querySelector("popup-page popup-header h1")?.textContent).toContain("Send");
    expect(host.querySelector("bit-search")).not.toBeNull();
    expect(host.querySelector("bit-item-group")).not.toBeNull();
  });

  it("routes a Send row through view-before-edit navigation", async () => {
    await TestBed.configureTestingModule({
      imports: [SendPageComponent],
      providers: [PopupStateStore, provideRouter([])],
    }).compileComponents();
    const store = TestBed.inject(PopupStateStore);
    store.setSends([demoSend({ id: "send-1", name: "Payroll token", type: "text" })]);
    const router = TestBed.inject(Router);
    const navigations: unknown[] = [];
    router.navigate = async (commands, extras) => {
      navigations.push({ commands, extras });
      return true;
    };
    const fixture = TestBed.createComponent(SendPageComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('a[href*="edit-send"]')).toBeNull();
    host.querySelector<HTMLButtonElement>('[bit-item-content]')?.click();
    expect(navigations).toEqual([
      {
        commands: ["/edit-send"],
        extras: { queryParams: { sendId: "send-1", type: "text" } },
      },
    ]);
  });

  it("copies only complete Text Send links from the official row action", async () => {
    const copied: string[] = [];
    await TestBed.configureTestingModule({
      imports: [SendPageComponent],
      providers: [
        PopupStateStore,
        provideRouter([]),
        {
          provide: SEND_CREATED_HOST,
          useValue: {
            copyText: async (value: string) => copied.push(value),
          },
        },
      ],
    }).compileComponents();
    const store = TestBed.inject(PopupStateStore);
    store.setServerUrl("https://vault.example.test");
    store.setSends([
      demoSend({
        id: "send-1",
        accessId: "access-token",
        urlB64Key: "url-key",
        name: "Payroll token",
        type: "text",
      }),
    ]);
    const fixture = TestBed.createComponent(SendPageComponent);
    fixture.detectChanges();
    const copyFeedback = TestBed.inject(LocalCopyFeedbackService);
    copyFeedback.start();

    const host = fixture.nativeElement as HTMLElement;
    const copyButton = host.querySelector<HTMLButtonElement>('[aria-label^="复制链接"]')!;
    copyButton.click();
    await fixture.whenStable();

    expect(copied).toEqual(["https://vault.example.test/#/send/access-token/url-key"]);
    expect(store.snapshot().statusMessage).toBe(translateOfficialMessage("i18nSendLinkCopied"));
    expect(copyButton.classList).toContain("is-copy-confirmed");
    expect(TestBed.inject(AppFeedbackService).snapshot()).toMatchObject({
      kind: "success",
      message: translateOfficialMessage("i18nSendLinkCopied"),
    });
    copyFeedback.destroy();
  });

  it("deletes active session Sends through Bitwarden before removing them locally", async () => {
    const sendActions = new RecordingSendActions();
    await TestBed.configureTestingModule({
      imports: [SendPageComponent],
      providers: [
        PopupStateStore,
        provideRouter([]),
        { provide: SEND_ACTION_PORT, useValue: sendActions },
      ],
    }).compileComponents();
    const store = TestBed.inject(PopupStateStore);
    const session = unlockForSendOperation(store);
    const send = demoSend({ id: "send-1", name: "Payroll token", type: "text" });
    store.setSends([send]);
    const fixture = TestBed.createComponent(SendPageComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    clickSendDelete(host);
    fixture.detectChanges();
    buttonByText(host, "永久删除").click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(sendActions.calls).toEqual([{ type: "delete", session, sendId: "send-1" }]);
    expect(store.snapshot().sends).toEqual([]);
    expect(store.snapshot().statusMessage).toBe(translateOfficialMessage("i18nSendDeleted"));
    expect(TestBed.inject(AppFeedbackService).snapshot()).toMatchObject({
      kind: "success",
      message: translateOfficialMessage("i18nSendDeleted"),
    });
  });

  it("requires an in-app irreversible confirmation before deleting a Send", async () => {
    const sendActions = new RecordingSendActions();
    await TestBed.configureTestingModule({
      imports: [SendPageComponent],
      providers: [
        PopupStateStore,
        provideRouter([]),
        { provide: SEND_ACTION_PORT, useValue: sendActions },
      ],
    }).compileComponents();
    const store = TestBed.inject(PopupStateStore);
    unlockForSendOperation(store);
    store.setSends([demoSend({ id: "send-1", name: "Payroll token", type: "text" })]);
    const fixture = TestBed.createComponent(SendPageComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    clickSendDelete(host);
    fixture.detectChanges();

    const confirmation = host.querySelector<HTMLDialogElement>(
      '[data-testid="send-permanent-delete-confirmation"]',
    );
    expect(confirmation?.hasAttribute("open")).toBe(true);
    expect(confirmation?.textContent).toContain("Payroll token");
    expect(sendActions.calls).toEqual([]);
  });

  it("clears the pending Send when Escape dismisses the permanent deletion confirmation", async () => {
    const sendActions = new RecordingSendActions();
    await TestBed.configureTestingModule({
      imports: [SendPageComponent],
      providers: [
        PopupStateStore,
        provideRouter([]),
        { provide: SEND_ACTION_PORT, useValue: sendActions },
      ],
    }).compileComponents();
    const store = TestBed.inject(PopupStateStore);
    unlockForSendOperation(store);
    store.setSends([demoSend({ id: "send-1", name: "Payroll token", type: "text" })]);
    const fixture = TestBed.createComponent(SendPageComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    clickSendDelete(host);
    fixture.detectChanges();
    const confirmation = host.querySelector<HTMLDialogElement>(
      '[data-testid="send-permanent-delete-confirmation"]',
    );
    confirmation?.dispatchEvent(new Event("cancel", { cancelable: true }));
    fixture.detectChanges();
    await fixture.componentInstance.confirmDelete();

    expect(confirmation?.hasAttribute("open")).toBe(false);
    expect(sendActions.calls).toEqual([]);
    expect(store.snapshot().sends.map((send) => send.id)).toEqual(["send-1"]);
  });

  it("keeps the original target modal while deletion is in flight and suppresses later requests", async () => {
    const gate = deferred<void>();
    const sendActions = new RecordingSendActions();
    sendActions.deleteWait = gate.promise;
    await TestBed.configureTestingModule({
      imports: [SendPageComponent],
      providers: [
        PopupStateStore,
        provideRouter([]),
        { provide: SEND_ACTION_PORT, useValue: sendActions },
      ],
    }).compileComponents();
    const store = TestBed.inject(PopupStateStore);
    unlockForSendOperation(store);
    store.setSends([
      demoSend({ id: "send-1", name: "Payroll token", type: "text" }),
      demoSend({ id: "send-2", name: "Benefits token", type: "text" }),
    ]);
    const fixture = TestBed.createComponent(SendPageComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    clickSendDelete(host);
    fixture.detectChanges();
    const first = fixture.componentInstance.confirmDelete();
    await vi.waitFor(() => expect(sendActions.calls).toHaveLength(1));
    fixture.detectChanges();
    const confirmation = host.querySelector<HTMLDialogElement>(
      '[data-testid="send-permanent-delete-confirmation"]',
    );

    const second = fixture.componentInstance.sends.find(({ id }) => id === "send-2");
    expect(second).toBeDefined();
    fixture.componentInstance.requestDelete(second!);
    fixture.detectChanges();
    await fixture.componentInstance.confirmDelete();

    expect(sendActions.calls).toHaveLength(1);
    expect(confirmation?.hasAttribute("open")).toBe(true);
    expect(confirmation?.textContent).toContain("Payroll token");
    expect(confirmation?.textContent).not.toContain("Benefits token");
    expect(buttonByText(host, "正在删除…").getAttribute("aria-disabled")).toBe("true");
    expect(buttonByText(host, "取消").getAttribute("aria-disabled")).toBe("true");

    gate.resolve();
    await first;
    expect(store.snapshot().sends.map(({ id }) => id)).toEqual(["send-2"]);
  });

  it("requires an in-app irreversible confirmation before deleting a Send", async () => {
    const sendActions = new RecordingSendActions();
    await TestBed.configureTestingModule({
      imports: [SendPageComponent],
      providers: [
        PopupStateStore,
        provideRouter([]),
        { provide: SEND_ACTION_PORT, useValue: sendActions },
      ],
    }).compileComponents();
    const store = TestBed.inject(PopupStateStore);
    unlockForSendOperation(store);
    store.setSends([demoSend({ id: "send-1", name: "Payroll token", type: "text" })]);
    const fixture = TestBed.createComponent(SendPageComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    clickSendDelete(host);
    fixture.detectChanges();

    const confirmation = host.querySelector<HTMLDialogElement>(
      '[data-testid="send-permanent-delete-confirmation"]',
    );
    expect(confirmation?.hasAttribute("open")).toBe(true);
    expect(confirmation?.textContent).toContain("Payroll token");
    expect(sendActions.calls).toEqual([]);
  });

  it("clears the pending Send when Escape dismisses the permanent deletion confirmation", async () => {
    const sendActions = new RecordingSendActions();
    await TestBed.configureTestingModule({
      imports: [SendPageComponent],
      providers: [
        PopupStateStore,
        provideRouter([]),
        { provide: SEND_ACTION_PORT, useValue: sendActions },
      ],
    }).compileComponents();
    const store = TestBed.inject(PopupStateStore);
    unlockForSendOperation(store);
    store.setSends([demoSend({ id: "send-1", name: "Payroll token", type: "text" })]);
    const fixture = TestBed.createComponent(SendPageComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    clickSendDelete(host);
    fixture.detectChanges();
    const confirmation = host.querySelector<HTMLDialogElement>(
      '[data-testid="send-permanent-delete-confirmation"]',
    );
    confirmation?.dispatchEvent(new Event("cancel", { cancelable: true }));
    fixture.detectChanges();
    await fixture.componentInstance.confirmDelete();

    expect(confirmation?.hasAttribute("open")).toBe(false);
    expect(sendActions.calls).toEqual([]);
    expect(store.snapshot().sends.map((send) => send.id)).toEqual(["send-1"]);
  });

  it("keeps the original target modal while deletion is in flight and suppresses later requests", async () => {
    const gate = deferred<void>();
    const sendActions = new RecordingSendActions();
    sendActions.deleteWait = gate.promise;
    await TestBed.configureTestingModule({
      imports: [SendPageComponent],
      providers: [
        PopupStateStore,
        provideRouter([]),
        { provide: SEND_ACTION_PORT, useValue: sendActions },
      ],
    }).compileComponents();
    const store = TestBed.inject(PopupStateStore);
    unlockForSendOperation(store);
    store.setSends([
      demoSend({ id: "send-1", name: "Payroll token", type: "text" }),
      demoSend({ id: "send-2", name: "Benefits token", type: "text" }),
    ]);
    const fixture = TestBed.createComponent(SendPageComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    clickSendDelete(host);
    fixture.detectChanges();
    const first = fixture.componentInstance.confirmDelete();
    await vi.waitFor(() => expect(sendActions.calls).toHaveLength(1));
    fixture.detectChanges();
    const confirmation = host.querySelector<HTMLDialogElement>(
      '[data-testid="send-permanent-delete-confirmation"]',
    );

    const second = fixture.componentInstance.sends.find(({ id }) => id === "send-2");
    expect(second).toBeDefined();
    fixture.componentInstance.requestDelete(second!);
    fixture.detectChanges();
    await fixture.componentInstance.confirmDelete();

    expect(sendActions.calls).toHaveLength(1);
    expect(confirmation?.hasAttribute("open")).toBe(true);
    expect(confirmation?.textContent).toContain("Payroll token");
    expect(confirmation?.textContent).not.toContain("Benefits token");
    expect(buttonByText(host, "正在删除…").getAttribute("aria-disabled")).toBe("true");
    expect(buttonByText(host, "取消").getAttribute("aria-disabled")).toBe("true");

    gate.resolve();
    await first;
    expect(store.snapshot().sends.map(({ id }) => id)).toEqual(["send-2"]);
  });

  it("preserves active session Sends when server delete fails", async () => {
    const sendActions = new RecordingSendActions();
    sendActions.failWith = new Error("server rejected send delete");
    await TestBed.configureTestingModule({
      imports: [SendPageComponent],
      providers: [
        PopupStateStore,
        provideRouter([]),
        { provide: SEND_ACTION_PORT, useValue: sendActions },
      ],
    }).compileComponents();
    const store = TestBed.inject(PopupStateStore);
    unlockForSendOperation(store);
    store.setSends([demoSend({ id: "send-1", name: "Payroll token", type: "text" })]);
    const fixture = TestBed.createComponent(SendPageComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    clickSendDelete(host);
    fixture.detectChanges();
    buttonByText(host, "永久删除").click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(store.snapshot().sends.map((send) => send.id)).toEqual(["send-1"]);
    expect(store.snapshot().statusMessage).toBe("无法删除 Send，请重试。");
    expect(store.snapshot().statusMessage).not.toContain("server rejected");
  });

  it("does not delete a Send when permanent deletion is not confirmed", async () => {
    const sendActions = new RecordingSendActions();
    await TestBed.configureTestingModule({
      imports: [SendPageComponent],
      providers: [
        PopupStateStore,
        provideRouter([]),
        { provide: SEND_ACTION_PORT, useValue: sendActions },
      ],
    }).compileComponents();
    const store = TestBed.inject(PopupStateStore);
    unlockForSendOperation(store);
    store.setSends([demoSend({ id: "send-1", name: "Payroll token", type: "text" })]);
    const fixture = TestBed.createComponent(SendPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    clickSendDelete(host);
    fixture.detectChanges();
    buttonByText(host, "取消").click();
    await fixture.whenStable();

    expect(sendActions.calls).toEqual([]);
    expect(store.snapshot().sends.map((send) => send.id)).toEqual(["send-1"]);
  });

  it("keeps password removal out of the Send list host", async () => {
    const sendActions = new RecordingSendActions();
    await TestBed.configureTestingModule({
      imports: [SendPageComponent],
      providers: [
        PopupStateStore,
        provideRouter([]),
        { provide: SEND_ACTION_PORT, useValue: sendActions },
      ],
    }).compileComponents();
    const store = TestBed.inject(PopupStateStore);
    store.setSends([
      demoSend({
        id: "send-1",
        name: "Payroll token",
        type: "text",
        password: "local-password",
        hasPassword: true,
      }),
    ]);
    const fixture = TestBed.createComponent(SendPageComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[aria-label^="移除密码"]')).toBeNull();
    expect("removePassword" in fixture.componentInstance).toBe(false);
    expect(sendActions.calls).toEqual([]);
  });

  it("does not publish status or mutate after route teardown invalidates delete", async () => {
    const gate = deferred<void>();
    const sendActions = new RecordingSendActions();
    sendActions.deleteWait = gate.promise;
    await TestBed.configureTestingModule({
      imports: [SendPageComponent],
      providers: [
        PopupStateStore,
        provideRouter([]),
        { provide: SEND_ACTION_PORT, useValue: sendActions },
      ],
    }).compileComponents();
    const store = TestBed.inject(PopupStateStore);
    unlockForSendOperation(store);
    store.setSends([demoSend({ id: "send-1", name: "Payroll token", type: "text" })]);
    const fixture = TestBed.createComponent(SendPageComponent);
    fixture.detectChanges();

    fixture.componentInstance.requestDelete(fixture.componentInstance.sends[0]!);
    const pending = fixture.componentInstance.confirmDelete();
    await vi.waitFor(() => expect(sendActions.calls).toHaveLength(1));
    fixture.destroy();
    store.setStatus("Route closed");
    gate.resolve();
    await pending;

    expect(store.snapshot().sends.map(({ id }) => id)).toEqual(["send-1"]);
    expect(store.snapshot().statusMessage).toBe("Route closed");
  });
});

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
    .find((candidate) => candidate.textContent?.trim() === text);
  if (!button) {
    throw new Error(`Missing button: ${text}`);
  }
  return button;
}

class RecordingSendActions implements SendActionPort {
  calls: Array<
    | { type: "delete"; session: AuthSession; sendId: string }
    | { type: "removePassword"; session: AuthSession; sendId: string }
    | {
        type: "updateText";
        session: AuthSession;
        send: SendItem;
        draft: {
          name: string;
          text: string;
          notes: string;
          password?: string;
          maxAccessCount?: number;
          hidden?: boolean;
          hideEmail?: boolean;
          deletionDate: string;
        };
      }
    | {
        type: "createText";
        session: AuthSession;
        draft: {
          name: string;
          text: string;
          notes: string;
          password?: string;
          maxAccessCount?: number;
          hidden?: boolean;
          hideEmail?: boolean;
          deletionDate: string;
        };
      }
    | {
        type: "createFile";
        session: AuthSession;
        draft: {
          name: string;
          notes: string;
          source: { id: string; fileName: string; size: number };
          password?: string;
          maxAccessCount?: number;
        };
      }
  > = [];
  failWith: Error | null = null;
  deleteWait: Promise<void> | null = null;
  refreshedSend: SendItem | undefined;
  createResult: SendItem = demoSend({
    id: "server-send",
    accessId: "server-access",
    urlB64Key: "server-key",
    name: "Server secret",
    text: "launch code",
    type: "text",
  });
  updateResult: SendItem = demoSend({
    id: "send-1",
    accessId: "access",
    urlB64Key: "existing-key",
    name: "Updated server secret",
    text: "new value",
    notes: "updated note",
    type: "text",
  });
  fileCreateResult: SendItem = demoSend({
    id: "server-file-send",
    accessId: "server-file-access",
    urlB64Key: "server-file-key",
    name: "report.pdf",
    type: "file",
    fileName: "report.pdf",
  });

  async deleteSend(session: AuthSession, send: SendItem): Promise<void> {
    this.calls.push({ type: "delete", session, sendId: send.id });
    await this.deleteWait;
    if (this.failWith) {
      throw this.failWith;
    }
  }

  async removePassword(session: AuthSession, send: SendItem): Promise<void> {
    this.calls.push({ type: "removePassword", session, sendId: send.id });
    if (this.failWith) {
      throw this.failWith;
    }
    this.refreshedSend = {
      ...send,
      password: undefined,
      hasPassword: false,
      revisionDate: "2026-07-19T12:03:04.567Z",
    };
  }

  async refreshTextSend(_session: AuthSession, sendId: string): Promise<SendItem> {
    if (!this.refreshedSend || this.refreshedSend.id !== sendId) {
      throw new Error("Missing exact refreshed Send fixture");
    }
    return this.refreshedSend;
  }

  async createTextSend(
    session: AuthSession,
    draft: {
      name: string;
      text: string;
      notes: string;
      password?: string;
      maxAccessCount?: number;
      hidden?: boolean;
      hideEmail?: boolean;
      deletionDate: string;
    },
  ): Promise<SendItem> {
    this.calls.push({ type: "createText", session, draft });
    if (this.failWith) {
      throw this.failWith;
    }

    return this.createResult;
  }

  async createFileSend(
    session: AuthSession,
    draft: {
      name: string;
      notes: string;
      source: { id: string; fileName: string; size: number };
      password?: string;
      maxAccessCount?: number;
    },
  ): Promise<SendItem> {
    this.calls.push({ type: "createFile", session, draft });
    if (this.failWith) {
      throw this.failWith;
    }

    return this.fileCreateResult;
  }

  async updateTextSend(
    session: AuthSession,
    send: SendItem,
    draft: {
      name: string;
      text: string;
      notes: string;
      password?: string;
      maxAccessCount?: number;
      hidden?: boolean;
      hideEmail?: boolean;
      deletionDate: string;
    },
  ): Promise<SendItem> {
    this.calls.push({ type: "updateText", session, send, draft });
    if (this.failWith) {
      throw this.failWith;
    }

    return this.updateResult;
  }
}

function fakeAuthSession(userKeyB64?: string): AuthSession {
  return {
    environment: buildSelfHostedEnvironmentFromServerUrl("https://bitwarden.example.com"),
    token: {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      tokenType: "Bearer",
      expiresIn: 3600,
    },
    ...(userKeyB64 ? { crypto: { userKeyB64 } } : {}),
  };
}

function sendSession(): AuthSession {
  return fakeAuthSession(
    "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8wMTIzNDU2Nzg5Ojs8PT4/QA==",
  );
}

function unlockForSendOperation(store: PopupStateStore): AuthSession {
  const session = fakeAuthSession(
    "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8wMTIzNDU2Nzg5Ojs8PT4/QA==",
  );
  store.setUnlocked("user@example.test");
  store.setActiveSession(session);
  return session;
}

function clickSendDelete(host: HTMLElement): void {
  const more = host.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]');
  expect(more).not.toBeNull();
  more!.click();

  const menu = document.querySelector<HTMLElement>(
    '[role="menu"][aria-label*="Payroll token"]',
  );
  expect(menu).not.toBeNull();
  const danger = menu!.querySelector<HTMLButtonElement>(
    '[role="menuitem"].tw-text-fg-danger',
  );
  expect(danger).not.toBeNull();
  danger!.click();
}

function demoSend(overrides: Partial<SendItem>): SendItem {
  return {
    id: "send",
    accessId: "access",
    type: "text",
    name: "Demo Send",
    notes: "",
    revisionDate: "2026-07-09T10:00:00.000Z",
    deletionDate: "2026-07-16T10:00:00.000Z",
    disabled: false,
    accessCount: 0,
    ...overrides,
  };
}

describe("SendAddEditPageComponent", () => {
  async function createAddEditFixture(type: "text" | "file", options: {
    send?: SendItem;
    generator?: GeneratorService;
    host?: HostApi;
    session?: AuthSession;
    sendActions?: SendActionPort;
    routeParams?: Subject<{ get(key: string): string | null }>;
  } = {}) {
    TestBed.resetTestingModule();
    const store = new PopupStateStore();
    if (options.send) {
      store.setSends([options.send]);
    }
    if (options.session) {
      store.setActiveSession(options.session);
      store.setUnlocked("user@example.test");
    }
    const sendId = options.send?.id ?? null;
    await TestBed.configureTestingModule({
      imports: [SendAddEditPageComponent],
      providers: [
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        provideRouter([{ path: "add-send", component: SendAddEditPageComponent }]),
        { provide: PopupStateStore, useValue: store },
        { provide: GeneratorService, useValue: options.generator ?? generatorService() },
        { provide: DialogService, useValue: { openSimpleDialog } },
        ...(options.host ? [{ provide: SEND_CREATED_HOST, useValue: options.host }] : []),
        ...(options.sendActions ? [{ provide: SEND_ACTION_PORT, useValue: options.sendActions }] : []),
        {
          provide: ActivatedRoute,
          useValue: {
            queryParamMap: options.routeParams ?? of({
              get: (key: string) => {
                if (key === "type") {
                  return type;
                }
                if (key === "sendId") {
                  return sendId;
                }
                return null;
              },
            }),
            snapshot: {
              queryParamMap: {
                get: (key: string) => {
                  if (key === "type") {
                    return type;
                  }
                  if (key === "sendId") {
                    return sendId;
                  }
                  return null;
                },
              },
            },
          },
        },
      ],
    }).compileComponents();

    const injectedStore = TestBed.inject(PopupStateStore);
    injectedStore.setSends(options.send ? [options.send] : []);
    if (options.session) {
      injectedStore.setActiveSession(options.session);
      injectedStore.setUnlocked("user@example.test");
    }

    return TestBed.createComponent(SendAddEditPageComponent);
  }

  it("renders the official-style text Send add form", async () => {
    const fixture = await createAddEditFixture("text");

    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector("popup-page > main")).not.toBeNull();
    expect(host.querySelector("main.detail-page")).toBeNull();
    expect(host.querySelector("popup-page popup-header h1")?.textContent).toContain("新增文本 Send");
    expect(host.textContent).toContain("Send 详细信息");
    expect(host.querySelector('input[bitinput][type="text"]')).not.toBeNull();
    expect(host.querySelector('textarea[bitinput]')).not.toBeNull();
    expect(host.textContent).toContain("默认隐藏文本");
    expect(host.textContent).toContain("删除日期");
    expect(host.textContent).not.toContain("谁可以查看");
    expect(host.textContent).toContain("附加选项");
    expect(host.querySelector('input[type="password"]')).toBeNull();
    expect(host.querySelector("footer button[bitbutton]")?.getAttribute("aria-disabled")).toBe("true");
    expect(host.querySelectorAll("bit-section").length).toBeGreaterThanOrEqual(2);
    expect(host.querySelector("bit-card")).not.toBeNull();
    expect(host.querySelector("bit-form-field")).not.toBeNull();
    expect(host.querySelector("input[bitinput]")).not.toBeNull();
    expect(host.querySelector("input[bitcheckbox]")).not.toBeNull();
    expect(host.querySelector("bit-select")).not.toBeNull();
    expect(textSendDeletionPresetHours).toEqual([1, 24, 48, 72, 7 * 24, 14 * 24, 30 * 24]);
    expect(host.querySelector(".send-form-field")).toBeNull();
    expect(host.querySelector(".detail-card")).toBeNull();
  });

  it("normalizes a file Send route to the text Send form", async () => {
    const fixture = await createAddEditFixture("file");

    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector("popup-page popup-header h1")?.textContent).toContain("新增文本 Send");
    expect(host.querySelector('textarea[bitinput]')).not.toBeNull();
    expect(host.querySelector(".file-send-picker")).toBeNull();
  });

  it("does not turn a forged File Send edit route into a new Text Send form", async () => {
    const fileSend = demoSend({
      id: "file-send",
      type: "file",
      name: "excluded.pdf",
      fileName: "excluded.pdf",
      text: undefined,
    });
    const fixture = await createAddEditFixture("text", { send: fileSend });

    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain("找不到此 Send");
    expect(host.textContent).not.toContain("excluded.pdf");
    expect(host.querySelector('input[bitinput][type="text"]')).toBeNull();
    expect(fixture.componentInstance.canSave).toBe(false);
  });

  it("does not create a fake local Send without an unlocked server session", async () => {
    const fixture = await createAddEditFixture("text");
    const store = TestBed.inject(PopupStateStore);
    const router = TestBed.inject(Router);
    const navigations: unknown[] = [];
    router.navigate = async (commands, extras) => {
      navigations.push({ commands, extras });
      return true;
    };

    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const name = host.querySelector<HTMLInputElement>('input[bitinput][type="text"]')!;
    const text = host.querySelector<HTMLTextAreaElement>('textarea[bitinput]')!;
    name.value = "One time secret";
    name.dispatchEvent(new Event("input"));
    text.value = "launch code";
    text.dispatchEvent(new Event("input"));
    fixture.detectChanges();

    const saveButton = host.querySelector<HTMLButtonElement>("footer button[bitbutton]")!;
    expect(saveButton.getAttribute("aria-disabled")).not.toBe("true");
    saveButton.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(store.snapshot().sends).toEqual([]);
    expect(store.snapshot().statusMessage).toBe("请先解锁密码库，再创建 Send。");
    expect(navigations).toEqual([]);
  });

  it("creates active session text Sends through Bitwarden before showing the created route", async () => {
    const sendActions = new RecordingSendActions();
    const session = fakeAuthSession("AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8wMTIzNDU2Nzg5Ojs8PT4/QA==");
    const fixture = await createAddEditFixture("text", { session, sendActions });
    const store = TestBed.inject(PopupStateStore);
    const router = TestBed.inject(Router);
    const navigations: unknown[] = [];
    router.navigate = async (commands, extras) => {
      navigations.push({ commands, extras });
      return true;
    };

    fixture.componentInstance.name = "Server secret";
    fixture.componentInstance.text = "launch code";
    fixture.componentInstance.privateNotes = "private note";
    fixture.componentInstance.maxAccessCount = 3;
    await fixture.componentInstance.save();

    expect(sendActions.calls).toMatchObject([
      {
        type: "createText",
        session,
        draft: {
          name: "Server secret",
          text: "launch code",
          notes: "private note",
          maxAccessCount: 3,
          deletionDate: expect.any(String),
        },
      },
    ]);
    expect(store.snapshot().sends[0]).toMatchObject({
      id: "server-send",
      accessId: "server-access",
      urlB64Key: "server-key",
      name: "Server secret",
      text: "launch code",
    });
    expect(navigations).toEqual([
      {
        commands: ["/send-created"],
        extras: { queryParams: { sendId: "server-send", type: "text" }, replaceUrl: true },
      },
    ]);
  });

  it("creates active session password-protected text Sends through Bitwarden", async () => {
    const sendActions = new RecordingSendActions();
    const session = fakeAuthSession("AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8wMTIzNDU2Nzg5Ojs8PT4/QA==");
    const fixture = await createAddEditFixture("text", { session, sendActions });
    const store = TestBed.inject(PopupStateStore);
    const router = TestBed.inject(Router);
    router.navigate = async () => true;

    fixture.componentInstance.name = "Protected secret";
    fixture.componentInstance.text = "launch code";
    fixture.componentInstance.password = "view-password";
    await fixture.componentInstance.save();

    expect(sendActions.calls).toMatchObject([
      {
        type: "createText",
        session,
        draft: {
          name: "Protected secret",
          text: "launch code",
          notes: "",
          password: "view-password",
          deletionDate: expect.any(String),
        },
      },
    ]);
    expect(store.snapshot().sends[0]?.id).toBe("server-send");
  });

  it("sends hidden text, hidden email, and deletion period selections to Bitwarden", async () => {
    const sendActions = new RecordingSendActions();
    const session = fakeAuthSession("AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8wMTIzNDU2Nzg5Ojs8PT4/QA==");
    const fixture = await createAddEditFixture("text", { session, sendActions });
    TestBed.inject(Router).navigate = async () => true;
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const hiddenInput = host.querySelector<HTMLInputElement>('bw-official-send-text-details input[bitcheckbox]')!;
    hiddenInput.checked = true;
    hiddenInput.dispatchEvent(new Event("change"));
    const hideEmailInput = host.querySelector<HTMLInputElement>('bw-official-send-options input[bitcheckbox]')!;
    hideEmailInput.checked = true;
    hideEmailInput.dispatchEvent(new Event("change"));
    fixture.detectChanges();
    fixture.componentInstance.setDeletionHoursValue(30 * 24);
    fixture.componentInstance.name = "Configured secret";
    fixture.componentInstance.text = "hidden value";

    await fixture.componentInstance.save();

    expect(sendActions.calls).toEqual([
      {
        type: "createText",
        session,
        draft: {
          name: "Configured secret",
          text: "hidden value",
          notes: "",
          authType: "none",
          hidden: true,
          hideEmail: true,
          deletionDate: expect.any(String),
        },
      },
    ]);
  });

  it.each([
    [1, "2026-07-19T13:00:00.000Z"],
    [14 * 24, "2026-08-02T12:00:00.000Z"],
  ])("emits an exact deletion date for the %i-hour preset", async (hours, deletionDate) => {
    const sendActions = new RecordingSendActions();
    const session = fakeAuthSession("AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8wMTIzNDU2Nzg5Ojs8PT4/QA==");
    const fixture = await createAddEditFixture("text", { session, sendActions });
    TestBed.inject(Router).navigate = async () => true;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T12:00:00.000Z"));

    try {
      fixture.componentInstance.name = "Timed secret";
      fixture.componentInstance.text = "value";
      fixture.componentInstance.setDeletionHoursValue(hours);

      await fixture.componentInstance.save();

      expect(sendActions.calls).toHaveLength(1);
      expect(sendActions.calls[0]).toMatchObject({
        type: "createText",
        draft: { deletionDate },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("generates a Send password without creating a local-only Send", async () => {
    const generator = generatorService("OfficialSendPassword1");
    const fixture = await createAddEditFixture("text", { generator });
    const store = TestBed.inject(PopupStateStore);
    const router = TestBed.inject(Router);
    router.navigate = async () => true;

    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLInputElement>('input[bitinput][type="text"]')!.value = "Protected secret";
    host.querySelector<HTMLInputElement>('input[bitinput][type="text"]')!.dispatchEvent(new Event("input"));
    host.querySelector<HTMLTextAreaElement>('textarea[bitinput]')!.value = "launch code";
    host.querySelector<HTMLTextAreaElement>('textarea[bitinput]')!.dispatchEvent(new Event("input"));
    fixture.componentInstance.form.patch({ authType: "password" });
    fixture.detectChanges();
    host.querySelector<HTMLButtonElement>('[data-testid="generate-password"]')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    const password = host.querySelector<HTMLInputElement>('input[type="password"]');
    expect(password?.value).toBe("OfficialSendPassword1");
    expect(generator.generate).toHaveBeenCalledWith("password");

    await fixture.componentInstance.save();

    expect(store.snapshot().sends).toEqual([]);
    expect(store.snapshot().statusMessage).toBe("请先解锁密码库，再创建 Send。");
  });

  it("reports Send password generation failures without leaking generated values", async () => {
    const generator = generatorService();
    generator.generate.mockRejectedValueOnce(new Error("SDK failed near leaked-secret"));
    const fixture = await createAddEditFixture("text", { generator });
    const store = TestBed.inject(PopupStateStore);
    fixture.detectChanges();

    await fixture.componentInstance.generatePassword();
    fixture.changeDetectorRef.detectChanges();

    expect(fixture.componentInstance.password).toBe("");
    const alert = fixture.nativeElement.querySelector('[data-testid="send-password-error"]') as HTMLElement | null;
    expect(alert?.textContent).toContain("无法生成密码");
    expect(alert?.textContent).not.toContain("leaked-secret");
    expect(store.snapshot().statusMessage).not.toContain("leaked-secret");
  });

  it("ignores stale concurrent Send password generation results", async () => {
    const first = deferred<GeneratedCredential>();
    const second = deferred<GeneratedCredential>();
    const generator = generatorService();
    generator.generate.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const fixture = await createAddEditFixture("text", { generator });
    fixture.detectChanges();

    const firstRequest = fixture.componentInstance.generatePassword();
    const secondRequest = fixture.componentInstance.generatePassword();
    second.resolve(generatedPassword("new-password"));
    await secondRequest;
    first.resolve(generatedPassword("stale-password"));
    await firstRequest;

    expect(fixture.componentInstance.password).toBe("new-password");
  });

  it.each(["save", "remove-password", "delete", "cancel", "back"] as const)(
    "invalidates a pending generated password as soon as %s supersedes the form",
    async (transition) => {
      const pendingGeneration = deferred<GeneratedCredential>();
      const pendingMutation = new Promise<never>(() => undefined);
      const generator = generatorService();
      generator.generate.mockReturnValueOnce(pendingGeneration.promise);
      const existing = demoSend({ id: "send-1", name: "Protected", text: "value", hasPassword: true });
      const sendActions: SendActionPort = {
        createTextSend: vi.fn(() => pendingMutation),
        updateTextSend: vi.fn(() => pendingMutation),
        deleteSend: vi.fn(() => pendingMutation),
        removePassword: vi.fn(() => pendingMutation),
        refreshTextSend: vi.fn(() => pendingMutation),
      };
      const fixture = await createAddEditFixture("text", {
        send: existing,
        session: sendSession(),
        generator,
        sendActions,
      });
      fixture.componentInstance.beginEditing();

      const generation = fixture.componentInstance.generatePassword();
      if (transition === "save") void fixture.componentInstance.save();
      if (transition === "remove-password") void fixture.componentInstance.removePassword();
      if (transition === "delete") void fixture.componentInstance.delete();
      if (transition === "cancel") fixture.componentInstance.cancelEditing();
      if (transition === "back") void fixture.componentInstance.back();
      pendingGeneration.resolve(generatedPassword("obsolete-generated-password"));
      await generation;

      expect(fixture.componentInstance.form.value().password).toBe("");
    },
  );

  it.each(["save", "remove-password", "delete", "cancel", "back"] as const)(
    "does not copy an obsolete password after %s supersedes the form",
    async (transition) => {
      const pendingMutation = new Promise<never>(() => undefined);
      const copyText = vi.fn(async () => undefined);
      const host = { copyText } as unknown as HostApi;
      const existing = demoSend({ id: "send-1", name: "Protected", text: "value", hasPassword: true });
      const sendActions: SendActionPort = {
        createTextSend: vi.fn(() => pendingMutation),
        updateTextSend: vi.fn(() => pendingMutation),
        deleteSend: vi.fn(() => pendingMutation),
        removePassword: vi.fn(() => pendingMutation),
        refreshTextSend: vi.fn(() => pendingMutation),
      };
      const fixture = await createAddEditFixture("text", {
        send: existing,
        session: sendSession(),
        host,
        sendActions,
      });
      fixture.componentInstance.beginEditing();
      fixture.componentInstance.password = "obsolete-password";

      const copying = fixture.componentInstance.copyPassword();
      if (transition === "save") void fixture.componentInstance.save();
      if (transition === "remove-password") void fixture.componentInstance.removePassword();
      if (transition === "delete") void fixture.componentInstance.delete();
      if (transition === "cancel") fixture.componentInstance.cancelEditing();
      if (transition === "back") void fixture.componentInstance.back();
      await copying;

      expect(copyText).not.toHaveBeenCalled();
    },
  );

  it("opens an existing text Send in view mode and only edits after an explicit action", async () => {
    const existing = demoSend({
      id: "send-1",
      type: "text",
      name: "Old secret",
      text: "old value",
      notes: "private",
      maxAccessCount: 3,
      password: "old-password",
    });
    const fixture = await createAddEditFixture("text", { send: existing });
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(fixture.componentInstance.editing).toBe(false);
    expect(host.querySelector("popup-page popup-header h1")?.textContent).toContain("查看文本 Send");
    expect((host.querySelector('input[bitinput][type="text"]') as HTMLInputElement).value).toBe("Old secret");
    expect((host.querySelector('textarea[bitinput]') as HTMLTextAreaElement).value).toBe("old value");

    host.querySelector<HTMLButtonElement>('[data-testid="edit-send"]')?.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.editing).toBe(true);
    expect((host.querySelector('input[bitinput][type="text"]') as HTMLInputElement).value).toBe("Old secret");
    expect((host.querySelector('textarea[bitinput]') as HTMLTextAreaElement).value).toBe("old value");
    expect((host.querySelector('input[type="password"]') as HTMLInputElement).value).toBe("");

    host.querySelector<HTMLButtonElement>('[data-testid="cancel-send-edit"]')?.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.editing).toBe(false);
    expect((host.querySelector('input[bitinput][type="text"]') as HTMLInputElement).readOnly).toBe(true);
    expect(TestBed.inject(PopupStateStore).snapshot().sends[0]).toEqual(existing);
  });

  it("updates active session text Sends through Bitwarden before saving local state", async () => {
    const existing = demoSend({
      id: "send-1",
      accessId: "access",
      urlB64Key: "existing-key",
      type: "text",
      name: "Old server secret",
      text: "old value",
      notes: "private",
      maxAccessCount: 3,
    });
    const sendActions = new RecordingSendActions();
    const session = fakeAuthSession("AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8wMTIzNDU2Nzg5Ojs8PT4/QA==");
    const fixture = await createAddEditFixture("text", { send: existing, session, sendActions });
    const store = TestBed.inject(PopupStateStore);
    const router = TestBed.inject(Router);
    const navigations: unknown[] = [];
    router.navigate = async (commands, extras) => {
      navigations.push({ commands, extras });
      return true;
    };

    fixture.componentInstance.beginEditing();
    fixture.componentInstance.name = "Updated server secret";
    fixture.componentInstance.text = "new value";
    fixture.componentInstance.privateNotes = "updated note";
    fixture.componentInstance.maxAccessCount = null;
    await fixture.componentInstance.save();

    expect(sendActions.calls).toMatchObject([
      {
        type: "updateText",
        session,
        send: existing,
        draft: {
          name: "Updated server secret",
          text: "new value",
          notes: "updated note",
          deletionDate: expect.any(String),
        },
      },
    ]);
    expect(store.snapshot().sends[0]).toMatchObject({
      id: "send-1",
      name: "Updated server secret",
      text: "new value",
      notes: "updated note",
    });
    expect(navigations).toEqual([
      {
        commands: ["/edit-send"],
        extras: { queryParams: { sendId: "send-1", type: "text" }, replaceUrl: false },
      },
    ]);
    expect(fixture.componentInstance.editing).toBe(false);
  });

  it("keeps the exact existing deletion date unless the visible preset changes", async () => {
    const existing = demoSend({
      id: "send-1",
      deletionDate: "2026-09-03T04:05:06.789Z",
      name: "Existing",
      text: "existing text",
    });
    const sendActions = new RecordingSendActions();
    const fixture = await createAddEditFixture("text", {
      send: existing,
      session: sendSession(),
      sendActions,
    });
    TestBed.inject(Router).navigate = async () => true;

    fixture.componentInstance.beginEditing();
    fixture.componentInstance.name = "Name only";
    await fixture.componentInstance.save();

    expect(sendActions.calls[0]).toMatchObject({
      type: "updateText",
      draft: { deletionDate: "2026-09-03T04:05:06.789Z" },
    });

    fixture.componentInstance.beginEditing();
    fixture.componentInstance.setDeletionHoursValue(24);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T12:00:00.000Z"));
    try {
      await fixture.componentInstance.save();
    } finally {
      vi.useRealTimers();
    }
    expect(sendActions.calls[1]).toMatchObject({
      type: "updateText",
      draft: { deletionDate: "2026-07-20T12:00:00.000Z" },
    });
  });

  it("adopts exact reconciled store objects across update, remove-password, and delete", async () => {
    const existing = demoSend({
      id: "send-1",
      name: "Protected",
      text: "first",
      hasPassword: true,
    });
    const sendActions = new RecordingSendActions();
    const fixture = await createAddEditFixture("text", {
      send: existing,
      session: sendSession(),
      sendActions,
    });
    TestBed.inject(Router).navigate = async () => true;

    fixture.componentInstance.beginEditing();
    fixture.componentInstance.text = "second";
    await fixture.componentInstance.save();
    const updated = TestBed.inject(PopupStateStore).snapshot().sends[0];
    expect(fixture.componentInstance.sourceSendForTest()).toBe(updated);

    await fixture.componentInstance.removePassword();
    const withoutPassword = TestBed.inject(PopupStateStore).snapshot().sends[0];
    expect(fixture.componentInstance.sourceSendForTest()).toBe(withoutPassword);

    await fixture.componentInstance.delete();
    expect(sendActions.calls.map(({ type }) => type)).toEqual([
      "updateText",
      "removePassword",
      "delete",
    ]);
  });

  it("carries an explicit no-auth choice when saving an existing protected Send", async () => {
    const sendActions = new RecordingSendActions();
    const fixture = await createAddEditFixture("text", {
      send: demoSend({ id: "send-1", text: "first", hasPassword: true }),
      session: sendSession(),
      sendActions,
    });
    TestBed.inject(Router).navigate = async () => true;

    fixture.componentInstance.beginEditing();
    fixture.componentInstance.form.patch({ authType: "none" });
    await fixture.componentInstance.save();

    expect(sendActions.calls[0]).toMatchObject({
      type: "updateText",
      draft: { authType: "none" },
    });
  });

  it("enforces hide-email policy changes in the UI and at draft transport", async () => {
    const sendActions = new RecordingSendActions();
    const fixture = await createAddEditFixture("text", {
      session: sendSession(),
      sendActions,
    });
    const store = TestBed.inject(PopupStateStore);
    TestBed.inject(Router).navigate = async () => true;
    fixture.componentInstance.name = "Policy draft";
    fixture.componentInstance.text = "value";
    fixture.componentInstance.hideEmail = true;
    fixture.detectChanges(false);
    expect((fixture.nativeElement as HTMLElement)
      .querySelector('bw-official-send-options input[bitcheckbox]')).not.toBeNull();

    store.setSends([], { disabled: false, hideEmailAllowed: false });
    fixture.detectChanges(false);
    expect(fixture.componentInstance.hideEmailAllowed).toBe(false);
    expect((fixture.nativeElement as HTMLElement)
      .querySelector('bw-official-send-options input[bitcheckbox]')).toBeNull();

    await fixture.componentInstance.save();
    expect(sendActions.calls[0]).toMatchObject({ draft: { hideEmail: false } });
  });

  it.each(["lock", "logout", "account switch", "restore", "same-id replacement"])(
    "clears source and plaintext immediately after %s",
    async (transition) => {
      const existing = demoSend({ id: "send-1", name: "Plain name", text: "Plain text" });
      const fixture = await createAddEditFixture("text", {
        send: existing,
        session: fakeAuthSession(),
      });
      const store = TestBed.inject(PopupStateStore);
      const ownedSnapshot = store.snapshot();

      if (transition === "lock") store.setLocked();
      if (transition === "logout") store.setLoggedOut();
      if (transition === "account switch") {
        store.setUnlocked("other@example.test");
        store.setActiveSession(fakeAuthSession());
      }
      if (transition === "restore") store.restore(ownedSnapshot);
      if (transition === "same-id replacement") {
        store.saveSend(demoSend({ id: "send-1", name: "Replacement", text: "replacement" }));
      }

      expect(fixture.componentInstance.sourceSendForTest()).toBeUndefined();
      expect(fixture.componentInstance.form.value()).toMatchObject({ name: "", text: "", password: "" });
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).textContent).not.toContain("Plain text");
    },
  );

  it("unsubscribes route params and clears plaintext on destroy", async () => {
    const routeParams = new Subject<{ get(key: string): string | null }>();
    const existing = demoSend({ id: "send-1", name: "Plain name", text: "Plain text" });
    const fixture = await createAddEditFixture("text", { send: existing, routeParams });
    routeParams.next({ get: (key) => key === "sendId" ? "send-1" : key === "type" ? "text" : null });
    expect(routeParams.observed).toBe(true);

    fixture.destroy();

    expect(routeParams.observed).toBe(false);
    expect(fixture.componentInstance.sourceSendForTest()).toBeUndefined();
    expect(fixture.componentInstance.form.value()).toMatchObject({ name: "", text: "", password: "" });
  });

  it("retains dirty edits when discard is declined and only resets after confirmation", async () => {
    const existing = demoSend({ id: "send-1", name: "Original", text: "original" });
    const fixture = await createAddEditFixture("text", { send: existing });
    fixture.componentInstance.beginEditing();
    fixture.componentInstance.name = "Unsaved";
    openSimpleDialog.mockResolvedValueOnce(false);

    await fixture.componentInstance.back();
    expect(fixture.componentInstance.editing).toBe(true);
    expect(fixture.componentInstance.name).toBe("Unsaved");

    openSimpleDialog.mockResolvedValueOnce(true);
    await fixture.componentInstance.back();
    expect(fixture.componentInstance.editing).toBe(false);
    expect(fixture.componentInstance.name).toBe("Original");
  });

  it("blocks direct add and edit saves when Send is disabled by policy", async () => {
    const sendActions = new RecordingSendActions();
    const session = fakeAuthSession("AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8wMTIzNDU2Nzg5Ojs8PT4/QA==");
    const fixture = await createAddEditFixture("text", { session, sendActions });
    const store = TestBed.inject(PopupStateStore);
    store.setSendDisabled(true);
    fixture.componentInstance.name = "Blocked secret";
    fixture.componentInstance.text = "must not be sent";

    await fixture.componentInstance.save();

    expect(sendActions.calls).toEqual([]);
    expect(store.snapshot().sends).toEqual([]);
    expect(store.snapshot().statusMessage).toBe("组织策略已禁用 Send。");

    const existing = demoSend({
      id: "existing-send",
      urlB64Key: "existing-key",
      name: "Existing secret",
      text: "existing text",
    });
    const editFixture = await createAddEditFixture("text", { send: existing, session, sendActions });
    const editStore = TestBed.inject(PopupStateStore);
    editStore.setSendDisabled(true);
    editFixture.componentInstance.beginEditing();
    editFixture.componentInstance.name = "Blocked edit";

    await editFixture.componentInstance.save();

    expect(sendActions.calls).toEqual([]);
    expect(editStore.snapshot().sends[0]).toEqual(existing);
    expect(editStore.snapshot().statusMessage).toBe("组织策略已禁用 Send。");
  });
});

function generatorService(credential = "generated-password") {
  return {
    generate: vi.fn(async () => generatedPassword(credential)),
  } as unknown as GeneratorService & {
    generate: ReturnType<typeof vi.fn<GeneratorService["generate"]>>;
  };
}

function generatedPassword(credential: string): GeneratedCredential {
  return {
    credential,
    category: "password",
    generationDate: new Date("2026-07-11T00:00:00.000Z"),
    algorithm: "password",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("SendCreatedPageComponent", () => {
  it("builds Send links from the active environment Send URL", () => {
    const store = new PopupStateStore();
    const session = {
      ...fakeAuthSession(),
      environment: buildSelfHostedEnvironmentFromServerUrl("https://vault.example.test"),
    };
    store.setServerUrl("https://vault.example.test");
    store.setActiveSession({
      ...session,
      environment: {
        ...session.environment,
        sendUrl: "https://send.example.test/base/",
      },
    });

    const link = new SendLinkBuilder(store).linkFor(
      demoSend({ id: "send-1", accessId: "access-token", urlB64Key: "url-key" }),
    );

    expect(link).toBe("https://send.example.test/base/#/send/access-token/url-key");
  });

  async function createCreatedFixture(
    sendId: string,
    copied: string[] = [],
    popOutHost?: PopOutHost,
    sendType: "text" | "file" = "text",
    overrides: Partial<SendItem> = {},
  ) {
    const store = new PopupStateStore();
    const session = {
      ...fakeAuthSession(),
      environment: buildSelfHostedEnvironmentFromServerUrl("https://vault.example.test"),
    };
    store.setServerUrl("https://vault.example.test");
    store.setUnlocked("person@example.test");
    store.setActiveSession(session);
    store.setSends([
      demoSend({
        id: sendId,
        accessId: "access-token",
        urlB64Key: "url-key",
        name: "One time secret",
        deletionDate: "2026-07-16T10:00:00.000Z",
        type: sendType,
        ...(sendType === "file" ? { fileName: "excluded.pdf", text: undefined } : {}),
        ...overrides,
      }),
    ]);

    await TestBed.configureTestingModule({
      imports: [SendCreatedPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        {
          provide: SEND_CREATED_HOST,
          useValue: {
            copyText: async (value: string) => copied.push(value),
          },
        },
        { provide: POP_OUT_HOST, useValue: popOutHost ?? null },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: {
                get: (key: string) => (key === "sendId" ? sendId : null),
              },
            },
          },
        },
      ],
    }).compileComponents();

    return TestBed.createComponent(SendCreatedPageComponent);
  }

  it("renders the official created Send confirmation and copies its link", async () => {
    const copied: string[] = [];
    const fixture = await createCreatedFixture("send-created", copied);

    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain("已创建 Send");
    expect(host.textContent).toContain("Send 创建成功");
    expect(host.textContent).toContain("复制链接");
    expect(host.querySelectorAll("button[bitbutton]")).toHaveLength(3);
    expect(host.querySelector(".primary-action")).toBeNull();
    expect(host.querySelector(".secondary-action")).toBeNull();

    host.querySelector<HTMLButtonElement>('[data-testid="created-copy"]')!.click();
    await fixture.whenStable();

    expect(copied).toEqual(["https://vault.example.test/#/send/access-token/url-key"]);
    expect(TestBed.inject(PopupStateStore).snapshot().statusMessage).toBe(
      translateOfficialMessage("i18nSendLinkCopied"),
    );
    expect(TestBed.inject(AppFeedbackService).snapshot()).toMatchObject({
      kind: "success",
      message: translateOfficialMessage("i18nSendLinkCopied"),
    });
  });

  it("maps the official Send created pop-out action to the native menubar window command", async () => {
    const calls: string[] = [];
    const fixture = await createCreatedFixture("send-created", [], {
      popOut: async (route: string) => {
        calls.push(route);
      },
    });
    const router = TestBed.inject(Router);
    Object.defineProperty(router, "url", {
      value: "/send-created?sendId=send-created",
      configurable: true,
    });

    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const popOut = host.querySelector<HTMLButtonElement>('[aria-label="弹出到新窗口"]');
    expect(popOut).not.toBeNull();
    expect(popOut?.disabled).toBe(false);

    popOut!.click();
    await fixture.whenStable();

    expect(calls).toEqual(["/send-created?sendId=send-created"]);
  });

  it("does not expose or copy a File Send through the created route", async () => {
    const copied: string[] = [];
    const fixture = await createCreatedFixture("file-send", copied, undefined, "file");

    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector("bw-official-send-created")).toBeNull();
    expect(host.textContent).not.toContain("excluded.pdf");
    await fixture.componentInstance.copyLink();
    expect(copied).toEqual([]);
  });

  it.each([
    ["access id", { accessId: "" }],
    ["URL key", { urlB64Key: undefined }],
  ])("does not expose copy when the created Text Send is missing its %s", async (_label, overrides) => {
    const copied: string[] = [];
    const fixture = await createCreatedFixture("invalid-send", copied, undefined, "text", overrides);

    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector("bw-official-send-created")).toBeNull();
    await fixture.componentInstance.copyLink();
    expect(copied).toEqual([]);
  });

  it.each([
    ["lock", (store: PopupStateStore) => store.setLocked()],
    ["logout", (store: PopupStateStore) => store.setLoggedOut()],
    ["account switch", (store: PopupStateStore) => {
      store.setUnlocked("other@example.test");
      store.setActiveSession({
        ...fakeAuthSession(),
        environment: buildSelfHostedEnvironmentFromServerUrl("https://other.example.test"),
      });
      store.setSends([demoSend({
        id: "send-created",
        accessId: "other-access-token",
        urlB64Key: "other-url-key",
        name: "Other account secret",
      })]);
    }],
  ])("does not render or copy a created Send after %s", async (_reason, invalidate) => {
    const copied: string[] = [];
    const fixture = await createCreatedFixture("send-created", copied);
    const store = TestBed.inject(PopupStateStore);

    fixture.detectChanges();
    invalidate(store);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector("bw-official-send-created")).toBeNull();
    await fixture.componentInstance.copyLink();
    expect(copied).toEqual([]);
  });

  it("does not render or copy a created Send replaced under the same id", async () => {
    const copied: string[] = [];
    const fixture = await createCreatedFixture("send-created", copied);
    const store = TestBed.inject(PopupStateStore);

    fixture.detectChanges();
    store.saveSend(demoSend({
      id: "send-created",
      accessId: "replacement-access-token",
      urlB64Key: "replacement-url-key",
      name: "Replacement secret",
    }));
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector("bw-official-send-created")).toBeNull();
    await fixture.componentInstance.copyLink();
    expect(copied).toEqual([]);
  });

  it("does not revalidate a created Send after restoring an older unlocked snapshot", async () => {
    const copied: string[] = [];
    const fixture = await createCreatedFixture("send-created", copied);
    const store = TestBed.inject(PopupStateStore);
    const snapshot = store.snapshot();

    fixture.detectChanges();
    store.setLocked();
    store.restore(snapshot);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector("bw-official-send-created")).toBeNull();
    await fixture.componentInstance.copyLink();
    expect(copied).toEqual([]);
  });
});
