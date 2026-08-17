import "zone.js";
import "@angular/compiler";

import { LiveAnnouncer } from "@angular/cdk/a11y";
import { Dialog as CdkDialog } from "@angular/cdk/dialog";
import {
  Component,
  importProvidersFrom,
  provideZoneChangeDetection,
} from "@angular/core";
import { By } from "@angular/platform-browser";
import { provideNoopAnimations } from "@angular/platform-browser/animations";
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { ComponentFixtureAutoDetect, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import {
  CardLinkedId,
  CipherType,
  FieldType,
  IdentityLinkedId,
  SecureNoteType,
} from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FolderView } from "@bitwarden/common/vault/models/view/folder.view";
import { DialogService } from "@bitwarden/components/dialog/dialog.service";
import { DialogModule } from "@bitwarden/components/dialog/dialog.module";

import { OfficialI18nService } from "../../official-ui/official-i18n.service";
import { PopupStateStore } from "../../popup-state";
import { RETAINED_LOGIN_FORM_STATUS_STORE } from "../../vault/retained-login-form.adapter";
import {
  RetainedPersonalCipherFormService,
  buildOfficialPersonalCipherFormConfig,
  retainedPersonalSubmitToDraft,
  type RetainedOfficialPersonalCipherFormConfig,
} from "../../vault/retained-personal-cipher-form.adapter";
import { OfficialCardDetailsSectionComponent } from "./official-card-details-section.component";
import { OfficialIdentitySectionComponent } from "./official-identity-section.component";
import { OfficialPersonalCipherFormComponent } from "./official-personal-cipher-form.component";
import { OfficialPersonalCustomFieldsComponent } from "./official-personal-custom-fields.component";

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
  imports: [OfficialPersonalCipherFormComponent],
  template: `
    <bw-official-personal-cipher-form
      [formId]="formId"
      [config]="config"
      [beforeSubmit]="beforeSubmit"
    ></bw-official-personal-cipher-form>
  `,
})
class OfficialPersonalFormHostComponent {
  get formId() {
    return nextFormId;
  }
  get config() {
    return nextConfig;
  }
  get beforeSubmit() {
    return nextBeforeSubmit;
  }
}

let nextFormId = "personal-form";
let nextConfig: RetainedOfficialPersonalCipherFormConfig;
let nextBeforeSubmit: unknown = async () => true;

describe("OfficialPersonalCipherFormComponent", () => {
  let announcer: RecordingLiveAnnouncer;

  beforeEach(async () => {
    announcer = new RecordingLiveAnnouncer();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(0), 0),
    );
    vi.stubGlobal("cancelAnimationFrame", (handle: number) =>
      window.clearTimeout(handle),
    );
    await TestBed.configureTestingModule({
      imports: [OfficialPersonalFormHostComponent],
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
          provide: RETAINED_LOGIN_FORM_STATUS_STORE,
          useExisting: PopupStateStore,
        },
        PopupStateStore,
      ],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.inject(DialogService, null)?.closeAll();
    document
      .querySelectorAll(".cdk-overlay-container")
      .forEach((node) => node.remove());
    vi.unstubAllGlobals();
  });

  it.each([
    [CipherType.Card, "vault-card-details-section"],
    [CipherType.Identity, "vault-identity-section"],
    [CipherType.SecureNote, null],
  ] as const)(
    "renders only the retained type branch for %s",
    async (cipherType, selector) => {
      const fixture = await render("add", cipherType, personalView(cipherType));
      const host = fixture.nativeElement as HTMLElement;

      expect(host.querySelector("vault-login-details-section")).toBeNull();
      expect(host.querySelector("vault-sshkey-section")).toBeNull();
      expect(host.querySelector("vault-bank-account-section")).toBeNull();
      expect(host.querySelector("vault-drivers-license-section")).toBeNull();
      expect(host.querySelector("vault-passport-section")).toBeNull();
      expect(host.querySelector("[slot=attachment-button]")).toBeNull();
      if (selector) {
        expect(host.querySelector(selector)).not.toBeNull();
      } else {
        expect(host.querySelector("vault-card-details-section")).toBeNull();
        expect(host.querySelector("vault-identity-section")).toBeNull();
      }
      expect(host.querySelector("vault-item-details-section")).not.toBeNull();
      expect(
        host.querySelector("vault-additional-options-section"),
      ).not.toBeNull();
      expect(host.querySelector("vault-custom-fields")).not.toBeNull();
    },
  );

  it.each([
    [CipherType.Card, ["itemDetails", "cardDetails", "additionalOptions", "customFields"]],
    [
      CipherType.Identity,
      ["itemDetails", "identityDetails", "additionalOptions", "customFields"],
    ],
    [CipherType.SecureNote, ["itemDetails", "additionalOptions", "customFields"]],
  ] as const)("registers the exact official child order for %s", async (cipherType, order) => {
    const fixture = await render("add", cipherType, personalView(cipherType));

    expect(
      Object.keys(member<any>(fixture.componentInstance, "cipherForm").controls),
    ).toEqual(order);
  });

  it.each(["add", "edit", "clone"] as const)(
    "initializes complete Card values in %s mode and retains grouped card numbers",
    async (mode) => {
      const fixture = await render(
        mode,
        CipherType.Card,
        personalView(CipherType.Card),
      );
      const card = directive(fixture, OfficialCardDetailsSectionComponent);
      const value = member<{ getRawValue(): Record<string, unknown> }>(
        card,
        "cardDetailsForm",
      ).getRawValue();

      expect(value).toEqual({
        cardholderName: "Ada Lovelace",
        number: "4111 1111 1111 1111",
        brand: "Visa",
        expMonth: "4",
        expYear: "29",
        code: "123",
      });
      const host = fixture.nativeElement as HTMLElement;
      expect(
        host.querySelector<HTMLInputElement>('input[formcontrolname="number"]')
          ?.type,
      ).toBe("password");
      expect(
        host.querySelector<HTMLInputElement>('input[formcontrolname="code"]')
          ?.type,
      ).toBe("password");
    },
  );

  it("auto-detects the Card brand and normalizes expiration values before submit", async () => {
    const received = vi.fn(async (_cipher: CipherView) => false);
    const fixture = await render(
      "edit",
      CipherType.Card,
      personalView(CipherType.Card),
      true,
      received,
    );
    const card = directive(fixture, OfficialCardDetailsSectionComponent);
    const form = member<any>(card, "cardDetailsForm");

    form.controls.number.setValue("5555 5555 5555 4444");
    form.controls.expMonth.setValue("04");
    form.controls.expYear.setValue("29");
    fixture.detectChanges(false);
    await fixture.componentInstance.submit();

    expect(form.controls.brand.value).toBe("Mastercard");
    expect(received).toHaveBeenCalledOnce();
    const submitted = received.mock.calls[0][0];
    expect(submitted.card.number).toBe("5555 5555 5555 4444");
    expect(submitted.card.expMonth).toBe("04");
    expect(submitted.card.expYear).toBe("2029");
  });

  it("maps canonical Card month and Identity title through actual official options", async () => {
    const cardView = personalView(CipherType.Card);
    cardView.card.expMonth = "04";
    let submittedCard: CipherView | undefined;
    const cardFixture = await render(
      "edit",
      CipherType.Card,
      cardView,
      true,
      async (cipher) => {
        submittedCard = cipher;
        return true;
      },
    );
    const card = directive(cardFixture, OfficialCardDetailsSectionComponent);
    const cardForm = member<any>(card, "cardDetailsForm");
    expect(cardForm.controls.expMonth.value).toBe("4");
    expect(
      member<readonly { name: string; value: string | null }[]>(card, "expirationMonths").find(
        ({ value }) => value === cardForm.controls.expMonth.value,
      )?.name,
    ).toBe("04 - 四月");
    await cardFixture.componentInstance.submit();
    expect(submittedCard?.card.expMonth).toBe("04");

    let submittedIdentity: CipherView | undefined;
    const identityFixture = await render(
      "edit",
      CipherType.Identity,
      personalView(CipherType.Identity),
      true,
      async (cipher) => {
        submittedIdentity = cipher;
        return true;
      },
    );
    const identity = directive(identityFixture, OfficialIdentitySectionComponent);
    const identityForm = member<any>(identity, "identityForm");
    expect(identityForm.controls.title.value).toBe("博士");
    expect(
      member<readonly { name: string; value: string | null }[]>(
        identity,
        "identityTitleOptions",
      ).find(({ value }) => value === identityForm.controls.title.value)?.name,
    ).toBe("博士");
    await identityFixture.componentInstance.submit();
    expect(
      retainedPersonalSubmitToDraft({
        mode: "edit",
        cipherType: CipherType.Identity,
        value: submittedIdentity!,
      }),
    ).toEqual(expect.objectContaining({ title: "Dr" }));
  });

  it("initializes every Identity field and keeps only SSN and passport concealed", async () => {
    const fixture = await render(
      "edit",
      CipherType.Identity,
      personalView(CipherType.Identity),
    );
    const identity = directive(fixture, OfficialIdentitySectionComponent);
    const value = member<any>(identity, "identityForm").getRawValue();

    expect(value).toEqual({
      title: "博士",
      firstName: "Ada",
      middleName: "Byron",
      lastName: "Lovelace",
      username: "ada",
      company: "Analytical Engines",
      ssn: "111-22-3333",
      passportNumber: "P1234567",
      licenseNumber: "DL-42",
      email: "ada@example.test",
      phone: "+44 20 0000 0000",
      address1: "1 Engine Way",
      address2: "Suite 2",
      address3: "North Wing",
      city: "London",
      state: "London",
      postalCode: "SW1A 1AA",
      country: "GB",
    });
    const host = fixture.nativeElement as HTMLElement;
    expect(
      host.querySelector<HTMLInputElement>('input[formcontrolname="ssn"]')
        ?.type,
    ).toBe("password");
    expect(
      host.querySelector<HTMLInputElement>(
        'input[formcontrolname="passportNumber"]',
      )?.type,
    ).toBe("password");
    expect(
      host.querySelector<HTMLInputElement>(
        'input[formcontrolname="licenseNumber"]',
      )?.type,
    ).toBe("text");
  });

  it("initializes a generic Secure Note with only common sections", async () => {
    const fixture = await render(
      "add",
      CipherType.SecureNote,
      personalView(CipherType.SecureNote),
    );
    const updated = member<CipherView>(
      fixture.componentInstance,
      "updatedCipherView",
    );

    expect(updated.secureNote.type).toBe(SecureNoteType.Generic);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        "vault-card-details-section, vault-identity-section",
      ),
    ).toBeNull();
  });

  it.each([
    [CipherType.Card, CardLinkedId.Number],
    [CipherType.Identity, IdentityLinkedId.Email],
  ] as const)(
    "retains official linked options and linked values for %s",
    async (cipherType, linkedId) => {
      const fixture = await render(
        "edit",
        cipherType,
        personalView(cipherType),
      );
      const custom = directive(fixture, OfficialPersonalCustomFieldsComponent);
      const options = member<readonly { value: number }[]>(
        custom,
        "linkedFieldOptions",
      );
      const fields = member<any>(custom, "fields");

      expect(options.map((option) => option.value)).toContain(linkedId);
      expect(fields.at(fields.length - 1).getRawValue()).toEqual(
        expect.objectContaining({
          type: FieldType.Linked,
          linkedId,
        }),
      );
      custom.addField(FieldType.Linked, "Another link");
      expect(fields.at(fields.length - 1).getRawValue()).toEqual(
        expect.objectContaining({
          value: null,
          linkedId: options[0].value,
        }),
      );
    },
  );

  it("offers no linked type or linked control for Secure Note", async () => {
    const fixture = await render(
      "add",
      CipherType.SecureNote,
      personalView(CipherType.SecureNote),
    );
    const custom = directive(fixture, OfficialPersonalCustomFieldsComponent);
    expect(member<readonly unknown[]>(custom, "linkedFieldOptions")).toEqual(
      [],
    );

    const addButton = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLButtonElement>('[data-testid="add-field-button"]')!;
    addButton.click();
    await settle(fixture);
    expect(document.body.textContent).not.toContain("链接型");
  });

  it("adds, edits, deletes, drags, and keyboard-reorders all retained custom field types", async () => {
    const fixture = await render(
      "edit",
      CipherType.Card,
      personalView(CipherType.Card),
    );
    const custom = directive(fixture, OfficialPersonalCustomFieldsComponent);
    const fields = member<any>(custom, "fields");

    custom.addField(FieldType.Text, "Text field");
    custom.addField(FieldType.Hidden, "Hidden field");
    custom.addField(FieldType.Boolean, "Boolean field");
    custom.addField(FieldType.Linked, "Linked field");
    fixture.detectChanges(false);
    await settle(fixture);
    expect(
      fields.controls.slice(-4).map((control: any) => control.value.type),
    ).toEqual([
      FieldType.Text,
      FieldType.Hidden,
      FieldType.Boolean,
      FieldType.Linked,
    ]);

    const first = fields.controls[0];
    custom.drop({ previousIndex: 0, currentIndex: 2 } as never);
    expect(fields.controls[2]).toBe(first);
    custom.updateLabel(2, "Renamed");
    expect(fields.at(2).value.name).toBe("Renamed");
    custom.removeField(2);
    expect(fields.controls).not.toContain(first);

    fixture.detectChanges(false);
    const reorder = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLButtonElement>(
      '[data-testid="reorder-toggle-button"]',
    )!;
    reorder.focus();
    reorder.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    await settle(fixture);
    expect(announcer.announcements.at(-1)).toEqual(
      expect.objectContaining({ politeness: "assertive" }),
    );
  });

  it("validates the required name before invoking beforeSubmit", async () => {
    const beforeSubmit = vi.fn(async () => false);
    const empty = personalView(CipherType.Card);
    empty.name = "";
    const fixture = await render(
      "add",
      CipherType.Card,
      empty,
      true,
      beforeSubmit,
    );

    await fixture.componentInstance.submit();
    fixture.detectChanges(false);

    expect(beforeSubmit).not.toHaveBeenCalled();
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector<HTMLInputElement>('input[formcontrolname="name"]')
        ?.getAttribute("aria-invalid"),
    ).toBe("true");
    expect(TestBed.inject(PopupStateStore).snapshot().statusMessage).toBe(
      "有 1 个字段需要您注意。",
    );
  });

  it("focuses and centers the first invalid personal-item control", async () => {
    const empty = personalView(CipherType.Card);
    empty.name = "";
    const fixture = await render("add", CipherType.Card, empty);
    const name = (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLInputElement>('input[formcontrolname="name"]')!;
    const focus = vi.spyOn(name, "focus");
    name.scrollIntoView = vi.fn();
    await fixture.componentInstance.submit();
    fixture.detectChanges(false);
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(name);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(name.scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
  });

  it("skips a disabled first invalid personal control and focuses the next visible invalid control", async () => {
    const empty = personalView(CipherType.Card);
    empty.name = "";
    const fixture = await render("add", CipherType.Card, empty);
    const host = fixture.nativeElement as HTMLElement;
    const name = host.querySelector<HTMLInputElement>('input[formcontrolname="name"]')!;
    const cardholder = host.querySelector<HTMLInputElement>(
      'input[formcontrolname="cardholderName"]',
    )!;
    const cipherForm = member<any>(fixture.componentInstance, "cipherForm");
    cipherForm.controls.cardDetails.controls.cardholderName.setErrors({ required: true });
    fixture.detectChanges(false);
    name.disabled = true;
    const nameFocus = vi.spyOn(name, "focus");
    const cardholderFocus = vi.spyOn(cardholder, "focus");
    cardholder.scrollIntoView = vi.fn();

    await fixture.componentInstance.submit();
    fixture.detectChanges(false);

    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(cardholder.getAttribute("aria-invalid")).toBe("true");
    expect(nameFocus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(cardholder);
    expect(cardholderFocus).toHaveBeenCalledWith({ preventScroll: true });
    expect(cardholder.scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
  });

  it("awaits beforeSubmit while disabled and suppresses local save, toast, and output", async () => {
    let release!: (value: boolean) => void;
    const transport = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    const beforeSubmit = vi.fn(async () => transport);
    const fixture = await render(
      "edit",
      CipherType.Card,
      personalView(CipherType.Card),
      true,
      beforeSubmit,
    );
    const service = fixture.debugElement
      .query(By.directive(OfficialPersonalCipherFormComponent))
      .injector.get(RetainedPersonalCipherFormService);
    const localSave = vi.spyOn(service, "saveCipher");
    const saved = vi.fn();
    fixture.componentInstance.cipherSaved.subscribe(saved);

    const submission = fixture.componentInstance.submit();
    await vi.waitFor(() => expect(beforeSubmit).toHaveBeenCalledOnce());
    expect(member<any>(fixture.componentInstance, "cipherForm").disabled).toBe(
      true,
    );
    expect(saved).not.toHaveBeenCalled();
    release(false);
    await submission;

    expect(localSave).not.toHaveBeenCalled();
    expect(saved).not.toHaveBeenCalled();
    expect(TestBed.inject(PopupStateStore).snapshot().statusMessage).toBe("");
    expect(member<any>(fixture.componentInstance, "cipherForm").disabled).toBe(
      false,
    );
  });

  it.each([undefined, "not-a-function"])(
    "fails closed when beforeSubmit is %s",
    async (beforeSubmit) => {
      const invalid = personalView(CipherType.Card);
      invalid.name = "";
      const fixture = await render(
        "edit",
        CipherType.Card,
        invalid,
        true,
        beforeSubmit,
      );
      Reflect.set(fixture.componentInstance, "beforeSubmit", beforeSubmit);
      const service = fixture.debugElement
        .query(By.directive(OfficialPersonalCipherFormComponent))
        .injector.get(RetainedPersonalCipherFormService);
      const localSave = vi.spyOn(service, "saveCipher");
      const saved = vi.fn();
      fixture.componentInstance.cipherSaved.subscribe(saved);

      await expect(fixture.componentInstance.submit()).resolves.toBeUndefined();

      expect(localSave).not.toHaveBeenCalled();
      expect(saved).not.toHaveBeenCalled();
      expect(TestBed.inject(PopupStateStore).snapshot().statusMessage).toBe("");
      expect(member<any>(fixture.componentInstance, "cipherForm").disabled).toBe(false);
    },
  );

  it("suppresses local save, toast, and output even when beforeSubmit returns true", async () => {
    const beforeSubmit = vi.fn(async () => true);
    const fixture = await render(
      "edit",
      CipherType.Card,
      personalView(CipherType.Card),
      true,
      beforeSubmit,
    );
    const service = fixture.debugElement
      .query(By.directive(OfficialPersonalCipherFormComponent))
      .injector.get(RetainedPersonalCipherFormService);
    const localSave = vi.spyOn(service, "saveCipher");
    const saved = vi.fn();
    fixture.componentInstance.cipherSaved.subscribe(saved);

    await fixture.componentInstance.submit();

    expect(beforeSubmit).toHaveBeenCalledOnce();
    expect(localSave).not.toHaveBeenCalled();
    expect(saved).not.toHaveBeenCalled();
    expect(TestBed.inject(PopupStateStore).snapshot().statusMessage).toBe("");
    expect(member<any>(fixture.componentInstance, "cipherForm").disabled).toBe(false);
  });

  it.each(
    (["add", "edit", "clone"] as const).flatMap((mode) =>
      ([CipherType.Card, CipherType.Identity] as const).map(
        (cipherType) => [mode, cipherType] as const,
      ),
    ),
  )(
    "keeps denied %s/%s secrets outside controls and restores only unchanged protected values",
    async (mode, cipherType) => {
      let submitted: CipherView | undefined;
      const fixture = await render(
        mode,
        cipherType,
        personalView(cipherType),
        false,
        async (cipher) => {
          submitted = cipher;
          return false;
        },
      );
      const host = fixture.nativeElement as HTMLElement;
      const deniedSelectors =
        cipherType === CipherType.Card
          ? ['input[formcontrolname="number"]', 'input[formcontrolname="code"]']
          : [
              'input[formcontrolname="ssn"]',
              'input[formcontrolname="passportNumber"]',
            ];
      for (const selector of deniedSelectors) {
        const control = host.querySelector<HTMLInputElement>(selector)!;
        expect(control.disabled).toBe(true);
        expect(control.value).toBe("");
        expect(control.type).toBe("password");
      }
      const hidden = host.querySelector<HTMLInputElement>(
        '[data-testid="custom-hidden-field"]',
      )!;
      expect(hidden.disabled).toBe(true);
      expect(hidden.value).toBe("");
      expect(host.textContent).not.toMatch(
        /4111 1111|111-22-3333|P1234567|9876/,
      );

      const name = host.querySelector<HTMLInputElement>(
        'input[formcontrolname="name"]',
      )!;
      setInput(name, "Unrelated edit");
      await fixture.componentInstance.submit();

      expect(submitted?.name).toBe("Unrelated edit");
      if (cipherType === CipherType.Card) {
        expect(submitted?.card.number).toBe("4111 1111 1111 1111");
        expect(submitted?.card.code).toBe("123");
      } else {
        expect(submitted?.identity.ssn).toBe("111-22-3333");
        expect(submitted?.identity.passportNumber).toBe("P1234567");
      }
      expect(
        submitted?.fields.find((field) => field.name === "PIN")?.value,
      ).toBe("9876");
    },
  );

  it("strips clone identity, key, attachments, organization, collections, archive, delete, and opaque state", async () => {
    let submitted: CipherView | undefined;
    const initial = personalView(CipherType.Identity);
    Object.assign(initial, {
      creationDate: new Date("2025-01-01T00:00:00.000Z"),
      revisionDate: new Date("2025-02-01T00:00:00.000Z"),
      passwordRevisionDate: new Date("2025-03-01T00:00:00.000Z"),
      permissions: { delete: true, restore: true },
      localData: { lastUsedDate: new Date("2025-04-01T00:00:00.000Z") },
      passwordHistory: [{ password: "old-secret" }],
      edit: true,
      viewPassword: true,
      organizationUseTotp: true,
      decryptionFailure: true,
      decryptionState: { failed: true },
      opaqueRuntimeState: "must-not-survive",
    });
    const fixture = await render(
      "clone",
      CipherType.Identity,
      initial,
      true,
      async (cipher) => {
        submitted = cipher;
        return false;
      },
    );

    await fixture.componentInstance.submit();

    expect(submitted?.id).toBeNull();
    expect(submitted?.key).toBeUndefined();
    expect(submitted?.attachments).toEqual([]);
    expect(submitted?.organizationId).toBeNull();
    expect(submitted?.collectionIds).toEqual([]);
    expect(submitted?.archivedDate).toBeNull();
    expect(submitted?.deletedDate).toBeNull();
    expect(submitted?.creationDate).toBeUndefined();
    expect(submitted?.revisionDate).toBeUndefined();
    expect(Reflect.get(submitted!, "passwordRevisionDate")).toBeUndefined();
    expect(submitted?.permissions).toBeUndefined();
    expect(submitted?.localData).toBeUndefined();
    expect(submitted?.passwordHistory).toEqual([]);
    expect(submitted?.edit).toBe(false);
    expect(submitted?.viewPassword).toBe(false);
    expect(submitted?.organizationUseTotp).toBe(false);
    expect(submitted?.decryptionFailure).toBe(false);
    expect(Reflect.get(submitted!, "decryptionState")).toBeUndefined();
    expect(Reflect.get(submitted!, "opaqueRuntimeState")).toBeUndefined();
    expect(Reflect.get(submitted!, "opaqueSentinel")).toBeUndefined();
    expect(submitted?.identity.firstName).toBe("Ada");
  });

  it.each([
    CipherType.Card,
    CipherType.Identity,
    CipherType.SecureNote,
  ] as const)(
    "strips hostile nested state from the %s clone passed to beforeSubmit",
    async (cipherType) => {
      let submitted: CipherView | undefined;
      const initial = personalView(cipherType);
      addNestedOpaqueState(initial);
      const expectedFields = initial.fields.map(({ name, value, type, linkedId }) => ({
        name,
        value,
        type,
        linkedId,
      }));
      const fixture = await render(
        "clone",
        cipherType,
        initial,
        true,
        async (cipher) => {
          submitted = cipher;
          return false;
        },
      );

      await fixture.componentInstance.submit();

      expect(submitted?.attachments).toEqual([]);
      expect(submitted?.passwordHistory).toEqual([]);
      for (const nested of [
        submitted!.card,
        submitted!.identity,
        submitted!.secureNote,
        ...submitted!.fields,
      ]) {
        expect(Reflect.get(nested, "opaqueNestedState")).toBeUndefined();
      }
      expect(
        submitted?.fields.map(({ name, value, type, linkedId }) => ({
          name,
          value,
          type,
          linkedId,
        })),
      ).toEqual(expectedFields);
      if (cipherType === CipherType.Card) {
        expect(submitted?.card.number).toBe("4111 1111 1111 1111");
        expect(submitted?.card.code).toBe("123");
      } else if (cipherType === CipherType.Identity) {
        expect(submitted?.identity.ssn).toBe("111-22-3333");
        expect(submitted?.identity.passportNumber).toBe("P1234567");
      } else {
        expect(submitted?.secureNote.type).toBe(SecureNoteType.Generic);
      }
    },
  );

  it("resets revealed denied controls when config is replaced", async () => {
    const fixture = await render(
      "edit",
      CipherType.Card,
      personalView(CipherType.Card),
    );
    const host = fixture.nativeElement as HTMLElement;
    const number = host.querySelector<HTMLInputElement>(
      'input[formcontrolname="number"]',
    )!;
    host.querySelector<HTMLButtonElement>(
      '[data-testid="visibility-for-card-number"]',
    )!.click();
    await settle(fixture);
    expect(number.type).toBe("text");

    nextConfig = buildOfficialPersonalCipherFormConfig({
      mode: "edit",
      cipherType: CipherType.Card,
      initial: personalView(CipherType.Card),
      folders: [],
      canViewSecrets: true,
    });
    fixture.detectChanges(false);
    await vi.waitFor(() =>
      expect(
        (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
          'input[formcontrolname="number"]',
        )?.type,
      ).toBe("password"),
    );
  });

  it("resets revealed Identity SSN and passport controls when config is replaced", async () => {
    const fixture = await render(
      "edit",
      CipherType.Identity,
      personalView(CipherType.Identity),
    );
    const host = fixture.nativeElement as HTMLElement;
    const selectors = [
      ['input[formcontrolname="ssn"]', '[data-testid="visibility-for-ssn"]'],
      [
        'input[formcontrolname="passportNumber"]',
        '[data-testid="visibility-for-passport-number"]',
      ],
    ] as const;
    for (const [inputSelector, buttonSelector] of selectors) {
      host.querySelector<HTMLButtonElement>(buttonSelector)!.click();
      await settle(fixture);
      expect(host.querySelector<HTMLInputElement>(inputSelector)?.type).toBe("text");
    }

    nextConfig = buildOfficialPersonalCipherFormConfig({
      mode: "edit",
      cipherType: CipherType.Identity,
      initial: personalView(CipherType.Identity),
      folders: [],
      canViewSecrets: true,
    });
    fixture.detectChanges(false);

    await vi.waitFor(() => {
      for (const [inputSelector] of selectors) {
        expect(
          (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
            inputSelector,
          )?.type,
        ).toBe("password");
      }
    });
  });

  it("resets a revealed hidden custom field when config is replaced", async () => {
    const fixture = await render(
      "edit",
      CipherType.Card,
      personalView(CipherType.Card),
    );
    const host = fixture.nativeElement as HTMLElement;
    const hidden = host.querySelector<HTMLInputElement>(
      '[data-testid="custom-hidden-field"]',
    )!;
    host.querySelector<HTMLButtonElement>(
      '[data-testid="visibility-for-custom-hidden-field"]',
    )!.click();
    await settle(fixture);
    expect(hidden.type).toBe("text");

    nextConfig = buildOfficialPersonalCipherFormConfig({
      mode: "edit",
      cipherType: CipherType.Card,
      initial: personalView(CipherType.Card),
      folders: [],
      canViewSecrets: true,
    });
    fixture.detectChanges(false);

    await vi.waitFor(() =>
      expect(
        (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
          '[data-testid="custom-hidden-field"]',
        )?.type,
      ).toBe("password"),
    );
  });

  it("restores focus when the official custom-field dialog is cancelled", async () => {
    const fixture = await render(
      "edit",
      CipherType.Card,
      personalView(CipherType.Card),
    );
    const trigger = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLButtonElement>('[data-testid="add-field-button"]')!;
    trigger.focus();
    trigger.click();
    await settle(fixture);
    expect(TestBed.inject(CdkDialog).openDialogs).toHaveLength(1);
    const cancel = [
      ...document.querySelectorAll<HTMLButtonElement>(
        ".cdk-overlay-container button",
      ),
    ].find((button) => button.textContent?.trim() === "取消")!;
    cancel.click();
    await vi.waitFor(() =>
      expect(TestBed.inject(CdkDialog).openDialogs).toHaveLength(0),
    );
    expect(document.activeElement).toBe(trigger);
  });
});

async function render(
  mode: "add" | "edit" | "clone",
  cipherType: CipherType.Card | CipherType.Identity | CipherType.SecureNote,
  initial: CipherView,
  canViewSecrets = true,
  beforeSubmit: unknown = async () => true,
) {
  nextFormId = `personal-${mode}-${cipherType}`;
  nextConfig = buildOfficialPersonalCipherFormConfig({
    mode,
    cipherType,
    initial,
    folders: [
      FolderView.fromJSON({ id: null, name: "无文件夹" }),
      FolderView.fromJSON({ id: "folder-1", name: "Work" }),
    ],
    canViewSecrets,
  });
  nextBeforeSubmit = beforeSubmit;
  const hostFixture = TestBed.createComponent(
    OfficialPersonalFormHostComponent,
  );
  hostFixture.detectChanges();
  const form = directive(hostFixture, OfficialPersonalCipherFormComponent);
  await vi.waitFor(() => {
    expect({
      loading: member<boolean>(form, "loading"),
      initialized: member<boolean>(form, "_firstInitialized"),
    }).toEqual({ loading: false, initialized: true });
  });
  await settle(hostFixture);
  return Object.assign(hostFixture, { componentInstance: form });
}

function directive<T>(
  fixture: { debugElement: any },
  type: new (...args: any[]) => T,
): T {
  return fixture.debugElement.query(By.directive(type)).componentInstance as T;
}

async function settle(fixture: {
  whenStable(): Promise<unknown>;
  detectChanges(checkNoChanges?: boolean): void;
}): Promise<void> {
  for (const ref of TestBed.inject(CdkDialog).openDialogs) {
    ref.componentRef?.changeDetectorRef.detectChanges();
    Reflect.get(ref.containerInstance, "_changeDetectorRef").detectChanges();
  }
  await fixture.whenStable();
  await Promise.resolve();
  fixture.detectChanges(false);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function member<T>(target: object, name: string): T {
  return Reflect.get(target, name) as T;
}

function setInput(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function personalView(
  cipherType: CipherType.Card | CipherType.Identity | CipherType.SecureNote,
): CipherView {
  const linkedId =
    cipherType === CipherType.Card
      ? CardLinkedId.Number
      : IdentityLinkedId.Email;
  const view = CipherView.fromJSON({
    id: "cipher-1",
    type: cipherType,
    name: `${personalTypeName(cipherType)} item`,
    folderId: "folder-1",
    favorite: true,
    reprompt: 1,
    organizationId: "org-1",
    collectionIds: ["collection-1"],
    archivedDate: "2026-01-01T00:00:00.000Z",
    deletedDate: "2026-01-02T00:00:00.000Z",
    key: "2.key|mac",
    attachments: [{ id: "attachment-1", fileName: "opaque.txt" }],
    fields: [
      { name: "Environment", value: "staging", type: FieldType.Text },
      { name: "PIN", value: "9876", type: FieldType.Hidden },
      { name: "Enabled", value: "true", type: FieldType.Boolean },
      ...(cipherType === CipherType.SecureNote
        ? []
        : [
            {
              name: "Official linked field",
              value: null,
              type: FieldType.Linked,
              linkedId,
            },
          ]),
    ],
    card: {
      cardholderName: "Ada Lovelace",
      brand: "Visa",
      number: "4111 1111 1111 1111",
      expMonth: "4",
      expYear: "29",
      code: "123",
    },
    identity: {
      title: "Dr",
      firstName: "Ada",
      middleName: "Byron",
      lastName: "Lovelace",
      username: "ada",
      company: "Analytical Engines",
      ssn: "111-22-3333",
      passportNumber: "P1234567",
      licenseNumber: "DL-42",
      email: "ada@example.test",
      phone: "+44 20 0000 0000",
      address1: "1 Engine Way",
      address2: "Suite 2",
      address3: "North Wing",
      city: "London",
      state: "London",
      postalCode: "SW1A 1AA",
      country: "GB",
    },
    secureNote: { type: SecureNoteType.Generic },
    notes: "Private notes",
  })!;
  Reflect.set(view, "opaqueSentinel", "must-not-survive");
  return view;
}

function addNestedOpaqueState(view: CipherView): void {
  Reflect.set(view.card, "opaqueNestedState", "card-sentinel");
  Reflect.set(view.identity, "opaqueNestedState", "identity-sentinel");
  Reflect.set(view.secureNote, "opaqueNestedState", "secure-note-sentinel");
  for (const field of view.fields) {
    Reflect.set(field, "opaqueNestedState", `field-${field.name}`);
  }
  Reflect.set(view.attachments[0], "opaqueNestedState", "attachment-sentinel");
  view.passwordHistory = [
    Object.assign(
      {
        password: "old-secret",
        lastUsedDate: new Date("2025-01-01T00:00:00.000Z"),
      },
      { opaqueNestedState: "history-sentinel" },
    ),
  ];
}

function personalTypeName(cipherType: number): string {
  if (cipherType === CipherType.Card) return "Card";
  if (cipherType === CipherType.Identity) return "Identity";
  return "SecureNote";
}
