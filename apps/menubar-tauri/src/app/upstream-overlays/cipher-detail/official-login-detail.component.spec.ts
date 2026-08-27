import "zone.js";
import "@angular/compiler";

import { webcrypto } from "node:crypto";

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
import { projectLoginDetail } from "../../vault/login-cipher-view.adapter";
import { OFFICIAL_TOTP_CLOCK } from "../../vault/official-totp.service.adapter";
import { generateTotpCode } from "../../vault/totp.service";
import { OfficialLoginDetailComponent } from "./official-login-detail.component";
import { OfficialLoginCredentialsComponent } from "./official-login-credentials.component";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("OfficialLoginDetailComponent", () => {
  beforeEach(async () => {
    vi.stubGlobal("crypto", webcrypto);
    await TestBed.configureTestingModule({
      imports: [OfficialLoginDetailComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        { provide: OFFICIAL_TOTP_CLOCK, useValue: () => 1_700_000_000 },
      ],
    }).compileComponents();
  });

  it("renders the retained official Login child order without excluded feature branches", async () => {
    const fixture = TestBed.createComponent(OfficialLoginDetailComponent);
    fixture.componentRef.setInput("projection", projectLoginDetail(loginItem()));
    fixture.componentRef.setInput("canFill", true);
    fixture.detectChanges();
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    await Promise.resolve();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const root = host.querySelector<HTMLElement>("[data-testid=official-login-detail]")!;
    expect([...root.children].map((child) => child.tagName.toLowerCase())).toEqual([
      "official-item-details",
      "official-login-credentials",
      "official-login-uri-options",
      "app-additional-options",
      "official-custom-fields",
      "app-item-history-v2",
    ]);
    expect(host.querySelector("app-cipher-view")).toBeNull();
    expect(host.textContent).not.toMatch(/通行密钥|附件|SSH|高级版|自动填充按钮/);
    expect(host.querySelector("bw-vault-detail-section")).toBeNull();
    expect(host.querySelector("bw-vault-detail-field")).toBeNull();
    expect(root.querySelector("official-item-details")?.classList)
      .toContain("official-detail-identity-duplicate");
    expect(root.querySelector("[data-testid='official-item-identity']")?.getAttribute("aria-hidden"))
      .toBe("true");
  });

  it("preserves official field IDs, test IDs, hidden defaults, order, and metadata", async () => {
    const fixture = TestBed.createComponent(OfficialLoginDetailComponent);
    fixture.componentRef.setInput("projection", projectLoginDetail(loginItem()));
    fixture.componentRef.setInput("canFill", true);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const expectedTotp = await generateTotpCode("JBSWY3DPEHPK3PXP", 1_700_000_000);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(host.querySelector<HTMLInputElement>('#totp[data-testid="login-totp"]')?.value)
        .toBe(expectedTotp.formattedCode);
    });
    expect(host.querySelector('[data-testid="item-name"]')?.textContent).toContain("Example Login");
    expect(host.textContent).toContain("Work");
    expect(host.querySelector<HTMLInputElement>('#userName[data-testid="login-username"]')?.value)
      .toBe("user@example.test");
    expect(host.querySelector<HTMLInputElement>('#password[data-testid="login-password"]')?.type)
      .toBe("password");
    expect([...host.querySelectorAll<HTMLInputElement>('[data-testid="login-website"]')]
      .map((input) => input.value))
      .toEqual(["example.test", "admin.example.test"]);
    expect(host.querySelectorAll('[data-testid="custom-field"]')).toHaveLength(5);
    expect(host.querySelector<HTMLInputElement>('official-custom-fields input[type="password"]')?.type).toBe("password");
    expect(host.querySelector('official-custom-fields textarea[aria-label]')?.getAttribute("aria-label"))
      .toContain("Empty");
    const linkedField = host.querySelectorAll<HTMLElement>('[data-testid="custom-field"]')[4]!;
    expect(linkedField.textContent).toContain("链接型: Account name");
    expect(linkedField.querySelector<HTMLInputElement>("input[readonly]")?.value).toBe("用户名");
    expect(linkedField.querySelector("button")).toBeNull();
    expect(host.querySelector<HTMLTextAreaElement>("#notes")?.value).toBe("A private note");
    expect(host.textContent).toContain("2026");
    expect(host.querySelector("app-item-history-v2 button")?.textContent).toContain("密码历史记录");
  });

  it("emits exact typed action fields and leaves current TOTP resolution to VaultActionsService", async () => {
    const fixture = TestBed.createComponent(OfficialLoginDetailComponent);
    const copyField = vi.fn<(field: VaultField) => void>();
    const fillField = vi.fn<(field: VaultField) => void>();
    const launchUri = vi.fn<(uri: string) => void>();
    fixture.componentInstance.copyField.subscribe(copyField);
    fixture.componentInstance.fillField.subscribe(fillField);
    fixture.componentInstance.launchUri.subscribe(launchUri);
    fixture.componentRef.setInput("projection", projectLoginDetail(loginItem()));
    fixture.componentRef.setInput("canFill", true);
    fixture.detectChanges();
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    await Promise.resolve();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLButtonElement>('[data-testid="copy-username"]')!.click();
    host.querySelector<HTMLButtonElement>('[data-testid="fill-password"]')!.click();
    host.querySelector<HTMLButtonElement>('[data-testid="copy-totp"]')!.click();
    host.querySelector<HTMLButtonElement>('[data-testid="launch-website"]')!.click();

    expect(copyField).toHaveBeenCalledWith(expect.objectContaining({ id: "username" }));
    expect(copyField).toHaveBeenCalledWith({
      id: "otp",
      label: "Authenticator key",
      value: "JBSWY3DPEHPK3PXP",
      type: "totp",
    });
    expect(copyField).not.toHaveBeenCalledWith(expect.objectContaining({ type: "text" }));
    expect(fillField).toHaveBeenCalledWith(expect.objectContaining({ id: "password" }));
    expect(launchUri).toHaveBeenCalledWith("https://example.test/login");
  });

  it("blocks browser selection copy across revealed detail plaintext", () => {
    const fixture = TestBed.createComponent(OfficialLoginDetailComponent);
    fixture.componentRef.setInput("projection", projectLoginDetail(loginItem()));
    fixture.componentRef.setInput("revealedFieldIds", new Set(["password", "custom:PIN"]));
    fixture.detectChanges();

    const password = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>("#password")!;
    expect(password.type).toBe("text");
    const copy = new Event("copy", { bubbles: true, cancelable: true });
    password.dispatchEvent(copy);

    expect(copy.defaultPrevented).toBe(true);
  });

  it("resets official password count state when the projected cipher changes", () => {
    const fixture = TestBed.createComponent(OfficialLoginDetailComponent);
    fixture.componentRef.setInput("projection", projectLoginDetail(loginItem()));
    fixture.detectChanges();
    const credentials = fixture.debugElement.query(By.directive(OfficialLoginCredentialsComponent))
      .componentInstance as OfficialLoginCredentialsComponent;
    credentials.showPasswordCount = true;

    fixture.componentRef.setInput(
      "projection",
      projectLoginDetail({ ...loginItem(), id: "login-2", name: "Second Login" }),
    );
    fixture.detectChanges();

    expect(credentials.showPasswordCount).toBe(false);
  });
});

function loginItem(): VaultItem {
  return {
    id: "login-1",
    type: "login",
    name: "Example Login",
    subtitle: "user@example.test",
    favorite: true,
    reprompt: false,
    folderId: "folder-1",
    folderName: "Work",
    organizationName: "",
    attachmentCount: 0,
    attachments: [],
    uris: [
      { id: "uri-1", uri: "https://example.test/login", matchType: "default" },
      { id: "uri-2", uri: "https://admin.example.test", matchType: "1" },
    ],
    fields: [
      { id: "username", label: "Username", value: "user@example.test" },
      { id: "password", label: "Password", value: "secret-value", type: "hidden", concealed: true },
      { id: "otp", label: "Authenticator key", value: "JBSWY3DPEHPK3PXP", type: "totp" },
      { id: "custom:Environment", label: "Environment", value: "staging", type: "text" },
      { id: "custom:PIN", label: "PIN", value: "1234", type: "hidden", concealed: true },
      { id: "custom:Enabled", label: "Enabled", value: "true", type: "boolean" },
      { id: "custom:Empty", label: "Empty", value: "", type: "text" },
      { id: "custom:Account name", label: "Account name", value: "", type: "linked", linkedId: 100 },
    ],
    createdDate: "2026-07-01T01:02:03.000Z",
    revisionDate: "2026-07-02T01:02:03.000Z",
    passwordRevisionDate: "2026-07-02T00:00:00.000Z",
    passwordHistory: [{ password: "old-secret", lastUsedDate: "2026-06-01T00:00:00.000Z" }],
    notes: "A private note",
    canLaunch: true,
    canFill: true,
    uri: "https://example.test/login",
  };
}
