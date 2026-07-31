import "zone.js";
import "@angular/compiler";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { provideRouter } from "@angular/router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { OfficialI18nService } from "../../official-ui/official-i18n.service";
import type { VaultField, VaultItem } from "../../vault/vault-item.model";
import { projectPersonalCipherDetail, type OfficialPersonalCipherProjection } from "../../vault/personal-cipher-view.adapter";
import { OfficialPersonalCipherDetailComponent } from "./official-personal-cipher-detail.component";
import { OfficialCardDetailsComponent } from "./official-card-details.component";
import { OfficialIdentitySectionsComponent } from "./official-identity-sections.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("OfficialPersonalCipherDetailComponent", () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OfficialPersonalCipherDetailComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();
  });

  it("renders Card through the pinned child order and emits the original number field", async () => {
    const fixture = renderPersonalDetail(cardProjection());
    const copyField = vi.fn<(field: VaultField) => void>();
    fixture.componentInstance.copyField.subscribe(copyField);
    fixture.detectChanges();

    expect(sectionSelectors(fixture.nativeElement)).toEqual([
      "official-item-details",
      "official-card-details",
      "app-additional-options",
      "official-custom-fields",
      "app-item-history-v2",
    ]);

    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="copy-number"]')!.click();
    expect(copyField).toHaveBeenCalledWith(cardProjection().actionFields.get("number"));
  });

  it("resets concealed Identity state when the projected item changes", async () => {
    const fixture = renderPersonalDetail(identityProjection("identity-a"));
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="ssn-toggle"]')!.click();
    fixture.detectChanges();
    expect(input(fixture.nativeElement, "ssn").type).toBe("text");

    fixture.componentRef.setInput("projection", identityProjection("identity-b"));
    fixture.detectChanges();
    expect(input(fixture.nativeElement, "ssn").type).toBe("password");
  });

  it("renders Secure Note only through shared pinned children", async () => {
    const fixture = renderPersonalDetail(secureNoteProjection());
    fixture.detectChanges();

    expect(sectionSelectors(fixture.nativeElement)).toEqual([
      "official-item-details",
      "app-additional-options",
      "official-custom-fields",
      "app-item-history-v2",
    ]);
    expect((fixture.nativeElement as HTMLElement).querySelector("official-secure-note-details")).toBeNull();
  });

  it("uses retained Card brand heading, expiration, number pipe, and protected output controls", () => {
    const fixture = renderPersonalDetail(cardProjection());
    const toggleReveal = vi.fn<(fieldId: string) => void>();
    fixture.componentInstance.toggleReveal.subscribe(toggleReveal);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector("official-card-details")).not.toBeNull();
    expect(host.querySelector("official-card-details read-only-cipher-card")).not.toBeNull();
    expect(host.querySelector("official-card-details h2")?.textContent).toContain("Visa");
    expect(input(host, "cardNumber").value).toBe("4111 1111 1111 1111");
    expect(input(host, "cardNumber").type).toBe("password");
    expect(input(host, "expiration").value).toBe("12 / 2030");
    expect(input(host, "securityCode").type).toBe("password");

    host.querySelector<HTMLButtonElement>('[data-testid="toggle-number"]')!.click();
    expect(toggleReveal).toHaveBeenCalledWith("number");
  });

  it("retains the official expired Card callout before item details", () => {
    const expired = cardItem("expired-card");
    const fixture = renderPersonalDetail(projectPersonalCipherDetail({
      ...expired,
      card: { ...expired.card!, expMonth: "01", expYear: "2000" },
    }));
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const callout = host.querySelector("bw-macos-alert-strip");
    expect(callout?.textContent).toContain("过期的支付卡");
    expect(callout?.textContent).toContain("如果您的支付卡已续期，请更新该卡的信息");
    expect(sectionSelectors(host).slice(0, 2)).toEqual([
      "bw-macos-alert-strip",
      "official-item-details",
    ]);
  });

  it("uses official Identity sections, derived rows, and typed action outputs", () => {
    const fixture = renderPersonalDetail(identityProjection("identity-a"));
    const copyField = vi.fn<(field: VaultField) => void>();
    fixture.componentInstance.copyField.subscribe(copyField);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector("official-identity-sections")).not.toBeNull();
    expect([...host.querySelectorAll("official-identity-sections h2")].map((node) => node.textContent?.trim()))
      .toEqual(["个人详细信息", "身份", "联系信息"]);
    expect(input(host, "fullName").value).toBe("Dr Ada Augusta Lovelace");
    expect(input(host, "ssn").type).toBe("password");
    const address = host.querySelector<HTMLTextAreaElement>("#address")!;
    expect(address.value).toBe("1 Computing Way\nSuite 2\nLondon, Greater London, SW1A 1AA\nGB");
    expect(address.rows).toBe(4);

    host.querySelector<HTMLButtonElement>('[data-testid="copy-ssn"]')!.click();
    expect(copyField).toHaveBeenCalledWith(identityProjection("identity-a").actionFields.get("ssn"));
  });

  it("blocks browser selection copy across personal detail plaintext", () => {
    const fixture = renderPersonalDetail(identityProjection("identity-a"));
    fixture.componentRef.setInput("revealedFieldIds", new Set(["ssn"]));
    fixture.detectChanges();

    const copy = new Event("copy", { bubbles: true, cancelable: true });
    input(fixture.nativeElement, "ssn").dispatchEvent(copy);

    expect(copy.defaultPrevented).toBe(true);
  });

  it("resets child-local reveal state when the projected cipher changes", () => {
    const fixture = renderPersonalDetail(cardProjection("card-a"));
    fixture.detectChanges();
    const cardDetails = fixture.debugElement.query(By.directive(OfficialCardDetailsComponent))
      .componentInstance as OfficialCardDetailsComponent;
    cardDetails.revealCardNumber = true;

    fixture.componentRef.setInput("projection", cardProjection("card-b"));
    fixture.detectChanges();

    expect(cardDetails.revealCardNumber).toBe(false);
  });

  it("does not mutate externally owned Identity reveal state when the projection changes", () => {
    const fixture = renderPersonalDetail(identityProjection("identity-a"));
    const externalRevealState = new Set(["ssn"]);
    fixture.componentRef.setInput("revealedFieldIds", externalRevealState);
    fixture.detectChanges();

    fixture.componentRef.setInput("projection", identityProjection("identity-b"));
    fixture.detectChanges();

    expect(externalRevealState.has("ssn")).toBe(true);
  });
});

function renderPersonalDetail(projection: OfficialPersonalCipherProjection) {
  const fixture = TestBed.createComponent(OfficialPersonalCipherDetailComponent);
  fixture.componentRef.setInput("projection", projection);
  fixture.componentRef.setInput("canFill", true);
  return fixture;
}

function sectionSelectors(host: HTMLElement): string[] {
  const root = host.querySelector<HTMLElement>("[data-testid=official-personal-cipher-detail]")!;
  return [...root.children].map((child) => child.tagName.toLowerCase());
}

function input(host: HTMLElement, id: string): HTMLInputElement {
  return host.querySelector<HTMLInputElement>(`#${id}`)!;
}

function cardProjection(id = "card-a"): OfficialPersonalCipherProjection {
  return projectPersonalCipherDetail(cardItem(id));
}

function identityProjection(id: string): OfficialPersonalCipherProjection {
  return projectPersonalCipherDetail(identityItem(id));
}

function secureNoteProjection(): OfficialPersonalCipherProjection {
  return projectPersonalCipherDetail(secureNoteItem());
}

function baseItem(overrides: Partial<VaultItem>): VaultItem {
  return {
    id: "base-1",
    type: "card",
    name: "Personal item",
    subtitle: "",
    favorite: true,
    reprompt: true,
    folderId: "folder-1",
    folderName: "Personal",
    organizationName: "",
    attachmentCount: 0,
    attachments: [],
    uris: [],
    fields: [],
    createdDate: "2026-07-01T01:02:03.000Z",
    revisionDate: "2026-07-02T01:02:03.000Z",
    notes: "Private notes",
    canLaunch: false,
    canFill: false,
    uri: "",
    ...overrides,
  };
}

function cardItem(id: string): VaultItem {
  return baseItem({
    id,
    type: "card",
    card: {
      cardholderName: "Ada Lovelace",
      brand: "Visa",
      number: "4111111111111111",
      expMonth: "12",
      expYear: "2030",
      code: "123",
    },
    fields: [
      { id: "number", label: "Number", value: "4111111111111111", concealed: true, type: "hidden" },
      { id: "code", label: "Security code", value: "123", concealed: true, type: "hidden" },
      { id: "custom:Region", label: "Region", value: "APAC", type: "text" },
      { id: "custom:Number alias", label: "Number alias", value: "", type: "linked", linkedId: 305 },
    ],
  });
}

function identityItem(id: string): VaultItem {
  return baseItem({
    id,
    type: "identity",
    identity: {
      title: "Dr",
      firstName: "Ada",
      middleName: "Augusta",
      lastName: "Lovelace",
      username: "ada",
      company: "Analytical Engines",
      ssn: "111-22-3333",
      passportNumber: "P123456",
      licenseNumber: "L123456",
      email: "ada@example.test",
      phone: "+1 555 0100",
      address1: "1 Computing Way",
      address2: "Suite 2",
      address3: "",
      city: "London",
      state: "Greater London",
      postalCode: "SW1A 1AA",
      country: "GB",
    },
    fields: [
      { id: "ssn", label: "Social security number", value: "111-22-3333", concealed: true, type: "hidden" },
      { id: "passport-number", label: "Passport number", value: "P123456", concealed: true, type: "hidden" },
      { id: "custom:Email alias", label: "Email alias", value: "", type: "linked", linkedId: 406 },
    ],
  });
}

function secureNoteItem(): VaultItem {
  return baseItem({
    id: "note-1",
    type: "secure-note",
    secureNote: { type: 0 },
    fields: [{ id: "custom:Region", label: "Region", value: "EU", type: "text" }],
  });
}
