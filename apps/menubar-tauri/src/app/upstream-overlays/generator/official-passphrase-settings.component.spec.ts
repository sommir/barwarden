import "zone.js";
import "@angular/compiler";

import { BrowserTestingModule, platformBrowserTesting } from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { BehaviorSubject, map } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Account } from "@bitwarden/common/auth/abstractions/account.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { CredentialGeneratorService } from "@bitwarden/generator-core";
import { PassphraseSettingsComponent as OfficialPassphraseSettingsComponent } from "@bitwarden/generator-overlay/passphrase-settings";

import type { GeneratorSettingsSnapshot } from "../../generator/generator.service";
import { OfficialI18nService } from "../../official-ui/official-i18n.service";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) throw error;
}

describe("OfficialPassphraseSettingsComponent", () => {
  afterEach(() => TestBed.resetTestingModule());

  it("retains the official passphrase card order and fields", async () => {
    const { fixture } = createFixture();
    await render(fixture);
    const host = fixture.nativeElement as HTMLElement;
    const cards = host.querySelectorAll("bit-section bit-card");
    const words = host.querySelector<HTMLInputElement>('#num-words')!;

    expect(cards).toHaveLength(2);
    expect(words.closest("bit-form-field")?.textContent).toContain("3 到 20");
    expect(host.querySelector<HTMLInputElement>('#word-separator')?.maxLength).toBe(1);
    expect(cards[1]?.textContent).toContain("首字母大写");
    expect(cards[1]?.textContent).toContain("包含数字");
  });

  it.each([3, 20])("emits an immutable snapshot at %s words", async (numWords) => {
    const original = passphrase();
    const { fixture } = createFixture(original);
    const emitted = vi.fn();
    fixture.componentInstance.onUpdated.subscribe(emitted);
    await render(fixture);
    const input = fixture.nativeElement.querySelector<HTMLInputElement>("#num-words")!;

    input.value = String(numWords);
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new Event("change"));
    await render(fixture);

    expect(emitted).toHaveBeenLastCalledWith(expect.objectContaining({ numWords }));
    expect(emitted.mock.calls.at(-1)?.[0]).not.toBe(original);
    expect(original.numWords).toBe(6);
  });

  it("limits separators to one character in emitted settings", async () => {
    const { fixture } = createFixture();
    const emitted = vi.fn();
    fixture.componentInstance.onUpdated.subscribe(emitted);
    await render(fixture);
    const input = fixture.nativeElement.querySelector<HTMLInputElement>("#word-separator")!;

    expect(input.maxLength).toBe(1);
    input.value = "_";
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new Event("change"));
    await render(fixture);

    expect(emitted).toHaveBeenLastCalledWith(expect.objectContaining({ wordSeparator: "_" }));
  });
});

function createFixture(settings = passphrase()) {
  const state = new BehaviorSubject(settings) as BehaviorSubject<typeof settings> & {
    withConstraints$: ReturnType<BehaviorSubject<typeof settings>["pipe"]>;
  };
  state.withConstraints$ = state.pipe(map((value) => ({
    state: value,
    constraints: {
      policyInEffect: false,
      numWords: { min: 3, max: 20, recommendation: 6 },
      wordSeparator: { maxLength: 1 },
      capitalize: { readonly: false },
      includeNumber: { readonly: false },
    },
  })));
  const generator = {
    settings: vi.fn(() => state),
    policy$: vi.fn(() => state.withConstraints$.pipe(map(({ constraints }) => ({ constraints })))),
  };
  TestBed.configureTestingModule({
    imports: [OfficialPassphraseSettingsComponent],
    providers: [
      OfficialI18nService,
      { provide: I18nService, useExisting: OfficialI18nService },
      { provide: CredentialGeneratorService, useValue: generator },
      { provide: LogService, useValue: { debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() } },
    ],
  });
  const fixture = TestBed.createComponent(OfficialPassphraseSettingsComponent);
  fixture.componentRef.setInput("account", { id: "account-a" } as Account);
  return { fixture, state };
}

function passphrase(patch: Partial<GeneratorSettingsSnapshot["passphrase"]> = {}): GeneratorSettingsSnapshot["passphrase"] {
  return { numWords: 6, wordSeparator: "-", capitalize: false, includeNumber: false, ...patch };
}

async function render(fixture: ReturnType<typeof TestBed.createComponent<OfficialPassphraseSettingsComponent>>) {
  fixture.detectChanges(false);
  await fixture.whenStable();
  fixture.changeDetectorRef.detectChanges();
}
