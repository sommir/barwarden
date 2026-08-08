import "zone.js";
import "@angular/compiler";

import { webcrypto } from "node:crypto";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { PopupStateStore } from "../popup-state";
import { POP_OUT_HOST, type PopOutHost } from "../popup-header-actions.component";
import { demoVaultItems } from "../vault-demo";
import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { LocalCopyFeedbackService } from "../official-ui/local-copy-feedback.service";
import {
  VAULT_CIPHER_ACTION_PORT,
  VaultActionsService,
  type VaultRemovalMutationOutcome,
} from "./vault-actions.service";
import { VaultFacade } from "./vault.facade";
import { VaultItemDetailPageComponent } from "./vault-item-detail-page.component";
import { OFFICIAL_TOTP_CLOCK } from "./official-totp.service.adapter";
import { VaultRepromptService } from "./vault-reprompt.service";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("VaultItemDetailPageComponent", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", webcrypto);
    TestBed.configureTestingModule({
      providers: [
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    });
  });

  async function createFixture(
    actionsOverride?: Partial<Pick<VaultActionsService,
      | "copyField"
      | "copyFieldWithOutcome"
      | "fillField"
      | "fillFieldWithOutcome"
      | "launchItem"
      | "launchUri"
      | "launchUriWithOutcome"
      | "archiveItemWithOutcome"
      | "deleteItemWithOutcome"
      | "unarchiveItemWithOutcome"
      | "deleteArchivedItemWithOutcome"
      | "restoreDeletedItemWithOutcome"
      | "permanentlyDeleteItemWithOutcome"
    >>,
    popOutHost?: PopOutHost,
    items = demoVaultItems,
    archivedItems: typeof demoVaultItems = [],
    deletedItems: typeof demoVaultItems = [],
  ) {
    const store = new PopupStateStore();
    store.setUnlocked("account-a@example.test");
    store.setItems(items);
    store.setArchivedItems(archivedItems);
    store.setDeletedItems(deletedItems);
    const repromptVerify = vi.fn().mockResolvedValue(true);
    const copyField = actionsOverride?.copyField ?? vi.fn(async () => "Copied");
    const fillField = actionsOverride?.fillField ?? vi.fn(async () => "Filled");
    const launchUri = actionsOverride?.launchUri ?? vi.fn(async () => "Opened URL");
    const actions = {
      copyField,
      copyFieldWithOutcome: vi.fn(async (field: typeof demoVaultItems[number]["fields"][number]) => ({
        committed: true as const,
        status: await copyField(field),
      })),
      fillField,
      fillFieldWithOutcome: vi.fn(async (field: typeof demoVaultItems[number]["fields"][number]) => ({
        committed: true as const,
        status: await fillField(field),
      })),
      launchItem: vi.fn(async () => "Open"),
      launchUri,
      launchUriWithOutcome: vi.fn(async (uri: string) => ({
        committed: true as const,
        status: await launchUri(uri),
      })),
      archiveItemWithOutcome: vi.fn(async (item: typeof demoVaultItems[number]) => {
        store.archiveVaultItem(item.id);
        return removalOutcome(item, "Archived item");
      }),
      deleteItemWithOutcome: vi.fn(async (item: typeof demoVaultItems[number]) => {
        store.deleteVaultItem(item.id);
        return removalOutcome(item, "Moved item to trash");
      }),
      unarchiveItemWithOutcome: vi.fn(async (item: typeof demoVaultItems[number]) => {
        store.restoreArchivedVaultItem(item.id);
        return removalOutcome(item, "Item unarchived");
      }),
      deleteArchivedItemWithOutcome: vi.fn(async (item: typeof demoVaultItems[number]) => {
        store.moveArchivedVaultItemToTrash(item.id);
        return removalOutcome(item, "Moved item to trash");
      }),
      restoreDeletedItemWithOutcome: vi.fn(async (item: typeof demoVaultItems[number]) => {
        store.restoreDeletedVaultItem(item.id);
        return removalOutcome(item, "Item restored");
      }),
      permanentlyDeleteItemWithOutcome: vi.fn(async (item: typeof demoVaultItems[number]) => {
        store.permanentlyDeleteVaultItem(item.id);
        return removalOutcome(item, "Item permanently deleted");
      }),
      ...actionsOverride,
    };
    await TestBed.configureTestingModule({
      imports: [VaultItemDetailPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        VaultFacade,
        {
          provide: VaultActionsService,
          useValue: actions satisfies Partial<Record<keyof VaultActionsService, unknown>>,
        },
        { provide: POP_OUT_HOST, useValue: popOutHost ?? null },
        { provide: VaultRepromptService, useValue: { verify: repromptVerify } },
        { provide: OFFICIAL_TOTP_CLOCK, useValue: () => 1_700_000_000 },
      ],
    }).compileComponents();

    const router = TestBed.inject(Router);
    const navigateByUrl = vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);

    return {
      fixture: TestBed.createComponent(VaultItemDetailPageComponent),
      actions,
      navigateByUrl,
      repromptVerify,
      store,
    };
  }

  it("renders Login detail through the guarded official child composition", async () => {
    const { fixture } = await createFixture();
    fixture.componentRef.setInput("id", "github");
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector("bw-official-login-detail")).not.toBeNull();
    expect(host.querySelector("official-item-details")).not.toBeNull();
    expect(host.querySelector("official-login-credentials")).not.toBeNull();
    expect(host.querySelector("official-login-uri-options")).not.toBeNull();
    expect(host.querySelector("official-custom-fields")).not.toBeNull();
    expect(host.querySelector("bit-form-field input[bitinput][readonly]")).not.toBeNull();
    expect(host.querySelector('button[biticonbutton][aria-label="复制用户名"]')).not.toBeNull();
    expect(host.querySelector("bw-vault-detail-section")).toBeNull();
    expect(host.querySelector(".cipher-item-details-card")).toBeNull();
    expect(host.querySelector("popup-page")).not.toBeNull();
    expect(host.querySelector('popup-header[slot="header"]')).not.toBeNull();
    const footer = host.querySelector('popup-footer[slot="footer"]');
    expect(footer).not.toBeNull();
    expect(footer?.parentElement?.tagName).toBe("POPUP-PAGE");
    expect(host.querySelector(".popup-page.detail-page")).toBeNull();
    expect(host.querySelector(".detail-header")).toBeNull();
    expect(host.querySelector("popup-page popup-header h1")?.textContent).toContain("查看登录");
    expect(host.textContent).toContain("GitHub");
    expect(host.textContent).toContain("登录凭据");
    expect(host.textContent).toContain("自动填充选项");
    expect(host.textContent).toContain("项目历史记录");
    expect(
      [...host.querySelectorAll("bit-section-header h2")].map(
        (node) => node.textContent?.trim(),
      ),
    ).toEqual(["登录凭据", "自动填充选项", "自定义字段", "项目历史记录"]);
    expect(host.textContent).not.toContain("附加选项");
    expect(host.querySelector('bit-card [data-testid="item-name"]')).not.toBeNull();
    expect(host.querySelector("official-item-details .bwi-globe")).not.toBeNull();
    expect(host.querySelector("#userName")).not.toBeNull();
    expect(host.querySelector("#password")).not.toBeNull();
    expect(host.querySelectorAll('[data-testid="launch-website"]')).toHaveLength(2);
    expect(host.querySelector(".detail-summary-card")).toBeNull();
    expect(host.querySelector(".detail-card")).toBeNull();
    expect(host.querySelector(".detail-field")).toBeNull();
    expect(host.querySelector(".detail-history-row")).toBeNull();
    expect(host.querySelectorAll('[aria-label^="前往"]').length).toBe(2);
    expect(host.querySelector('[data-testid="toggle-password"]')).not.toBeNull();
    expect(host.querySelector("footer a[bitbutton]")?.textContent).toContain("编辑");
  });

  it("marks the detail composition as a secondary macOS page without primary navigation", async () => {
    const { fixture } = await createFixture();
    fixture.componentRef.setInput("id", "github");
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const page = host.querySelector("popup-page");
    expect(page?.classList).toContain("macos-page");
    expect(page?.classList).toContain("macos-page--vault-detail");
    // `cipher-view` is a layout container. The official item-detail and
    // credential sections are the leaf cards; making this wrapper a card
    // would create a second opaque white surface behind them.
    expect(host.querySelector(".cipher-view")?.classList).not.toContain("macos-card");
    expect(host.querySelector("bw-floating-tab-switcher")).toBeNull();
  });

  it("renders TOTP with the pinned official countdown component instead of the local substitute", async () => {
    const { fixture } = await createFixture();
    fixture.componentRef.setInput("id", "github");
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector("[bitTotpCountdown]")).not.toBeNull();
    expect(host.querySelector("bw-vault-totp-code")).toBeNull();
  });

  it("does not expose deferred attachment actions", async () => {
    const item = {
      ...demoVaultItems[0],
      id: "with-attachment",
      attachments: [{ id: "attachment-1", fileName: "private.pdf", size: "12 KB" }],
    };
    const { fixture } = await createFixture(undefined, undefined, [item]);
    fixture.componentRef.setInput("id", item.id);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('a[href^="/attachments"]')).toBeNull();
    expect(host.textContent).not.toContain("private.pdf");
  });

  it("returns to the Vault through the shared popup header", async () => {
    const { fixture, navigateByUrl } = await createFixture();
    fixture.componentRef.setInput("id", "github");
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLButtonElement>('[aria-label="返回"]')!.click();
    await fixture.whenStable();

    expect(navigateByUrl).toHaveBeenCalledWith("/tabs/vault");
  });

  it("maps the official detail pop-out action to the native menubar window command", async () => {
    const calls: string[] = [];
    const { fixture } = await createFixture(undefined, { popOut: async (route: string) => calls.push(route) });
    const router = TestBed.inject(Router);
    Object.defineProperty(router, "url", { value: "/view-cipher/github", configurable: true });
    fixture.componentRef.setInput("id", "github");
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const popOut = host.querySelector<HTMLButtonElement>('[aria-label="弹出到新窗口"]');
    expect(popOut).not.toBeNull();
    expect(popOut?.disabled).toBe(false);
    popOut!.click();
    await fixture.whenStable();

    expect(calls).toEqual(["/view-cipher/github"]);
  });

  it("toggles concealed password visibility", async () => {
    const { fixture } = await createFixture();
    fixture.componentRef.setInput("id", "github");
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const passwordInput = () => host.querySelector<HTMLInputElement>("#password");

    expect(passwordInput()?.type).toBe("password");

    host.querySelector<HTMLButtonElement>('[data-testid="toggle-password"]')!.click();
    fixture.detectChanges();

    expect(passwordInput()?.type).toBe("text");
    expect(host.querySelector('[data-testid="toggle-password"]')?.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows a local confirmation check after a detail field is copied", async () => {
    const { fixture } = await createFixture();
    fixture.componentRef.setInput("id", "github");
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const copyFeedback = TestBed.inject(LocalCopyFeedbackService);
    copyFeedback.start();

    host.querySelector<HTMLButtonElement>('[aria-label="复制用户名"]')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host.querySelector('[aria-label="已复制"] .bwi-check')).not.toBeNull();
    copyFeedback.destroy();
  });

  it("does not reveal or copy a reprompt-protected password before verification", async () => {
    const copyField = vi.fn(async () => "Copied");
    const protectedItem = { ...demoVaultItems[0], reprompt: true };
    const { fixture } = await createFixture({ copyField }, undefined, [protectedItem]);
    fixture.componentRef.setInput("id", protectedItem.id);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const passwordInput = host.querySelector<HTMLInputElement>("#password")!;
    host.querySelector<HTMLButtonElement>('[data-testid="toggle-password"]')!.click();
    fixture.detectChanges();

    expect(passwordInput.type).toBe("password");
    expect(host.querySelector("bw-vault-reprompt-dialog dialog[open]")).not.toBeNull();

    host.querySelector<HTMLDialogElement>("bw-vault-reprompt-dialog dialog")!
      .dispatchEvent(new Event("cancel", { cancelable: true }));
    host.querySelector<HTMLButtonElement>('[aria-label="复制密码"]')!.click();
    fixture.detectChanges();

    expect(copyField).not.toHaveBeenCalled();
    expect(host.querySelector("bw-vault-reprompt-dialog dialog[open]")).not.toBeNull();
  });

  it("runs one protected password action after successful verification", async () => {
    const copyField = vi.fn(async () => "Copied");
    const protectedItem = { ...demoVaultItems[0], reprompt: true };
    const { fixture, repromptVerify } = await createFixture({ copyField }, undefined, [protectedItem]);
    fixture.componentRef.setInput("id", protectedItem.id);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const copyFeedback = TestBed.inject(LocalCopyFeedbackService);
    copyFeedback.start();
    const copyButton = host.querySelector<HTMLButtonElement>('[aria-label="复制密码"]')!;
    copyButton.click();
    fixture.detectChanges();
    submitReprompt(host, "verified-master-password");
    await fixture.whenStable();
    fixture.detectChanges();

    expect(repromptVerify).toHaveBeenCalledWith("verified-master-password", expect.any(Number));
    expect(copyField).toHaveBeenCalledOnce();
    expect(copyField).toHaveBeenCalledWith(protectedItem.fields.find((field) => field.id === "password"));
    expect(copyButton.getAttribute("aria-label")).toBe("已复制");
    expect(copyButton.querySelector(".bwi-check")).not.toBeNull();
    expect(host.querySelector("bw-vault-reprompt-dialog dialog[open]")).toBeNull();
    expect(host.querySelector<HTMLInputElement>("bw-vault-reprompt-dialog input")?.value).toBe("");
    copyFeedback.destroy();
  });

  it("guards protected TOTP and hidden-field copy and fill actions", async () => {
    const copyField = vi.fn(async () => "Copied");
    const fillField = vi.fn(async () => "Filled");
    const protectedItem = {
      ...demoVaultItems[0],
      reprompt: true,
      fields: [
        ...demoVaultItems[0].fields,
        { id: "custom:pin", label: "PIN", value: "1234", type: "hidden" as const, concealed: true },
      ],
    };
    const { fixture } = await createFixture({ copyField, fillField }, undefined, [protectedItem]);
    fixture.componentRef.setInput("id", protectedItem.id);
    fixture.detectChanges();
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    await Promise.resolve();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    for (const label of ["复制验证码", "填入验证码字段", "复制 PIN", "填入PIN字段"]) {
      host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click();
      fixture.detectChanges();
      expect(host.querySelector("bw-vault-reprompt-dialog dialog[open]")).not.toBeNull();
      host.querySelector<HTMLDialogElement>("bw-vault-reprompt-dialog dialog")!
        .dispatchEvent(new Event("cancel", { cancelable: true }));
    }

    expect(copyField).not.toHaveBeenCalled();
    expect(fillField).not.toHaveBeenCalled();
  });

  it("cancels a protected continuation when the detail route identity changes", async () => {
    const copyField = vi.fn(async () => "Copied");
    const firstItem = { ...demoVaultItems[0], reprompt: true };
    const secondItem = {
      ...demoVaultItems[0],
      id: "second-login",
      name: "Second Login",
      fields: demoVaultItems[0].fields.map((field) =>
        field.id === "password" ? { ...field, value: "different-password" } : field,
      ),
      reprompt: true,
    };
    const { fixture } = await createFixture({ copyField }, undefined, [firstItem, secondItem]);
    fixture.componentRef.setInput("id", firstItem.id);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLButtonElement>('[aria-label="复制密码"]')!.click();
    fixture.detectChanges();

    fixture.componentRef.setInput("id", secondItem.id);
    fixture.detectChanges();

    expect(host.querySelector("bw-vault-reprompt-dialog dialog[open]")).toBeNull();
    expect(copyField).not.toHaveBeenCalled();
  });

  it("replaces the stored TOTP seed with the generated code for copy and fill", async () => {
    const copyField = vi.fn(async () => "Copied");
    const fillField = vi.fn(async () => "Filled");
    const seed = "JBSWY3DPEHPK3PXP";
    const itemWithTotp = {
      ...demoVaultItems[0],
      fields: demoVaultItems[0].fields.map((field) =>
        field.id === "otp" ? { ...field, value: seed } : field,
      ),
    };
    const { fixture } = await createFixture({ copyField, fillField }, undefined, [itemWithTotp]);
    fixture.componentRef.setInput("id", "github");
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(host.querySelector<HTMLInputElement>("[data-testid=login-totp]")?.value)
        .toMatch(/^\d{3} \d{3}$/);
    });
    expect(host.querySelector("bw-vault-detail-field #totp")).toBeNull();
    expect(host.textContent).not.toContain(seed);

    host.querySelector<HTMLButtonElement>('[aria-label="复制验证码"]')!.click();
    host.querySelector<HTMLButtonElement>('[aria-label="填入验证码字段"]')!.click();
    await fixture.whenStable();

    const sourceField = itemWithTotp.fields.find((field) => field.id === "otp");
    expect(copyField).toHaveBeenCalledWith(sourceField);
    expect(fillField).toHaveBeenCalledWith(sourceField);
  });

  it("resets password reveal state when the item id changes", async () => {
    const { fixture } = await createFixture();
    fixture.componentRef.setInput("id", "github");
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const passwordInput = () => host.querySelector<HTMLInputElement>("#password");

    host.querySelector<HTMLButtonElement>('[data-testid="toggle-password"]')!.click();
    fixture.detectChanges();

    expect(passwordInput()?.type).toBe("text");

    fixture.componentRef.setInput("id", "identity");
    fixture.detectChanges();

    expect(passwordInput()).toBeNull();

    fixture.componentRef.setInput("id", "github");
    fixture.detectChanges();

    expect(passwordInput()?.type).toBe("password");
  });

  it("launches URI controls through the action service", async () => {
    const launchUri = vi.fn(async () => "Opened URL");
    const launchItem = vi.fn(async () => "unexpected");
    const { fixture } = await createFixture({ launchUri, launchItem });
    fixture.componentRef.setInput("id", "github");
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const uriInput = host.querySelector<HTMLInputElement>('[data-testid="login-website"]')!;
    const launchButton = uriInput
      .closest("bit-form-field")!
      .querySelector<HTMLButtonElement>('[data-testid="launch-website"]')!;
    expect(launchButton.disabled).toBe(false);
    launchButton.click();
    await fixture.whenStable();

    expect(launchUri).toHaveBeenCalledWith("https://github.com");
    expect(launchItem).not.toHaveBeenCalled();
  });

  it("copies the exact official URI and notes values but rejects forged synthetic fields", async () => {
    const copyField = vi.fn(async () => "Copied");
    const login = { ...demoVaultItems[0], notes: "Primary engineering account." };
    const { fixture } = await createFixture({ copyField }, undefined, [login]);
    fixture.componentRef.setInput("id", "github");
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLButtonElement>('[data-testid="copy-website"]')!.click();
    host.querySelector<HTMLButtonElement>('[aria-label="复制备注"]')!.click();
    await fixture.whenStable();

    expect(copyField).toHaveBeenCalledWith({
      id: "uri:0",
      label: "网站",
      value: "https://github.com",
    });
    expect(copyField).toHaveBeenCalledWith({
      id: "notes",
      label: "备注",
      value: "Primary engineering account.",
    });

    copyField.mockClear();
    await fixture.componentInstance.copy({ id: "uri:0", label: "网站", value: "https://evil.test" });
    await fixture.componentInstance.copy({ id: "notes", label: "备注", value: "forged" });
    expect(copyField).not.toHaveBeenCalled();
  });

  it.each([
    ["card", "查看支付卡", "Visa 详细信息", ["Travel Ops", "04 / 2029"], "登录凭据"],
    ["identity", "查看身份", "个人详细信息", ["Example Person", "me@example.com", "+1 555 0100"], "登录凭据"],
    ["note", "查看笔记", "附加选项", ["plain"], "登录凭据"],
  ])(
    "renders typed detail sections for %s items",
    async (itemId, title, sectionTitle, expectedTexts, unexpectedText) => {
      const { fixture } = await createFixture();
      fixture.componentRef.setInput("id", itemId);
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector("popup-page popup-header h1")?.textContent).toContain(title);
      expect(host.textContent).toContain(sectionTitle);
      const inputValues = [...host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input[readonly], textarea[readonly]")]
        .map((control) => control.value)
        .join("\n");
      for (const text of expectedTexts) {
        expect(inputValues).toContain(text);
      }
      expect(host.textContent).not.toContain(unexpectedText);
    },
  );

  it("renders Card detail with the pinned official readonly hierarchy", async () => {
    await new OfficialI18nService().setLocale("zh-CN");
    const cardItem = {
      ...demoVaultItems.find((item) => item.id === "card")!,
      notes: "Use for travel",
      reprompt: true,
      card: {
        cardholderName: "Travel Ops",
        brand: "Visa",
        number: "4111111111111111",
        expMonth: "04",
        expYear: "2029",
        code: "123",
      },
      fields: [
        ...demoVaultItems.find((item) => item.id === "card")!.fields,
        { id: "custom:Region", label: "Region", value: "APAC", type: "text" as const },
      ],
    };
    const { fixture } = await createFixture(undefined, undefined, [cardItem]);
    fixture.componentRef.setInput("id", cardItem.id);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector("bw-vault-detail-section")).toBeNull();
    expect(
      [...host.querySelectorAll("bit-section-header h2")].map((node) => node.textContent?.trim()),
    ).toEqual(["Visa 详细信息", "附加选项", "自定义字段", "项目历史记录"]);
    expect(host.querySelector<HTMLInputElement>("#cardholderName")?.value).toBe("Travel Ops");
    expect(host.querySelector<HTMLInputElement>("#cardNumber")?.type).toBe("password");
    expect(host.querySelector<HTMLInputElement>("#expiration")?.value).toBe("04 / 2029");
    expect(host.querySelector<HTMLInputElement>("#securityCode")?.type).toBe("password");
    expect(fixture.componentInstance.cardholderNameField?.label).toBe("持卡人姓名");
    expect(fixture.componentInstance.cardNumberField?.label).toBe("卡号");
    expect(fixture.componentInstance.cardCodeField?.label).toBe("安全码");
    expect(fixture.componentInstance.cardExpiryField?.label).toBe("到期时间");
    expect(host.querySelector('[aria-label="显示卡号"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="复制卡号"]')).not.toBeNull();
  });

  it("routes protected Card number and code actions through reprompt and rejects forged fields", async () => {
    const copyField = vi.fn(async () => "Copied");
    const fillField = vi.fn(async () => "Filled");
    const cardItem = {
      ...demoVaultItems.find((item) => item.id === "card")!,
      reprompt: true,
      canFill: true,
      card: {
        cardholderName: "Travel Ops",
        brand: "Visa",
        number: "4111111111111111",
        expMonth: "04",
        expYear: "2029",
        code: "123",
      },
      fields: [
        { id: "number", label: "Number", value: "4111111111111111", concealed: true, type: "hidden" as const },
        { id: "code", label: "Security code", value: "123", concealed: true, type: "hidden" as const },
      ],
    };
    const { fixture, repromptVerify } = await createFixture({ copyField, fillField }, undefined, [cardItem]);
    fixture.componentRef.setInput("id", cardItem.id);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLButtonElement>('[data-testid="copy-number"]')!.click();
    fixture.detectChanges();
    expect(copyField).not.toHaveBeenCalled();
    expect(host.querySelector("bw-vault-reprompt-dialog dialog[open]")).not.toBeNull();

    submitReprompt(host, "verified-master-password");
    await fixture.whenStable();
    fixture.detectChanges();

    expect(repromptVerify).toHaveBeenCalledWith("verified-master-password", expect.any(Number));
    expect(copyField).toHaveBeenCalledWith(cardItem.fields[0]);

    host.querySelector<HTMLButtonElement>('[data-testid="toggle-code"]')!.click();
    fixture.detectChanges();
    expect(host.querySelector<HTMLInputElement>("#securityCode")?.type).toBe("password");
    host.querySelector<HTMLDialogElement>("bw-vault-reprompt-dialog dialog")!
      .dispatchEvent(new Event("cancel", { cancelable: true }));

    await fixture.componentInstance.copy({
      id: "number",
      label: "Number",
      value: "4111111111111111",
      concealed: true,
      type: "hidden",
    });
    await fixture.componentInstance.fill({
      id: "code",
      label: "Security code",
      value: "123",
      concealed: true,
      type: "hidden",
    });
    expect(copyField).toHaveBeenCalledTimes(1);
    expect(fillField).not.toHaveBeenCalled();
  });

  it("clears Card reveal authorization when sync replaces the same item id", async () => {
    const cardItem = {
      ...demoVaultItems.find((item) => item.id === "card")!,
      reprompt: true,
      card: {
        cardholderName: "Travel Ops",
        brand: "Visa",
        number: "4111111111111111",
        expMonth: "04",
        expYear: "2029",
        code: "123",
      },
      fields: [
        { id: "number", label: "Number", value: "4111111111111111", concealed: true, type: "hidden" as const },
        { id: "code", label: "Security code", value: "123", concealed: true, type: "hidden" as const },
      ],
    };
    const { fixture, store } = await createFixture(undefined, undefined, [cardItem]);
    fixture.componentRef.setInput("id", cardItem.id);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLButtonElement>('[data-testid="toggle-number"]')!.click();
    fixture.detectChanges();
    submitReprompt(host, "verified-master-password");
    await fixture.whenStable();
    fixture.detectChanges();
    expect(host.querySelector<HTMLInputElement>("#cardNumber")?.type).toBe("text");

    const refreshedCard = {
      ...cardItem,
      card: { ...cardItem.card, number: "5555555555554444", code: "987" },
      fields: [
        { id: "number", label: "Number", value: "5555555555554444", concealed: true, type: "hidden" as const },
        { id: "code", label: "Security code", value: "987", concealed: true, type: "hidden" as const },
      ],
    };
    store.setItems([refreshedCard]);
    expect(fixture.componentInstance.item).toBe(refreshedCard);
    expect(fixture.componentInstance.revealedFields.has("number")).toBe(false);
    fixture.detectChanges();

    expect(host.querySelector<HTMLInputElement>("#cardNumber")?.value).toBe("5555 5555 5555 4444");
    expect(host.querySelector<HTMLInputElement>("#cardNumber")?.type).toBe("password");
    expect(host.querySelector<HTMLInputElement>("#securityCode")?.type).toBe("password");
  });

  it("renders complete Identity detail through the pinned official readonly hierarchy", async () => {
    const identityItem = {
      ...demoVaultItems.find((item) => item.id === "identity")!,
      notes: "Identity note",
      reprompt: true,
      identity: {
        title: "Dr",
        firstName: "Ada",
        middleName: "Augusta",
        lastName: "Lovelace",
        username: "ada",
        company: "Analytical Engines",
        ssn: "000-00-0000",
        passportNumber: "P1234567",
        licenseNumber: "L7654321",
        email: "ada@example.test",
        phone: "+44 20 0000",
        address1: "12 Engine Lane",
        address2: "Suite 2",
        address3: "Research Park",
        city: "London",
        state: "Greater London",
        postalCode: "N1 1AA",
        country: "United Kingdom",
      },
      fields: [
        { id: "ssn", label: "Social security number", value: "000-00-0000", concealed: true, type: "hidden" as const },
        { id: "passport-number", label: "Passport number", value: "P1234567", concealed: true, type: "hidden" as const },
        { id: "license-number", label: "License number", value: "L7654321" },
        { id: "company", label: "Company", value: "Analytical Engines" },
        { id: "email", label: "Email", value: "ada@example.test" },
        { id: "phone", label: "Phone", value: "+44 20 0000" },
        { id: "custom:Region", label: "Region", value: "EU", type: "text" as const },
      ],
    };
    const { fixture } = await createFixture(undefined, undefined, [identityItem]);
    fixture.componentRef.setInput("id", identityItem.id);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector("bw-vault-detail-section")).toBeNull();
    expect(
      [...host.querySelectorAll("bit-section-header h2")].map((node) => node.textContent?.trim()),
    ).toEqual([
      "个人详细信息",
      "身份",
      "联系信息",
      "附加选项",
      "自定义字段",
      "项目历史记录",
    ]);
    expect(host.querySelector<HTMLInputElement>("#fullName")?.value).toBe(
      "Dr Ada Augusta Lovelace",
    );
    expect(host.querySelector<HTMLInputElement>("#ssn")?.type).toBe("password");
    expect(host.querySelector<HTMLInputElement>("#passportNumber")?.type).toBe("password");
    expect(host.querySelector<HTMLTextAreaElement>("#address")?.value).toContain(
      "12 Engine Lane\nSuite 2\nResearch Park\nLondon, Greater London, N1 1AA\nUnited Kingdom",
    );
    expect(host.querySelector('[aria-label="显示社会安全号码"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="复制护照号码"]')).not.toBeNull();
    expect(host.querySelector<HTMLInputElement>("#company")?.value).toBe(
      "Analytical Engines",
    );
    expect(
      [...host.querySelectorAll<HTMLTextAreaElement>("textarea[readonly]")].map(
        (textarea) => textarea.value,
      ),
    ).toContain("Identity note");
  });

  it("guards protected Identity SSN and passport copy, reveal, and fill through reprompt", async () => {
    const copyField = vi.fn(async () => "Copied");
    const fillField = vi.fn(async () => "Filled");
    const identityItem = {
      ...demoVaultItems.find((item) => item.id === "identity")!,
      reprompt: true,
      canFill: true,
      identity: {
        title: "Dr",
        firstName: "Ada",
        middleName: "Augusta",
        lastName: "Lovelace",
        username: "ada",
        company: "Analytical Engines",
        ssn: "000-00-0000",
        passportNumber: "P1234567",
        licenseNumber: "L7654321",
        email: "ada@example.test",
        phone: "+44 20 0000",
        address1: "12 Engine Lane",
        address2: "Suite 2",
        address3: "Research Park",
        city: "London",
        state: "Greater London",
        postalCode: "N1 1AA",
        country: "United Kingdom",
      },
      fields: [
        { id: "ssn", label: "Social security number", value: "000-00-0000", concealed: true, type: "hidden" as const },
        { id: "passport-number", label: "Passport number", value: "P1234567", concealed: true, type: "hidden" as const },
      ],
    };
    const { fixture } = await createFixture({ copyField, fillField }, undefined, [identityItem]);
    fixture.componentRef.setInput("id", identityItem.id);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLButtonElement>('[data-testid="ssn-toggle"]')!.click();
    fixture.detectChanges();
    expect(host.querySelector<HTMLInputElement>("#ssn")?.type).toBe("password");
    expect(host.querySelector("bw-vault-reprompt-dialog dialog[open]")).not.toBeNull();
    host.querySelector<HTMLDialogElement>("bw-vault-reprompt-dialog dialog")!
      .dispatchEvent(new Event("cancel", { cancelable: true }));

    host.querySelector<HTMLButtonElement>('[data-testid="copy-passport"]')!.click();
    fixture.detectChanges();
    expect(copyField).not.toHaveBeenCalled();
    expect(host.querySelector("bw-vault-reprompt-dialog dialog[open]")).not.toBeNull();
    submitReprompt(host, "verified-master-password");
    await fixture.whenStable();
    fixture.detectChanges();
    expect(copyField).toHaveBeenCalledWith(identityItem.fields[1]);

    host.querySelector<HTMLButtonElement>('[data-testid="fill-ssn"]')!.click();
    fixture.detectChanges();
    submitReprompt(host, "verified-master-password");
    await fixture.whenStable();
    expect(fillField).toHaveBeenCalledWith(identityItem.fields[0]);
  });

  it("renders Card and Identity linked fields with official labels", async () => {
    const cardItem = {
      ...demoVaultItems.find((item) => item.id === "card")!,
      card: {
        cardholderName: "Travel Ops",
        brand: "Visa",
        number: "4111111111111111",
        expMonth: "04",
        expYear: "2029",
        code: "123",
      },
      fields: [{ id: "custom:Number alias", label: "Number alias", value: "", type: "linked" as const, linkedId: 305 }],
    };
    const identityItem = {
      ...demoVaultItems.find((item) => item.id === "identity")!,
      identity: {
        title: "",
        firstName: "Ada",
        middleName: "",
        lastName: "Lovelace",
        username: "",
        company: "",
        ssn: "",
        passportNumber: "",
        licenseNumber: "",
        email: "ada@example.test",
        phone: "",
        address1: "",
        address2: "",
        address3: "",
        city: "",
        state: "",
        postalCode: "",
        country: "",
      },
      fields: [{ id: "custom:Email alias", label: "Email alias", value: "", type: "linked" as const, linkedId: 410 }],
    };
    const { fixture } = await createFixture(undefined, undefined, [cardItem, identityItem]);

    fixture.componentRef.setInput("id", cardItem.id);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain("链接型: Number alias");
    expect((fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('official-custom-fields input[readonly]')?.value)
      .toBe("号码");

    fixture.componentRef.setInput("id", identityItem.id);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain("链接型: Email alias");
    expect((fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('official-custom-fields input[readonly]')?.value)
      .toBe("电子邮箱");
  });

  it("renders Secure Note detail through direct official readonly primitives", async () => {
    const noteItem = {
      ...demoVaultItems.find((item) => item.id === "note")!,
      notes: "Private recovery instructions",
      reprompt: true,
      secureNote: { type: 0 },
      fields: [
        { id: "custom:Region", label: "Region", value: "EU", type: "text" as const },
        { id: "notes", label: "Notes", value: "Private recovery instructions" },
      ],
    };
    const { fixture } = await createFixture(undefined, undefined, [noteItem]);
    fixture.componentRef.setInput("id", noteItem.id);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector("bw-vault-detail-section")).toBeNull();
    expect(
      [...host.querySelectorAll("bit-section-header h2")].map((node) => node.textContent?.trim()),
    ).toEqual(["附加选项", "自定义字段", "项目历史记录"]);
    expect(host.querySelector<HTMLTextAreaElement>("#notes")?.value).toBe(
      "Private recovery instructions",
    );
    expect(host.querySelector('[aria-label="复制备注"]')).not.toBeNull();
    expect(host.querySelector('bit-card [data-testid="item-name"]')).not.toBeNull();
  });

  it("renders Secure Note notes as copy-only shared additional options and blocks browser selection copy", async () => {
    const copyField = vi.fn(async () => "Copied");
    const noteItem = {
      ...demoVaultItems.find((item) => item.id === "note")!,
      notes: "Private recovery instructions",
      secureNote: { type: 0 },
      fields: [{ id: "custom:Region", label: "Region", value: "EU", type: "text" as const }],
    };
    const { fixture } = await createFixture({ copyField }, undefined, [noteItem]);
    fixture.componentRef.setInput("id", noteItem.id);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector("bw-official-personal-cipher-detail")).not.toBeNull();
    expect(host.querySelector("official-card-details")).toBeNull();
    expect(host.querySelector("official-identity-sections")).toBeNull();
    expect(host.querySelector<HTMLButtonElement>('[aria-label="填入备注字段"]')).toBeNull();
    host.querySelector<HTMLButtonElement>('[aria-label="复制备注"]')!.click();
    await fixture.whenStable();
    expect(copyField).toHaveBeenCalledWith({
      id: "notes",
      label: "备注",
      value: "Private recovery instructions",
    });

    const copy = new Event("copy", { bubbles: true, cancelable: true });
    host.querySelector<HTMLTextAreaElement>("#notes")!.dispatchEvent(copy);
    expect(copy.defaultPrevented).toBe(true);
  });

  it("does not render a directly addressed SSH item", async () => {
    const { fixture, store } = await createFixture();
    fixture.componentRef.setInput("id", "ssh");
    fixture.detectChanges();

    expect(store.snapshot().items.some((item) => item.id === "ssh")).toBe(true);
    expect(fixture.nativeElement.textContent).not.toContain("ssh-rsa AAA");
    expect(fixture.nativeElement.textContent).not.toContain("SHA256:demo");
  });

  it("shows the official history link only when password history exists", async () => {
    const itemWithHistory = {
      ...demoVaultItems[0],
      passwordHistory: [{ password: "old-password", lastUsedDate: "2026-07-01T00:00:00.000Z" }],
    };
    const { fixture } = await createFixture(undefined, undefined, [itemWithHistory]);
    fixture.componentRef.setInput("id", "github");
    fixture.detectChanges();

    const link = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      "app-item-history-v2 button",
    );
    expect(link?.textContent).toContain("密码历史记录");
  });

  it("confirms and archives the selected item from the detail footer", async () => {
    const { actions, fixture, navigateByUrl, store } = await createFixture();
    fixture.componentRef.setInput("id", "github");
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const archiveButton = host.querySelector<HTMLButtonElement>('[aria-label="归档"]')!;
    expect(archiveButton.disabled).toBe(false);

    archiveButton.click();
    fixture.detectChanges();

    expect(host.textContent).toContain("要归档 GitHub 吗？");
    host.querySelector<HTMLButtonElement>('[aria-label="确认归档"]')!.click();
    await fixture.whenStable();

    expect(actions.archiveItemWithOutcome).toHaveBeenCalledWith(demoVaultItems[0], expect.any(Function));
    expect(store.snapshot().statusMessage).toBe("Archived item");
    expect(navigateByUrl).toHaveBeenCalledWith("/tabs/vault");
  });

  it("does not archive a reprompt-protected item before verification", async () => {
    const protectedItem = { ...demoVaultItems[0], reprompt: true };
    const { actions, fixture, navigateByUrl } = await createFixture(undefined, undefined, [protectedItem]);
    fixture.componentRef.setInput("id", protectedItem.id);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLButtonElement>('[aria-label="归档"]')!.click();
    fixture.detectChanges();
    host.querySelector<HTMLButtonElement>('[aria-label="确认归档"]')!.click();
    fixture.detectChanges();

    expect(actions.archiveItemWithOutcome).not.toHaveBeenCalled();
    expect(navigateByUrl).not.toHaveBeenCalledWith("/tabs/vault");
    expect(host.querySelector("bw-vault-reprompt-dialog dialog[open]")).not.toBeNull();
  });

  it("confirms and deletes the selected item from the detail footer", async () => {
    const { actions, fixture, navigateByUrl, store } = await createFixture();
    fixture.componentRef.setInput("id", "github");
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const deleteButton = host.querySelector<HTMLButtonElement>('[aria-label="删除"]')!;
    expect(deleteButton.disabled).toBe(false);

    deleteButton.click();
    fixture.detectChanges();

    expect(host.textContent).toContain("要删除 GitHub 吗？");
    expect(host.querySelector(".app-bottom-sheet[open]")).not.toBeNull();
    host.querySelector<HTMLButtonElement>('[aria-label="确认删除"]')!.click();
    await fixture.whenStable();

    expect(actions.deleteItemWithOutcome).toHaveBeenCalledWith(demoVaultItems[0], expect.any(Function));
    expect(store.snapshot().statusMessage).toBe("Moved item to trash");
    expect(navigateByUrl).toHaveBeenCalledWith("/tabs/vault");
  });

  it("restores the invoking destructive action exactly once when Cancel dismisses its sheet", async () => {
    const { fixture } = await createFixture();
    fixture.componentRef.setInput("id", "github");
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const deleteButton = host.querySelector<HTMLButtonElement>('[aria-label="删除"]')!;
    deleteButton.focus();
    deleteButton.click();
    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();

    let focusEvents = 0;
    deleteButton.addEventListener("focus", () => focusEvents++);
    const sheet = host.querySelector<HTMLDialogElement>(
      '[data-testid="vault-detail-confirmation"]',
    )!;
    const cancelButton = [...sheet.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "取消")!;
    cancelButton.click();
    dispatchSheetTransitionEnd(sheet);
    await fixture.whenStable();

    expect(focusEvents).toBe(1);
    expect(sheet.open).toBe(false);
    expect(fixture.componentInstance.pendingAction).toBe("");
  });

  it("restores the invoking destructive action exactly once when Escape dismisses its sheet", async () => {
    const { fixture } = await createFixture();
    fixture.componentRef.setInput("id", "github");
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const deleteButton = host.querySelector<HTMLButtonElement>('[aria-label="删除"]')!;
    deleteButton.focus();
    deleteButton.click();
    fixture.detectChanges();
    await fixture.whenStable();
    await Promise.resolve();

    let focusEvents = 0;
    deleteButton.addEventListener("focus", () => focusEvents++);
    const sheet = host.querySelector<HTMLDialogElement>(
      '[data-testid="vault-detail-confirmation"]',
    )!;
    sheet.dispatchEvent(new Event("cancel", { cancelable: true }));
    dispatchSheetTransitionEnd(sheet);
    await fixture.whenStable();

    expect(focusEvents).toBe(1);
    expect(sheet.open).toBe(false);
    expect(fixture.componentInstance.pendingAction).toBe("");
  });

  it("moves the selected item to the local archive list through the real action service", async () => {
    const store = new PopupStateStore();
    store.setUnlocked("account-a@example.test");
    store.setActiveSession({} as never);
    store.setItems([demoVaultItems[0]]);
    const cipherActions = {
      updateCipherPartial: vi.fn(async () => undefined),
      softDeleteCipher: vi.fn(async () => undefined),
      archiveCipher: vi.fn(async () => undefined),
      unarchiveCipher: vi.fn(async () => undefined),
      restoreCipher: vi.fn(async () => undefined),
      deleteCipher: vi.fn(async () => undefined),
    };

    await TestBed.configureTestingModule({
      imports: [VaultItemDetailPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        VaultFacade,
        VaultActionsService,
        { provide: VAULT_CIPHER_ACTION_PORT, useValue: cipherActions },
      ],
    }).compileComponents();

    const router = TestBed.inject(Router);
    vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);
    const fixture = TestBed.createComponent(VaultItemDetailPageComponent);
    fixture.componentRef.setInput("id", "github");
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLButtonElement>('[aria-label="归档"]')!.click();
    fixture.detectChanges();
    host.querySelector<HTMLButtonElement>('[aria-label="确认归档"]')!.click();
    await fixture.whenStable();

    expect(store.snapshot().items).toEqual([]);
    expect(store.snapshot().archivedItems.map((item) => item.id)).toEqual(["github"]);
    expect(cipherActions.archiveCipher).toHaveBeenCalledOnce();
  });

  it("renders and unarchives an archived item through the official detail footer", async () => {
    const archivedItem = { ...demoVaultItems[0], id: "archived", name: "Archived login" };
    const { actions, fixture, navigateByUrl, store } = await createFixture(
      undefined,
      undefined,
      [],
      [archivedItem],
    );
    fixture.componentRef.setInput("id", archivedItem.id);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain("Archived login");
    expect(host.querySelector("[bit-chip-action]")?.textContent).toContain("已归档");
    expect(host.querySelector('[aria-label="归档"]')).toBeNull();
    expect(host.querySelector('[aria-label="取消归档"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="填入用户名字段"]')).toBeNull();

    host.querySelector<HTMLButtonElement>('[aria-label="取消归档"]')!.click();
    await fixture.whenStable();

    expect(actions.unarchiveItemWithOutcome).toHaveBeenCalledWith(archivedItem, expect.any(Function));
    expect(store.snapshot().statusMessage).toBe("Item unarchived");
    await fixture.componentInstance.backToVault();
    expect(navigateByUrl).toHaveBeenCalledWith("/archive");
  });

  it("confirms deletion of an archived item and returns to Archive", async () => {
    const archivedItem = { ...demoVaultItems[0], id: "archived", name: "Archived login" };
    const { actions, fixture, navigateByUrl } = await createFixture(
      undefined,
      undefined,
      [],
      [archivedItem],
    );
    fixture.componentRef.setInput("id", archivedItem.id);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    host.querySelector<HTMLButtonElement>('[aria-label="删除"]')!.click();
    fixture.detectChanges();
    expect(host.textContent).toContain("要删除 Archived login 吗？");
    host.querySelector<HTMLButtonElement>('[aria-label="确认删除"]')!.click();
    await fixture.whenStable();

    expect(actions.deleteArchivedItemWithOutcome).toHaveBeenCalledWith(archivedItem, expect.any(Function));
    expect(navigateByUrl).toHaveBeenCalledWith("/archive");
  });

  it("renders and restores a deleted item through the official detail footer", async () => {
    const deletedItem = { ...demoVaultItems[0], id: "deleted", name: "Deleted login" };
    const { actions, fixture, navigateByUrl, store } = await createFixture(
      undefined,
      undefined,
      [],
      [],
      [deletedItem],
    );
    fixture.componentRef.setInput("id", deletedItem.id);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain("Deleted login");
    expect(host.querySelector('a[href="/edit-cipher"]')).toBeNull();
    expect(host.querySelector('[aria-label="恢复"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="永久删除"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="填入用户名字段"]')).toBeNull();

    host.querySelector<HTMLButtonElement>('[aria-label="恢复"]')!.click();
    await fixture.whenStable();

    expect(actions.restoreDeletedItemWithOutcome).toHaveBeenCalledWith(deletedItem, expect.any(Function));
    expect(store.snapshot().statusMessage).toBe("Item restored");
    expect(navigateByUrl).toHaveBeenCalledWith("/trash");
  });

  it("requires confirmation before permanently deleting a detail item", async () => {
    const deletedItem = { ...demoVaultItems[0], id: "deleted", name: "Deleted login" };
    const { actions, fixture, navigateByUrl } = await createFixture(
      undefined,
      undefined,
      [],
      [],
      [deletedItem],
    );
    fixture.componentRef.setInput("id", deletedItem.id);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    host.querySelector<HTMLButtonElement>('[aria-label="永久删除"]')!.click();
    fixture.detectChanges();
    expect(host.textContent).toContain("要永久删除 Deleted login 吗？");
    expect(actions.permanentlyDeleteItemWithOutcome).not.toHaveBeenCalled();
    host.querySelector<HTMLButtonElement>('[aria-label="确认永久删除"]')!.click();
    await fixture.whenStable();

    expect(actions.permanentlyDeleteItemWithOutcome).toHaveBeenCalledWith(deletedItem, expect.any(Function));
    expect(navigateByUrl).toHaveBeenCalledWith("/trash");
  });
});

function submitReprompt(host: HTMLElement, password: string): void {
  const input = host.querySelector<HTMLInputElement>("bw-vault-reprompt-dialog input")!;
  input.value = password;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  host.querySelector<HTMLFormElement>("bw-vault-reprompt-dialog form")!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

function dispatchSheetTransitionEnd(sheet: HTMLDialogElement): void {
  const event = new Event("transitionend");
  Object.defineProperty(event, "propertyName", { value: "transform" });
  sheet.dispatchEvent(event);
}

function removalOutcome(
  item: (typeof demoVaultItems)[number],
  status: string,
): VaultRemovalMutationOutcome {
  return { committed: true, status, result: { kind: "removed", item } };
}
