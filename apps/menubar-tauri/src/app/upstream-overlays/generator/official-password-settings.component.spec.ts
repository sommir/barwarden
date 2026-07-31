import "zone.js";
import "@angular/compiler";

import { BrowserTestingModule, platformBrowserTesting } from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { BehaviorSubject, map } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Account } from "@bitwarden/common/auth/abstractions/account.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { CredentialGeneratorService } from "@bitwarden/generator-core";
import { PasswordSettingsComponent as OfficialPasswordSettingsComponent } from "@bitwarden/generator-overlay/password-settings";

import type { GeneratorSettingsSnapshot } from "../../generator/generator.service";
import { OfficialI18nService } from "../../official-ui/official-i18n.service";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) throw error;
}

describe("OfficialPasswordSettingsComponent", () => {
  afterEach(() => TestBed.resetTestingModule());

  it("retains the official password card order, labels, and exact boundaries", async () => {
    const { fixture } = createFixture();
    await render(fixture);
    const host = fixture.nativeElement as HTMLElement;
    const cards = host.querySelectorAll("bit-section bit-card");

    expect(cards).toHaveLength(2);
    expect(cards[0]?.textContent).toContain("长度");
    expect(cards[1]?.textContent).toContain("包括");
    expect(cards[1]?.textContent).toContain("A-Z");
    expect(cards[1]?.textContent).toContain("a-z");
    expect(cards[1]?.textContent).toContain("0-9");
    expect(cards[1]?.textContent).toContain("!@#$%^&*");
    const length = host.querySelector<HTMLInputElement>('input[formcontrolname="length"]')!;
    expect([length.min, length.max]).toEqual(["5", "128"]);
  });

  it.each([5, 128])("emits an immutable settings snapshot at length %s", async (length) => {
    const original = password();
    const { fixture } = createFixture(original);
    const emitted = vi.fn();
    fixture.componentInstance.onUpdated.subscribe(emitted);
    await render(fixture);

    changeInput(fixture.nativeElement, "length", String(length));
    await render(fixture);

    expect(emitted).toHaveBeenLastCalledWith(expect.objectContaining({ length }));
    expect(emitted.mock.calls.at(-1)?.[0]).not.toBe(original);
    expect(original.length).toBe(14);
  });

  it("keeps the number class enabled when its official minimum is nonzero", async () => {
    const { fixture } = createFixture(password({ uppercase: false, number: false, special: false }));
    const emitted = vi.fn();
    fixture.componentInstance.onUpdated.subscribe(emitted);
    await render(fixture);

    changeCheckbox(fixture.nativeElement, "lowercase", false);
    await render(fixture);

    expect(emitted).toHaveBeenLastCalledWith(expect.objectContaining({
      uppercase: false,
      lowercase: false,
      number: true,
      minNumber: 1,
      special: false,
    }));
  });
});

function createFixture(settings = password()) {
  const state = new BehaviorSubject(settings) as BehaviorSubject<typeof settings> & {
    withConstraints$: ReturnType<BehaviorSubject<typeof settings>["pipe"]>;
  };
  state.withConstraints$ = state.pipe(map((value) => ({
    state: value,
    constraints: {
      policyInEffect: false,
      length: { min: 5, max: 128, recommendation: 14 },
      minNumber: { min: 0, max: 9 },
      minSpecial: { min: 0, max: 9 },
      uppercase: { readonly: false },
      lowercase: { readonly: false },
      number: { readonly: false },
      special: { readonly: false },
    },
  })));
  const generator = {
    settings: vi.fn(() => state),
    policy$: vi.fn(() => state.withConstraints$.pipe(map(({ constraints }) => ({ constraints })))),
  };
  TestBed.configureTestingModule({
    imports: [OfficialPasswordSettingsComponent],
    providers: [
      OfficialI18nService,
      { provide: I18nService, useExisting: OfficialI18nService },
      { provide: CredentialGeneratorService, useValue: generator },
    ],
  });
  const fixture = TestBed.createComponent(OfficialPasswordSettingsComponent);
  fixture.componentRef.setInput("account", { id: "account-a" } as Account);
  return { fixture, state };
}

function password(patch: Partial<GeneratorSettingsSnapshot["password"]> = {}): GeneratorSettingsSnapshot["password"] {
  return {
    length: 14, ambiguous: true, uppercase: true, minUppercase: 1,
    lowercase: true, minLowercase: 1, number: true, minNumber: 1,
    special: false, minSpecial: 0, ...patch,
  };
}

function changeInput(host: HTMLElement, control: string, value: string): void {
  const input = host.querySelector<HTMLInputElement>(`input[formcontrolname="${control}"]`)!;
  input.value = value;
  input.dispatchEvent(new Event("input"));
  input.dispatchEvent(new Event("change"));
}

function changeCheckbox(host: HTMLElement, control: string, checked: boolean): void {
  const input = host.querySelector<HTMLInputElement>(`input[formcontrolname="${control}"]`)!;
  input.checked = checked;
  input.dispatchEvent(new Event("change"));
}

async function render(fixture: ReturnType<typeof TestBed.createComponent<OfficialPasswordSettingsComponent>>) {
  fixture.detectChanges(false);
  await fixture.whenStable();
  fixture.changeDetectorRef.detectChanges();
}
