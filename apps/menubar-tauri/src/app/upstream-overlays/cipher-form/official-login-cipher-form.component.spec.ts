import "zone.js";
import "@angular/compiler";

import { LiveAnnouncer } from "@angular/cdk/a11y";
import { Dialog as CdkDialog } from "@angular/cdk/dialog";
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { provideNoopAnimations } from "@angular/platform-browser/animations";
import {
  Component,
  importProvidersFrom,
  NgZone,
  provideZoneChangeDetection,
} from "@angular/core";
import { ComponentFixtureAutoDetect, TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { provideRouter } from "@angular/router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { UriMatchStrategy } from "@bitwarden/common/models/domain/domain-service";
import { CipherType, FieldType } from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FolderView } from "@bitwarden/common/vault/models/view/folder.view";
import { DialogService } from "@bitwarden/components/dialog/dialog.service";
import { DialogModule } from "@bitwarden/components/dialog/dialog.module";

import { GeneratorService } from "../../generator/generator.service";
import {
  GENERATOR_OPERATION_RECEIPT,
  type GeneratorOperationReceiptPort,
} from "../../generator/generator-runtime.port";
import { OfficialI18nService } from "../../official-ui/official-i18n.service";
import { PopupStateStore } from "../../popup-state";
import {
  RETAINED_LOGIN_FORM_GENERATOR,
  RETAINED_LOGIN_FORM_STATUS_STORE,
  buildOfficialLoginFormConfig,
  type RetainedOfficialCipherFormConfig,
} from "../../vault/retained-login-form.adapter";
import { OfficialAutofillOptionsComponent } from "./official-autofill-options.component";
import { OfficialCustomFieldsComponent } from "./official-custom-fields.component";
import { OfficialLoginCipherFormComponent } from "./official-login-cipher-form.component";
import { OfficialLoginDetailsComponent } from "./official-login-details.component";
import { OfficialUriOptionComponent } from "./official-uri-option.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (
    !(error instanceof Error) ||
    !error.message.includes("Cannot set base providers")
  ) {
    throw error;
  }
}

class RecordingLiveAnnouncer {
  readonly announcements: {
    readonly message: string;
    readonly politeness?: string;
  }[] = [];

  announce(message: string, politeness?: string): Promise<void> {
    this.announcements.push({ message, politeness });
    return Promise.resolve();
  }
}

@Component({
  imports: [OfficialLoginCipherFormComponent],
  template: `
    <bw-official-login-cipher-form
      [formId]="formId"
      [config]="config"
    ></bw-official-login-cipher-form>
  `,
})
class OfficialLoginFormHostComponent {
  readonly formId = nextHostFormId;
  readonly config = nextHostConfig;
}

let nextHostFormId = "login-form";
let nextHostConfig: RetainedOfficialCipherFormConfig;

describe("OfficialLoginCipherFormComponent", () => {
  let announcer: RecordingLiveAnnouncer;
  let generator: { generate: ReturnType<typeof vi.fn> };
  let completeReceipt: ReturnType<typeof vi.fn>;
  let operationReceipt: GeneratorOperationReceiptPort;

  beforeEach(async () => {
    announcer = new RecordingLiveAnnouncer();
    generator = {
      generate: vi.fn(async (mode: string) => ({
        credential: mode === "password" ? "generated-password" : "generated-username",
      })),
    };
    completeReceipt = vi.fn();
    operationReceipt = { begin: vi.fn(() => completeReceipt) };
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      return window.setTimeout(() => callback(0), 0);
    });
    vi.stubGlobal("cancelAnimationFrame", (handle: number) =>
      window.clearTimeout(handle),
    );
    await TestBed.configureTestingModule({
      imports: [OfficialLoginFormHostComponent],
      providers: [
        { provide: ComponentFixtureAutoDetect, useValue: false },
        importProvidersFrom(DialogModule),
        provideZoneChangeDetection(),
        provideNoopAnimations(),
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        { provide: LiveAnnouncer, useValue: announcer },
        {
          provide: GeneratorService,
          useValue: generator,
        },
        {
          provide: RETAINED_LOGIN_FORM_GENERATOR,
          useExisting: GeneratorService,
        },
        { provide: GENERATOR_OPERATION_RECEIPT, useValue: operationReceipt },
        {
          provide: RETAINED_LOGIN_FORM_STATUS_STORE,
          useExisting: PopupStateStore,
        },
        PopupStateStore,
      ],
    }).compileComponents();
  });

  it("does not patch a late generated username after route teardown", async () => {
    const pending = deferred<{ credential: string }>();
    generator.generate.mockReturnValueOnce(pending.promise);
    const fixture = await render("edit", loginView(), true);
    const details = fixture.debugElement.query(By.directive(OfficialLoginDetailsComponent))
      .componentInstance as OfficialLoginDetailsComponent;
    const username = details.loginDetailsForm.controls.username;

    const generation = details.generateUsername();
    await vi.waitFor(() => expect(generator.generate).toHaveBeenCalledWith("username", expect.any(Function)));
    fixture.destroy();
    pending.resolve({ credential: "stale-route-username" });
    await generation;

    expect(username.value).toBe("user@example.test");
  });

  it.each([
    ["username", "current-generated-username"],
    ["password", "current-generated-password"],
  ] as const)("keeps the operation receipt pending through one current %s patch", async (
    mode,
    credential,
  ) => {
    const pending = deferred<{ credential: string }>();
    generator.generate.mockReturnValueOnce(pending.promise);
    const store = TestBed.inject(PopupStateStore);
    store.restore({ ...store.snapshot(), isUnlocked: true });
    const fixture = await render("edit", loginView(), true);
    const details = fixture.debugElement.query(By.directive(OfficialLoginDetailsComponent))
      .componentInstance as OfficialLoginDetailsComponent;
    const control = details.loginDetailsForm.controls[mode];
    const originalPatchValue = control.patchValue.bind(control);
    const patchValue = vi.spyOn(control, "patchValue").mockImplementation((value, options) => {
      expect(operationReceipt.begin).toHaveBeenCalledOnce();
      expect(completeReceipt).not.toHaveBeenCalled();
      originalPatchValue(value, options);
    });

    const generation = mode === "username"
      ? details.generateUsername()
      : details.generatePassword();
    await vi.waitFor(() => expect(generator.generate).toHaveBeenCalledOnce());
    expect(operationReceipt.begin).toHaveBeenCalledOnce();
    expect(completeReceipt).not.toHaveBeenCalled();
    pending.resolve({ credential });
    await generation;

    expect(patchValue).toHaveBeenCalledOnce();
    expect(patchValue).toHaveBeenCalledWith(credential);
    expect(control.value).toBe(credential);
    expect(completeReceipt).toHaveBeenCalledOnce();
  });

  it.each([
    ["username", "stale-generated-username"],
    ["password", "stale-generated-password"],
  ] as const)(
    "never patches a generated %s after microtask-window ownership replacement",
    async (mode, credential) => {
      const pending = deferred<{ credential: string }>();
      generator.generate.mockReturnValueOnce(pending.promise);
      const store = TestBed.inject(PopupStateStore);
      store.restore({ ...store.snapshot(), isUnlocked: true });
      const fixture = await render("edit", loginView(), true);
      const details = fixture.debugElement.query(By.directive(OfficialLoginDetailsComponent))
        .componentInstance as OfficialLoginDetailsComponent;
      const control = details.loginDetailsForm.controls[mode];
      const originalSnapshot = store.snapshot.bind(store);
      const capturedSession = originalSnapshot().activeSession;
      const publication: string[] = [];
      const originalPatchValue = control.patchValue.bind(control);
      const patchValue = vi.spyOn(control, "patchValue").mockImplementation((value, options) => {
        publication.push(
          originalSnapshot().activeSession === capturedSession
            ? "current patch"
            : "stale patch",
        );
        originalPatchValue(value, options);
      });
      let replaceAfterOwnershipCheck = false;
      vi.spyOn(store, "snapshot").mockImplementation(() => {
        const snapshot = originalSnapshot();
        if (replaceAfterOwnershipCheck) {
          replaceAfterOwnershipCheck = false;
          queueMicrotask(() => {
            store.restore({ ...snapshot, activeSession: { id: "replacement" } });
            publication.push("ownership replacement");
          });
        }
        return snapshot;
      });

      const generation = mode === "username"
        ? details.generateUsername()
        : details.generatePassword();
      await vi.waitFor(() => expect(generator.generate).toHaveBeenCalledOnce());

      replaceAfterOwnershipCheck = true;
      pending.resolve({ credential });
      await generation;

      expect(patchValue).toHaveBeenCalledOnce();
      expect(publication).toEqual(["current patch", "ownership replacement"]);
    },
  );

  afterEach(() => {
    TestBed.inject(DialogService, null)?.closeAll();
    document
      .querySelectorAll(".cdk-overlay-container")
      .forEach((node) => node.remove());
    vi.unstubAllGlobals();
  });

  it("renders the complete retained official Login hierarchy and excludes dormant branches", async () => {
    const fixture = await render("edit", loginView(), true);
    const host = fixture.nativeElement as HTMLElement;

    expect(
      [...host.querySelectorAll("section h2")].map((heading) =>
        heading.textContent?.trim(),
      ),
    ).toEqual([
      "项目详细信息",
      "登录凭据",
      "自动填充选项",
      "附加选项",
      "自定义字段",
    ]);
    expect(host.querySelector("vault-item-details-section")).not.toBeNull();
    expect(
      host.querySelector("vault-login-details-section vault-autofill-options"),
    ).not.toBeNull();
    expect(
      host.querySelector(
        "vault-additional-options-section vault-custom-fields",
      ),
    ).not.toBeNull();
    expect(host.querySelector("vault-cipher-form")).toBeNull();
    expect(host.querySelector("bw-vault-form-section")).toBeNull();
    expect(host.querySelector("[slot=attachment-button]")).toBeNull();
    expect(host.textContent).not.toMatch(
      /SSH|通行密钥|附件|Windows|页面加载|组织|集合|保存并填充/,
    );

    expect(
      host.querySelector<HTMLInputElement>('input[formcontrolname="name"]')
        ?.value,
    ).toBe("Example Login");
    expect(
      host
        .querySelector<HTMLButtonElement>('[role="checkbox"]')
        ?.getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      host.querySelector<HTMLInputElement>('input[formcontrolname="username"]')
        ?.value,
    ).toBe("user@example.test");
    expect(
      host.querySelector<HTMLInputElement>('input[formcontrolname="password"]')
        ?.value,
    ).toBe("secret-value");
    expect(
      host.querySelector<HTMLInputElement>('input[formcontrolname="totp"]')
        ?.value,
    ).toBe("JBSWY3DPEHPK3PXP");
    expect(
      host.querySelector<HTMLTextAreaElement>(
        'textarea[formcontrolname="notes"]',
      )?.value,
    ).toBe("A private note");
    expect(
      host.querySelector<HTMLInputElement>('input[formcontrolname="reprompt"]')
        ?.checked,
    ).toBe(true);
    expect([
      ...host.querySelectorAll(
        '[data-testid^="custom-"][data-testid$="-field"]',
      ),
    ]).toHaveLength(3);
    expect(host.textContent).not.toContain("Linked field");
    expect(host.textContent).not.toContain("Unknown field");
    expect(host.textContent).not.toMatch(/\[missing|placeholder|undefined/i);
  });

  it.each(["edit", "clone"] as const)(
    "renders async %s controls before formReady is emitted",
    async (mode) => {
      const fixture = TestBed.createComponent(OfficialLoginCipherFormComponent);
      const component = fixture.componentInstance;
      component.formId = `async-${mode}`;
      component.config = buildOfficialLoginFormConfig({
        mode,
        initial: loginView(),
        folders: [FolderView.fromJSON({ id: null, name: "无文件夹" })],
        canViewSecrets: true,
      });
      let controlsAtReady: { readonly name: string; readonly username: string } | null = null;
      component.formReady.subscribe(() => {
        const host = fixture.nativeElement as HTMLElement;
        controlsAtReady = {
          name: host.querySelector<HTMLInputElement>('input[formcontrolname="name"]')?.value ?? "",
          username: host.querySelector<HTMLInputElement>('input[formcontrolname="username"]')?.value ?? "",
        };
      });

      fixture.detectChanges();

      await vi.waitFor(() => {
        expect(controlsAtReady).toEqual({
          name: "Example Login",
          username: "user@example.test",
        });
      });
    },
  );

  it.each(["edit", "clone"] as const)(
    "keeps every denied %s secret out of controls without adding a reveal path",
    async (mode) => {
      const fixture = await render(mode, loginView(), false);
      const host = fixture.nativeElement as HTMLElement;
      const password = host.querySelector<HTMLInputElement>(
        'input[formcontrolname="password"]',
      )!;
      const totp = host.querySelector<HTMLInputElement>(
        'input[formcontrolname="totp"]',
      )!;
      const hidden = host.querySelector<HTMLInputElement>(
        '[data-testid="custom-hidden-field"]',
      )!;

      expect(password.disabled).toBe(true);
      expect(totp.disabled).toBe(true);
      expect(hidden.disabled).toBe(true);
      expect(password.value).toBe("");
      expect(totp.value).toBe("");
      expect(hidden.value).toBe("");
      expect(password.type).toBe("password");
      expect(totp.type).toBe("password");
      expect(hidden.type).toBe("password");
      expect(
        host.querySelector('[data-testid="toggle-password-visibility"]'),
      ).toBeNull();
      expect(
        host.querySelector('[data-testid="toggle-totp-visibility"]'),
      ).toBeNull();
      expect(
        host.querySelector(
          '[data-testid="visibility-for-custom-hidden-field"]',
        ),
      ).toBeNull();
      expect(host.textContent).not.toContain("secret-value");
      expect(host.textContent).not.toContain("JBSWY3DPEHPK3PXP");
      expect(host.textContent).not.toContain("1234");
      expect(host.textContent).not.toContain("Linked field");
      expect(host.textContent).not.toContain("Unknown field");
      expect(nextHostConfig.initialValues?.password).toBeUndefined();
      expect(JSON.stringify(nextHostConfig)).not.toContain("secret-value");
    },
  );

  it("disables blank password and TOTP controls in denied add mode", async () => {
    const fixture = await render(
      "add",
      CipherView.fromJSON({ type: CipherType.Login })!,
      false,
    );
    const host = fixture.nativeElement as HTMLElement;
    const password = host.querySelector<HTMLInputElement>(
      'input[formcontrolname="password"]',
    )!;
    const totp = host.querySelector<HTMLInputElement>(
      'input[formcontrolname="totp"]',
    )!;

    expect(password.disabled).toBe(true);
    expect(totp.disabled).toBe(true);
    expect(password.value).toBe("");
    expect(totp.value).toBe("");
  });

  it.each(["edit", "clone"] as const)(
    "keeps denied %s hidden controls sanitized across parent disable and enable",
    async (mode) => {
      const fixture = await render(mode, loginView(), false);
      const custom = fixture.debugElement.query(
        By.directive(OfficialCustomFieldsComponent),
      ).componentInstance as OfficialCustomFieldsComponent;
      custom.addField(FieldType.Text, "New allowed field");
      fixture.detectChanges();
      await settle(fixture);

      const host = fixture.nativeElement as HTMLElement;
      const password = host.querySelector<HTMLInputElement>(
        'input[formcontrolname="password"]',
      )!;
      const totp = host.querySelector<HTMLInputElement>(
        'input[formcontrolname="totp"]',
      )!;
      const hidden = host.querySelector<HTMLInputElement>(
        '[data-testid="custom-hidden-field"]',
      )!;
      const text = host.querySelector<HTMLInputElement>(
        '[data-testid="custom-text-field"]',
      )!;
      const newText = [
        ...host.querySelectorAll<HTMLInputElement>(
          '[data-testid="custom-text-field"]',
        ),
      ].at(-1)!;
      const boolean = host.querySelector<HTMLInputElement>(
        '[data-testid="custom-boolean-field"]',
      )!;

      expect(hidden.disabled).toBe(true);
      expect(hidden.value).toBe("");
      fixture.componentInstance.disableFormFields();
      fixture.detectChanges();
      expect(text.disabled).toBe(true);
      expect(newText.disabled).toBe(true);
      expect(boolean.disabled).toBe(true);

      fixture.componentInstance.enableFormFields();
      fixture.detectChanges();

      expect(password.disabled).toBe(true);
      expect(totp.disabled).toBe(true);
      expect(hidden.disabled).toBe(true);
      expect(password.value).toBe("");
      expect(totp.value).toBe("");
      expect(hidden.value).toBe("");
      expect(text.disabled).toBe(false);
      expect(newText.disabled).toBe(false);
      expect(boolean.disabled).toBe(false);
    },
  );

  it("preserves denied secrets only in the emitted unchanged edit", async () => {
    const fixture = await render("edit", loginView(), false);
    const saved = vi.fn<(cipher: CipherView) => void>();
    fixture.componentInstance.cipherSaved.subscribe(saved);

    await fixture.componentInstance.submit();

    expect(saved).toHaveBeenCalledOnce();
    const emitted = saved.mock.calls[0][0];
    expect(emitted.login.password).toBe("secret-value");
    expect(emitted.login.totp).toBe("JBSWY3DPEHPK3PXP");
    expect(emitted.fields).toEqual([
      expect.objectContaining({
        name: "Environment",
        value: "staging",
        type: FieldType.Text,
      }),
      expect.objectContaining({
        name: "PIN",
        value: "1234",
        type: FieldType.Hidden,
      }),
      expect.objectContaining({
        name: "Enabled",
        value: "true",
        type: FieldType.Boolean,
      }),
    ]);
  });

  it("passes a fresh submit cipher to beforeSubmit and awaits its decision", async () => {
    const fixture = await render("edit", loginView(), true);
    let release!: (value: boolean) => void;
    const decision = new Promise<boolean>((resolve) => { release = resolve; });
    let received: CipherView | undefined;
    const beforeSubmit = vi.fn((cipher: CipherView) => {
      received = cipher;
      return decision;
    });
    fixture.componentInstance.beforeSubmit = beforeSubmit as never;
    const saved = vi.fn<(cipher: CipherView) => void>();
    fixture.componentInstance.cipherSaved.subscribe(saved);
    let submitResolved = false;

    const submitting = fixture.componentInstance.submit().then(() => { submitResolved = true; });
    await vi.waitFor(() => expect(beforeSubmit).toHaveBeenCalledOnce());

    expect(submitResolved).toBe(false);
    expect(saved).not.toHaveBeenCalled();
    release(false);
    await submitting;

    expect(received).toBeInstanceOf(CipherView);
    expect(received).not.toBe(member(fixture.componentInstance, "updatedCipherView"));
    expect(received?.name).toBe("Example Login");
    expect(saved).not.toHaveBeenCalled();
    expect(TestBed.inject(PopupStateStore).snapshot().statusMessage).toBe("");
  });

  it("keeps the clone name unchanged and clears server identity, key, attachments, and passkeys", async () => {
    const fixture = await render("clone", loginView(), true);
    const saved = vi.fn<(cipher: CipherView) => void>();
    fixture.componentInstance.cipherSaved.subscribe(saved);

    await fixture.componentInstance.submit();

    expect(saved).toHaveBeenCalledOnce();
    const clone = saved.mock.calls[0][0];
    expect(clone.name).toBe("Example Login");
    expect(clone.id).toBeNull();
    expect(clone.key).toBeUndefined();
    expect(clone.attachments).toEqual([]);
    expect(clone.login.fido2Credentials).toBeNull();
  });

  it("preserves denied clone secrets while clearing server identity", async () => {
    const fixture = await render("clone", loginView(), false);
    const saved = vi.fn<(cipher: CipherView) => void>();
    fixture.componentInstance.cipherSaved.subscribe(saved);

    await fixture.componentInstance.submit();

    expect(saved).toHaveBeenCalledOnce();
    const clone = saved.mock.calls[0][0];
    expect(clone.login.password).toBe("secret-value");
    expect(clone.login.totp).toBe("JBSWY3DPEHPK3PXP");
    expect(clone.fields.find((field) => field.name === "PIN")?.value).toBe(
      "1234",
    );
    expect(clone.id).toBeNull();
    expect(clone.key).toBeUndefined();
    expect(clone.attachments).toEqual([]);
    expect(clone.login.fido2Credentials).toBeNull();
  });

  it("preserves URI control identity for duplicate, empty, drag, and keyboard reorder and restores focus", async () => {
    const fixture = await render("edit", loginView(), true);
    const autofill = fixture.debugElement.query(
      By.directive(OfficialAutofillOptionsComponent),
    ).componentInstance as OfficialAutofillOptionsComponent;
    const controls = member<readonly object[]>(autofill, "uriControls");
    const first = controls[0];
    const second = controls[1];

    autofill.addUri({
      uri: "https://example.test/login",
      matchDetection: null,
    });
    const duplicate = member<readonly object[]>(autofill, "uriControls")[2];
    autofill.addUri({ uri: "", matchDetection: null }, true);
    fixture.detectChanges();
    await settle(fixture);
    const afterAdd = member<readonly object[]>(autofill, "uriControls");
    const empty = afterAdd[3];

    expect(afterAdd).toEqual([first, second, duplicate, empty]);
    expect((document.activeElement as HTMLInputElement).value).toBe("");
    expect(announcer.announcements.at(-1)).toEqual({
      message: "网址已添加",
      politeness: "polite",
    });

    autofill.onUriItemDrop({ previousIndex: 0, currentIndex: 2 } as never);
    expect(member<readonly object[]>(autofill, "uriControls")).toEqual([
      second,
      duplicate,
      first,
      empty,
    ]);

    fixture.detectChanges();
    const reorder = (
      fixture.nativeElement as HTMLElement
    ).querySelectorAll<HTMLButtonElement>(
      'vault-autofill-options [data-testid="reorder-toggle-button"]',
    )[2];
    reorder.focus();
    reorder.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    await settle(fixture);
    expect(member<readonly object[]>(autofill, "uriControls")).toEqual([
      second,
      first,
      duplicate,
      empty,
    ]);
    expect(document.activeElement).toBe(reorder);
    expect(announcer.announcements.at(-1)).toEqual({
      message: "网站 (URI) 已上移，位置 2 / 4",
      politeness: "assertive",
    });
  });

  it("rolls advanced URI selection back on cancel and keeps it on continue with real dialog focus restoration", async () => {
    const fixture = await render("edit", loginView(), true);
    const option = fixture.debugElement.query(
      By.directive(OfficialUriOptionComponent),
    ).componentInstance as OfficialUriOptionComponent;
    const uriForm = member<{
      controls: {
        matchDetection: {
          value: number | null;
          setValue(value: number | null): void;
        };
      };
    }>(option, "uriForm");
    const trigger = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLButtonElement>(
      '[data-testid="toggle-match-detection-button"]',
    )!;
    trigger.focus();
    const ngZone = TestBed.inject(NgZone);

    ngZone.run(() => {
      uriForm.controls.matchDetection.setValue(UriMatchStrategy.Domain);
      uriForm.controls.matchDetection.setValue(UriMatchStrategy.StartsWith);
    });
    await settle(fixture);
    expect(document.body.textContent).toContain(
      "「开始于」是一种高级选项，会增加暴露凭据的风险。",
    );
    clickDialogButton("取消");
    await settle(fixture);
    await waitForDialogsClosed("advanced cancel");
    expect(uriForm.controls.matchDetection.value).toBe(UriMatchStrategy.Domain);
    expect(document.activeElement).toBe(trigger);

    ngZone.run(() =>
      uriForm.controls.matchDetection.setValue(
        UriMatchStrategy.RegularExpression,
      ),
    );
    await settle(fixture);
    expect(document.body.textContent).toContain(
      "「正则表达方式」是一种高级选项，会增加暴露凭据的风险。",
    );
    clickDialogButton("继续");
    await settle(fixture);
    await waitForDialogsClosed("advanced continue");
    expect(uriForm.controls.matchDetection.value).toBe(
      UriMatchStrategy.RegularExpression,
    );
    expect(document.activeElement).toBe(trigger);
  });

  it("preserves custom control identity, exact announcements, and focus through add and reorder", async () => {
    const fixture = await render("edit", loginView(), true);
    const custom = fixture.debugElement.query(
      By.directive(OfficialCustomFieldsComponent),
    ).componentInstance as OfficialCustomFieldsComponent;
    const fields = member<{ controls: object[] }>(custom, "fields");
    const first = fields.controls[0];
    const second = fields.controls[1];
    const third = fields.controls[2];

    custom.addField(FieldType.Text, "Environment");
    fixture.detectChanges();
    await settle(fixture);
    const duplicate = fields.controls[3];
    custom.addField(FieldType.Text, "");
    fixture.detectChanges();
    await settle(fixture);
    const empty = fields.controls[4];

    expect(fields.controls).toEqual([first, second, third, duplicate, empty]);
    expect(document.activeElement).toBe(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>(
        '[data-testid="custom-text-field"]',
      )[2],
    );
    expect(announcer.announcements.at(-1)).toEqual({
      message: " 已添加",
      politeness: "polite",
    });

    custom.drop({ previousIndex: 0, currentIndex: 3 } as never);
    expect(fields.controls).toEqual([second, third, duplicate, first, empty]);
    fixture.detectChanges();
    const target = (
      fixture.nativeElement as HTMLElement
    ).querySelectorAll<HTMLButtonElement>(
      'vault-custom-fields [data-testid="reorder-toggle-button"]',
    )[3];
    target.focus();
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    await settle(fixture);
    expect(fields.controls).toEqual([second, third, first, duplicate, empty]);
    expect(announcer.announcements.at(-1)).toEqual({
      message: "Environment 已上移，位置 3 / 5",
      politeness: "assertive",
    });
    expect(document.activeElement).toBe(target);
  });

  it("runs the custom-field dialog add, duplicate, edit, delete, cancel, and required states", async () => {
    const fixture = await render("edit", loginView(), true);
    const host = fixture.nativeElement as HTMLElement;
    const addButton = host.querySelector<HTMLButtonElement>(
      '[data-testid="add-field-button"]',
    )!;
    addButton.focus();
    addButton.click();
    await settle(fixture);

    let label = dialogLabelInput();
    expect(dialogPrimaryButton().getAttribute("aria-disabled")).toBe("true");
    setInput(label, "Duplicate");
    await settle(fixture);
    expect(dialogPrimaryButton().getAttribute("aria-disabled")).toBeNull();
    dialogPrimaryButton().click();
    await settle(fixture);
    await waitForDialogsClosed("first add");
    fixture.detectChanges();
    expect(host.textContent).toContain("Duplicate");
    expect(document.activeElement).toBe(
      [
        ...host.querySelectorAll<HTMLInputElement>(
          '[data-testid="custom-text-field"]',
        ),
      ].at(-1),
    );

    host
      .querySelector<HTMLButtonElement>('[data-testid="add-field-button"]')!
      .click();
    await settle(fixture);
    setInput(dialogLabelInput(), "Duplicate");
    await settle(fixture);
    expect(dialogPrimaryButton().getAttribute("aria-disabled")).toBeNull();
    dialogPrimaryButton().click();
    await settle(fixture);
    await waitForDialogsClosed("duplicate add");
    fixture.detectChanges();
    expect([
      ...host.querySelectorAll('[data-testid="Duplicate-entry"]'),
    ]).toHaveLength(2);

    host
      .querySelector<HTMLButtonElement>(
        '[data-testid="edit-custom-field-button"]',
      )!
      .click();
    await settle(fixture);
    label = dialogLabelInput();
    setInput(label, "Renamed");
    dialogPrimaryButton().click();
    await settle(fixture);
    await waitForDialogsClosed("edit");
    fixture.detectChanges();
    expect(host.textContent).toContain("Renamed");

    const secondEdit = host.querySelectorAll<HTMLButtonElement>(
      '[data-testid="edit-custom-field-button"]',
    )[1];
    secondEdit.focus();
    secondEdit.click();
    await settle(fixture);
    setInput(dialogLabelInput(), "Cancelled name");
    clickDialogButton("取消");
    await settle(fixture);
    await waitForDialogsClosed("cancel edit");
    expect(host.textContent).not.toContain("Cancelled name");
    expect(document.activeElement).toBe(secondEdit);

    secondEdit.click();
    await settle(fixture);
    document
      .querySelector<HTMLButtonElement>('[biticonbutton="bwi-trash"]')!
      .click();
    await settle(fixture);
    await waitForDialogsClosed("delete");
    fixture.detectChanges();
    expect(host.textContent).not.toContain("PIN");
    expect(document.body.textContent).not.toContain("链接型");
  });

  it("keeps zero URI edits empty, gives add mode one official blank URI, and enforces required name", async () => {
    const zeroUri = loginView();
    zeroUri.login.uris = [];
    const editFixture = await render("edit", zeroUri, true);
    expect(
      (editFixture.nativeElement as HTMLElement).querySelectorAll(
        "vault-autofill-uri-option",
      ),
    ).toHaveLength(0);

    const addFixture = await render(
      "add",
      CipherView.fromJSON({ type: CipherType.Login })!,
      true,
    );
    const addHost = addFixture.nativeElement as HTMLElement;
    expect(addHost.querySelectorAll("vault-autofill-uri-option")).toHaveLength(
      1,
    );
    expect(
      addHost.querySelector<HTMLInputElement>("vault-autofill-uri-option input")
        ?.value,
    ).toBe("");

    const saved = vi.fn();
    addFixture.componentInstance.cipherSaved.subscribe(saved);
    await addFixture.componentInstance.submit();
    addFixture.detectChanges();
    await settle(addFixture);
    expect(saved).not.toHaveBeenCalled();
    expect(
      addHost
        .querySelector<HTMLInputElement>('input[formcontrolname="name"]')
        ?.getAttribute("aria-invalid"),
    ).toBe("true");
    expect(TestBed.inject(PopupStateStore).snapshot().statusMessage).toBe(
      "有 1 个字段需要您注意。",
    );
  });

  it("focuses and centers the first invalid Login control", async () => {
    const fixture = await render("add", CipherView.fromJSON({ type: CipherType.Login })!, true);
    const name = (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLInputElement>('input[formcontrolname="name"]')!;
    const focus = vi.spyOn(name, "focus");
    name.scrollIntoView = vi.fn();
    await fixture.componentInstance.submit();
    fixture.detectChanges();
    await settle(fixture);
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(name);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(name.scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
  });

  it("skips a hidden first invalid Login control and focuses the next visible invalid control", async () => {
    const fixture = await render("add", CipherView.fromJSON({ type: CipherType.Login })!, true);
    const host = fixture.nativeElement as HTMLElement;
    const name = host.querySelector<HTMLInputElement>('input[formcontrolname="name"]')!;
    const username = host.querySelector<HTMLInputElement>('input[formcontrolname="username"]')!;
    const cipherForm = Reflect.get(fixture.componentInstance, "cipherForm");
    cipherForm.controls.loginDetails.controls.username.setErrors({ required: true });
    fixture.detectChanges();
    name.hidden = true;
    const nameFocus = vi.spyOn(name, "focus");
    const usernameFocus = vi.spyOn(username, "focus");
    username.scrollIntoView = vi.fn();

    await fixture.componentInstance.submit();
    fixture.detectChanges();
    await settle(fixture);

    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(username.getAttribute("aria-invalid")).toBe("true");
    expect(nameFocus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(username);
    expect(usernameFocus).toHaveBeenCalledWith({ preventScroll: true });
    expect(username.scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
  });

  it("continues to the next invalid Login control when an earlier candidate refuses focus", async () => {
    const fixture = await render("add", CipherView.fromJSON({ type: CipherType.Login })!, true);
    const host = fixture.nativeElement as HTMLElement;
    const name = host.querySelector<HTMLInputElement>('input[formcontrolname="name"]')!;
    const username = host.querySelector<HTMLInputElement>('input[formcontrolname="username"]')!;
    const cipherForm = Reflect.get(fixture.componentInstance, "cipherForm");
    cipherForm.controls.loginDetails.controls.username.setErrors({ required: true });
    fixture.detectChanges();
    const nameFocus = vi.spyOn(name, "focus").mockImplementation(() => undefined);
    const usernameFocus = vi.spyOn(username, "focus");
    username.scrollIntoView = vi.fn();

    await fixture.componentInstance.submit();
    fixture.detectChanges();
    await settle(fixture);

    expect(nameFocus).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement).toBe(username);
    expect(usernameFocus).toHaveBeenCalledWith({ preventScroll: true });
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

async function render(
  mode: "add" | "edit" | "clone",
  initial: CipherView,
  canViewSecrets: boolean,
) {
  nextHostFormId = `login-${mode}`;
  nextHostConfig = buildOfficialLoginFormConfig({
    mode,
    initial,
    folders: [
      FolderView.fromJSON({ id: null, name: "无文件夹" }),
      FolderView.fromJSON({ id: "folder-1", name: "Work" }),
    ],
    canViewSecrets,
  });
  const hostFixture = TestBed.createComponent(OfficialLoginFormHostComponent);
  hostFixture.changeDetectorRef.detectChanges();
  const formDebugElement = hostFixture.debugElement.query(
    By.directive(OfficialLoginCipherFormComponent),
  );
  const form =
    formDebugElement.componentInstance as OfficialLoginCipherFormComponent;
  await vi.waitFor(() => {
    expect({
      loading: member<boolean>(form, "loading"),
      firstInitialized: member<boolean>(form, "_firstInitialized"),
    }).toEqual({ loading: false, firstInitialized: true });
  });
  const detectChanges = () => {
    hostFixture.changeDetectorRef.detectChanges();
  };
  detectChanges();
  await settle({
    whenStable: hostFixture.whenStable.bind(hostFixture),
    detectChanges,
  });
  return {
    componentInstance: form,
    debugElement: hostFixture.debugElement,
    nativeElement: hostFixture.nativeElement,
    detectChanges,
    whenStable: hostFixture.whenStable.bind(hostFixture),
    destroy: () => hostFixture.destroy(),
  };
}

async function settle(fixture: {
  whenStable(): Promise<unknown>;
  detectChanges(checkNoChanges?: boolean): void;
}) {
  detectOpenDialogs();
  await fixture.whenStable();
  await Promise.resolve();
  fixture.detectChanges(false);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function detectOpenDialogs(): void {
  for (const ref of TestBed.inject(CdkDialog).openDialogs) {
    ref.componentRef?.changeDetectorRef.detectChanges();
    const containerChangeDetector = Reflect.get(
      ref.containerInstance,
      "_changeDetectorRef",
    ) as {
      detectChanges(): void;
    };
    containerChangeDetector.detectChanges();
  }
}

async function waitForDialogsClosed(context: string): Promise<void> {
  await vi.waitFor(() => {
    expect(TestBed.inject(CdkDialog).openDialogs, context).toHaveLength(0);
    expect(
      document.querySelectorAll('.cdk-overlay-pane [role="dialog"]'),
      context,
    ).toHaveLength(0);
  });
}

function member<T>(target: object, name: string): T {
  return Reflect.get(target, name) as T;
}

function clickDialogButton(text: string): void {
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>(
      ".cdk-overlay-container button",
    ),
  ].find((candidate) => candidate.textContent?.trim() === text);
  expect(button, `dialog button ${text}`).toBeDefined();
  button!.click();
}

function dialogLabelInput(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(
    '.cdk-overlay-container input[formcontrolname="label"]',
  )!;
}

function dialogPrimaryButton(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(
    '.cdk-overlay-container button[type="submit"]',
  )!;
}

function setInput(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function loginView(): CipherView {
  return CipherView.fromJSON({
    id: "login-1",
    type: CipherType.Login,
    name: "Example Login",
    folderId: "folder-1",
    favorite: true,
    reprompt: 1,
    key: "2.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=|BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=|CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC=",
    attachments: [{ id: "attachment-1", fileName: "opaque.txt" }],
    fields: [
      { name: "Environment", value: "staging", type: FieldType.Text },
      { name: "PIN", value: "1234", type: FieldType.Hidden },
      { name: "Enabled", value: "true", type: FieldType.Boolean },
      {
        name: "Linked field",
        value: "",
        type: FieldType.Linked,
        linkedId: 100,
      },
      { name: "Unknown field", value: "opaque", type: 99 },
    ],
    login: {
      username: "user@example.test",
      password: "secret-value",
      totp: "JBSWY3DPEHPK3PXP",
      uris: [
        { uri: "https://example.test/login" },
        { uri: "https://admin.example.test", match: UriMatchStrategy.Host },
      ],
      fido2Credentials: [{ credentialId: "opaque-passkey" }],
    },
    notes: "A private note",
  })!;
}
