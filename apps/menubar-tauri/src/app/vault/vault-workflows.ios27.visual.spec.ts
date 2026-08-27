import "zone.js";
import "@angular/compiler";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Component, importProvidersFrom, provideZoneChangeDetection } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { NgSelectModule } from "@ng-select/ng-select";
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { provideNoopAnimations } from "@angular/platform-browser/animations";
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from "@angular/router";
import { BehaviorSubject } from "rxjs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { CipherType, FieldType } from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { DialogModule } from "@bitwarden/components/dialog/dialog.module";

import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { GeneratorService } from "../generator/generator.service";
import { PopupStateStore } from "../popup-state";
import { POP_OUT_HOST } from "../popup-header-actions.component";
import { SettingsService } from "../settings/settings.service";
import { OfficialPersonalCipherFormComponent } from "../upstream-overlays/cipher-form/official-personal-cipher-form.component";
import { OfficialPasswordHistoryViewComponent } from "../upstream-overlays/recovery/password-history/official-password-history-view.component";
import { RetainedVaultListItemComponent } from "../upstream-overlays/vault-main/retained-vault-list-item.component";
import { demoFolders, demoVaultItems } from "../vault-demo";
import { ArchivePageComponent } from "./archive-page.component";
import {
  RETAINED_LOGIN_FORM_GENERATOR,
  RETAINED_LOGIN_FORM_STATUS_STORE,
} from "./retained-login-form.adapter";
import { NewItemPageComponent } from "./new-item-page.component";
import { FoldersPageComponent } from "./folders-page.component";
import { projectLoginDetail } from "./login-cipher-view.adapter";
import { OtpCodeRowComponent } from "./otp-code-row.component";
import { toRetainedPopupCipherView } from "./popup-cipher-view.adapter";
import {
  buildOfficialPersonalCipherFormConfig,
  type RetainedOfficialPersonalCipherFormConfig,
} from "./retained-personal-cipher-form.adapter";
import { TOTP_CLOCK, TOTP_CODE_SOURCE } from "./vault-totp-code.component";
import type { VaultItem } from "./vault-item.model";
import { TrashPageComponent } from "./trash-page.component";
import { VaultDetailFieldComponent } from "./vault-detail-field.component";
import { VaultAddEditPageComponent } from "./vault-add-edit-page.component";
import { VaultFacade } from "./vault.facade";
import { VaultItemDetailPageComponent } from "./vault-item-detail-page.component";
import { VaultActionsService } from "./vault-actions.service";
import { VaultRepromptService } from "./vault-reprompt.service";
import { AUTOFILL_NATIVE_HOST } from "../autofill/autofill-native.host";
import { AUTOFILL_CONTEXT_CLOCK } from "../autofill/autofill-context-session.service";
import { OFFICIAL_TOTP_CLOCK } from "./official-totp.service.adapter";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

@Component({
  imports: [NgSelectModule, OfficialPersonalCipherFormComponent, VaultDetailFieldComponent],
  template: `
    <main class="macos-page--vault-form">
      <div class="cipher-form-scroll">
        <bw-official-personal-cipher-form
          formId="visual-personal-form"
          [config]="config"
          [beforeSubmit]="beforeSubmit"
        ></bw-official-personal-cipher-form>
        <ng-select
          class="visual-multi-select"
          [items]="multiSelectItems"
          bindLabel="listName"
          [multiple]="true"
        ></ng-select>
      </div>
    </main>
    <aside data-testid="outside-sheet">
      <ng-select
        [items]="multiSelectItems"
        bindLabel="listName"
        [multiple]="true"
      ></ng-select>
    </aside>
    <section class="macos-page--vault-detail">
      <bw-vault-detail-field
        [field]="detailField"
        [value]="detailField.value"
        conceal
        canFill
      />
    </section>
  `,
})
class VaultFormVisualHostComponent {
  readonly multiSelectItems = [
    { id: "collection-1", listName: "Personal", labelName: "Personal" },
  ];
  readonly config: RetainedOfficialPersonalCipherFormConfig =
    buildOfficialPersonalCipherFormConfig({
      mode: "add",
      cipherType: CipherType.Card,
      initial: CipherView.fromJSON({ type: CipherType.Card, name: "Visual Card", card: {} })!,
      folders: [],
      canViewSecrets: true,
    });
  readonly beforeSubmit = async () => false;
  readonly detailField = {
    id: "hostile-read-only-password",
    label: "Password with a label that must wrap at two hundred percent text",
    value: "correct horse battery staple",
    type: "hidden" as const,
    concealed: true,
  };
}

@Component({
  imports: [RetainedVaultListItemComponent],
  template: `
    <main class="macos-page macos-page--vault-list">
      <section class="macos-list">
        <app-retained-vault-list-item [cipher]="cipher" sectionId="favorites" />
      </section>
    </main>
  `,
})
class VaultRowVisualHostComponent {
  readonly cipher = toRetainedPopupCipherView({
    ...demoVaultItems[0]!,
    name: "GitHub Enterprise Production Credential With A Deliberately Hostile Long Name",
    subtitle: "operations-team-with-a-deliberately-long-address@example.enterprise.test",
  });
}

@Component({
  imports: [OtpCodeRowComponent],
  template: `
    <main class="macos-page macos-page--otp">
      <bw-otp-code-row [item]="item" [field]="field" [copied]="copied" />
    </main>
  `,
})
class OtpRowVisualHostComponent {
  protected readonly item = {
    ...demoVaultItems[0]!,
    id: "private-row-id-that-must-not-be-announced",
    name: "Enterprise Production Verification Account With A Deliberately Hostile Long Name",
    subtitle: "operations-team-with-a-deliberately-long-address@example.enterprise.test",
  };
  protected readonly field = this.item.fields.find((candidate) => candidate.id === "otp")!;
  protected copied = false;
}

@Component({
  imports: [OfficialPasswordHistoryViewComponent],
  template: `
    <main class="macos-page macos-page--vault-recovery">
      <bw-official-password-history-view [cipher]="cipher" />
    </main>
  `,
})
class PasswordHistoryVisualHostComponent {
  readonly cipher = projectLoginDetail(passwordHistoryItem()).cipher;
}

let style: HTMLStyleElement;

// Keep the official Item/ItemContent host utilities in this mounted test. The
// checked-in application stylesheet is loaded afterwards, matching production
// cascade order and exposing collisions with legacy global selectors.
const officialItemUtilityCss = `
  .tw-block { display: block; }
  .tw-flex { display: flex; }
  .tw-flex-1 { flex: 1 1 0%; }
  .tw-flex-col { flex-direction: column; }
  .tw-flex-grow { flex-grow: 1; }
  .tw-items-center { align-items: center; }
  .tw-items-start { align-items: flex-start; }
  .tw-w-full { width: 100%; }
  .tw-min-w-0 { min-width: 0; }
  .tw-overflow-hidden { overflow: hidden; }
  .tw-overflow-auto { overflow: auto; }
  .tw-text-wrap { white-space: normal; }
  .tw-break-words { overflow-wrap: break-word; }
  .tw-truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tw-py-2 { padding-top: 8px; padding-bottom: 8px; }
  .tw-py-1\\.5 { padding-top: 6px; padding-bottom: 6px; }
  .tw-p-3 { padding: 12px; }
  .-tw-mx-3 { margin-left: -12px; margin-right: -12px; }
  .tw-gap-4 { gap: 16px; }
  .tw-bg-background { background: rgb(248, 249, 251); }
  .tw-rounded-lg { border-radius: 8px; }
  .tw-text-base { font-size: 1rem; line-height: 1.5rem; }
  .tw-text-sm { font-size: 0.875rem; line-height: 1.25rem; }
  :root[data-bw-compact-mode="true"] [class~="bit-compact:tw-py-1.5"] {
    padding-top: 6px;
    padding-bottom: 6px;
  }
`;

beforeAll(() => {
  style = document.createElement("style");
  style.textContent = officialItemUtilityCss + [
    join(process.cwd(), "apps/menubar-tauri/src/styles/macos-tokens.css"),
    join(process.cwd(), "apps/menubar-tauri/src/styles/macos-motion.css"),
    join(
      process.cwd(),
      "vendor/bitwarden-clients/libs/components/src/multi-select/scss/bw.theme.css",
    ),
    join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"),
  ]
    .map((file) => readFileSync(file, "utf8"))
    .join("\n")
    .replace(/^@import[^;]+;\s*/gm, "")
    .replace(/:focus-visible/g, '[data-test-focus-visible="true"]');
  document.head.append(style);
  const rootStyle = getComputedStyle(document.documentElement);
  style.textContent = style.textContent.replace(/var\((--[\w-]+)\)/g, (value, name) =>
    resolveCustomProperty(rootStyle.getPropertyValue(name).trim(), rootStyle, new Set([name]))
      || value,
  );
  style.textContent += `\n${projectVaultInteractionAndMediaRules(style.sheet!)}`;
});
afterAll(() => { style.remove(); document.body.className = ""; document.body.replaceChildren(); });
afterEach(() => {
  document.body.classList.remove("tw-bit-compact");
  document.documentElement.removeAttribute("data-bw-compact-mode");
  document.documentElement.removeAttribute("data-vault-test-media");
  document.documentElement.style.removeProperty("font-size");
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function resolveCustomProperty(
  value: string,
  rootStyle: CSSStyleDeclaration,
  seen: Set<string>,
): string {
  return value.replace(/var\((--[\w-]+)\)/g, (reference, name) => {
    if (seen.has(name)) return reference;
    const next = rootStyle.getPropertyValue(name).trim();
    if (!next) return reference;
    return resolveCustomProperty(next, rootStyle, new Set([...seen, name]));
  });
}

function projectVaultInteractionAndMediaRules(sheet: CSSStyleSheet): string {
  const routeSelectors = [
    ".vault-list-row",
    ".otp-code-row",
    ".new-item-option",
    ".macos-page--vault-recovery",
    ".macos-page--vault-detail",
    ".macos-page--vault-form",
  ];
  const projected: string[] = [];
  for (const rule of Array.from(sheet.cssRules)) {
    if (rule.type === CSSRule.STYLE_RULE) {
      const styleRule = rule as CSSStyleRule;
      if (
        routeSelectors.some((selector) =>
          styleRule.selectorText.includes(selector)
        )
        && (/:(?:hover|active|focus)/.test(styleRule.selectorText)
          || styleRule.selectorText.includes("::before"))
      ) {
        projected.push(`${projectVaultSelector(styleRule.selectorText)} { ${styleRule.style.cssText} }`);
      }
      continue;
    }
    if (rule.type !== CSSRule.MEDIA_RULE) continue;
    const mediaRule = rule as CSSMediaRule;
    const media = mediaRule.conditionText.includes("prefers-reduced-motion")
      ? "reduced-motion"
      : mediaRule.conditionText.includes("forced-colors")
        ? "forced-colors"
        : null;
    if (!media) continue;
    for (const nestedRule of Array.from(mediaRule.cssRules)) {
      if (nestedRule.type !== CSSRule.STYLE_RULE) continue;
      const styleRule = nestedRule as CSSStyleRule;
      if (!routeSelectors.some((selector) =>
        styleRule.selectorText.includes(selector)
      )) continue;
      projected.push(
        `:root[data-vault-test-media="${media}"] :is(${projectVaultSelector(styleRule.selectorText)}) { ${styleRule.style.cssText} }`,
      );
    }
  }
  return projected.join("\n");
}

function projectVaultSelector(selector: string): string {
  return selector
    .replaceAll("::before", " > [data-vault-test-paint]")
    .replaceAll(":focus-visible", '[data-vault-test-interaction~="focus-visible"]')
    .replaceAll(":focus", '[data-vault-test-interaction~="focus"]')
    .replaceAll(":hover", '[data-vault-test-interaction~="hover"]')
    .replaceAll(":active", '[data-vault-test-interaction~="active"]');
}

function modeledVaultTextLayout(
  row: HTMLElement,
  content: HTMLElement,
  textNodes: readonly HTMLElement[],
  containerWidth: number,
) {
  const rootSize = effectiveTestRootSize();
  const actionWidth = Array.from(
    row.querySelectorAll<HTMLElement>('button[aria-label]:not([data-testid="vault-item-content"])'),
  ).reduce((total, action) => total + Math.max(
    cssTestPixels(getComputedStyle(action).minWidth, rootSize),
    cssTestPixels(getComputedStyle(action).width, rootSize),
  ), 0);
  const leading = row.querySelector<HTMLElement>(".item-icon");
  const leadingWidth = leading
    ? Math.max(
        cssTestPixels(getComputedStyle(leading).width, rootSize),
        cssTestPixels(getComputedStyle(leading).minWidth, rootSize),
      )
    : 0;
  const contentStyle = getComputedStyle(content);
  const availableWidth = Math.max(
    44,
    containerWidth
      - actionWidth
      - leadingWidth
      - cssTestPixels(contentStyle.paddingLeft, rootSize)
      - cssTestPixels(contentStyle.paddingRight, rootSize)
      - 24,
  );
  let lineCount = 0;
  let textHeight = 0;
  let horizontalClip = false;
  for (const node of textNodes) {
    const computed = getComputedStyle(node);
    const fontSize = cssTestPixels(computed.fontSize, rootSize) || rootSize * 0.875;
    const lineHeight = computed.lineHeight === "normal"
      ? fontSize * 1.3
      : cssTestPixels(computed.lineHeight, rootSize) || fontSize * 1.3;
    const estimatedTextWidth = (node.textContent?.trim().length ?? 0) * fontSize * 0.56;
    const lines = Math.max(1, Math.ceil(estimatedTextWidth / availableWidth));
    lineCount += lines;
    textHeight += lines * lineHeight;
    horizontalClip ||= computed.whiteSpace !== "normal"
      || ["hidden", "clip"].includes(computed.overflow)
      || !["anywhere", "break-word"].includes(computed.overflowWrap);
  }
  const rowStyle = getComputedStyle(row);
  const mainContent = row.querySelector<HTMLElement>("[data-item-main-content]");
  const mainStyle = mainContent ? getComputedStyle(mainContent) : null;
  const verticalClip = rowStyle.height !== "auto"
    || contentStyle.height !== "auto"
    || [rowStyle.overflow, contentStyle.overflow, mainStyle?.overflow]
      .some((overflow) => overflow === "hidden" || overflow === "clip");
  const padding = cssTestPixels(contentStyle.paddingTop, rootSize)
    + cssTestPixels(contentStyle.paddingBottom, rootSize);
  return {
    horizontalClip,
    verticalClip,
    lineCount,
    modeledHeight: verticalClip
      ? cssTestPixels(rowStyle.minHeight, rootSize)
      : Math.max(cssTestPixels(rowStyle.minHeight, rootSize), textHeight + padding),
  };
}

function effectiveTestRootSize(): number {
  const value = getComputedStyle(document.documentElement).fontSize;
  if (value.endsWith("%")) return 16 * Number.parseFloat(value) / 100;
  return cssTestPixels(value, 16) || 16;
}

function cssTestPixels(value: string | undefined, rootSize: number): number {
  if (!value) return 0;
  if (value.endsWith("rem")) return Number.parseFloat(value) * rootSize;
  if (value.endsWith("em")) return Number.parseFloat(value) * rootSize;
  if (value.endsWith("px")) return Number.parseFloat(value);
  return 0;
}

function modeledPasswordHistoryHeight(
  row: HTMLElement,
  content: HTMLElement,
  password: HTMLElement,
  date: HTMLElement,
) {
  const rootSize = effectiveTestRootSize();
  const rowStyle = getComputedStyle(row);
  const contentStyle = getComputedStyle(content);
  const mainStyle = getComputedStyle(row.querySelector<HTMLElement>("[data-item-main-content]")!);
  const lineHeight = (node: HTMLElement) => {
    const computed = getComputedStyle(node);
    return computed.lineHeight === "normal"
      ? cssTestPixels(computed.fontSize, rootSize) * 1.3
      : cssTestPixels(computed.lineHeight, rootSize);
  };
  const clipped = [
    rowStyle.overflow,
    contentStyle.overflow,
    mainStyle.overflow,
  ].some((overflow) => overflow === "hidden" || overflow === "clip")
    || rowStyle.height !== "auto"
    || contentStyle.height !== "auto";
  return {
    clipped,
    modeledHeight: clipped
      ? cssTestPixels(rowStyle.minHeight, rootSize)
      : Math.max(
        cssTestPixels(rowStyle.minHeight, rootSize),
        lineHeight(password)
          + lineHeight(date)
          + cssTestPixels(contentStyle.paddingTop, rootSize)
          + cssTestPixels(contentStyle.paddingBottom, rootSize),
      ),
  };
}

function assertRecoveryRow(row: HTMLElement, action: HTMLElement, hasMainContent = true): void {
  const group = row.parentElement as HTMLElement;
  const rowStyle = getComputedStyle(row);
  const actionStyle = getComputedStyle(action);
  const plate = action.querySelector<HTMLElement>(".bwi")!;
  expect.soft(row.classList).toContain("macos-row--double");
  expect.soft(rowStyle.minHeight).toBe("48px");
  expect.soft(rowStyle.height).toBe("auto");
  expect.soft(rowStyle.overflow).toBe("visible");
  expect.soft(rowStyle.marginBottom).toBe("0px");
  expect.soft(rowStyle.borderRadius).toBe("0px");
  expect.soft(rowStyle.boxShadow).toBe("none");
  expect.soft(getComputedStyle(group).boxShadow).toBe("none");
  expect.soft(action.classList).toContain("macos-hit-target");
  expect.soft(actionStyle.minWidth).toBe("44px");
  expect.soft(actionStyle.minHeight).toBe("44px");
  expect.soft(getComputedStyle(plate).width).toBe("32px");
  expect.soft(getComputedStyle(plate).height).toBe("32px");
  if (hasMainContent) {
    const content = row.querySelector<HTMLElement>(":is(bit-item-content, [bit-item-content])")!;
    expect.soft(getComputedStyle(content).minHeight).toBe("48px");
    expect.soft(getComputedStyle(content).height).toBe("auto");
    expect.soft(getComputedStyle(content).overflow).toBe("visible");
  }

  const initial = getComputedStyle(plate).backgroundColor;
  action.dataset["vaultTestInteraction"] = "hover";
  const hover = getComputedStyle(plate).backgroundColor;
  action.dataset["vaultTestInteraction"] = "active";
  const pressed = getComputedStyle(plate).backgroundColor;
  expect.soft(new Set([initial, hover, pressed]).size).toBe(3);
  expect.soft(getComputedStyle(action).backgroundColor).toMatch(/rgba?\(0, 0, 0(?:, 0)?\)/);
  action.dataset["vaultTestInteraction"] = "focus";
  expect.soft(getComputedStyle(action).outlineStyle).not.toBe("solid");
  action.removeAttribute("data-vault-test-interaction");
  action.dataset["testFocusVisible"] = "true";
  expect.soft(getComputedStyle(action).outlineStyle).not.toBe("solid");
  expect.soft(getComputedStyle(plate).outlineWidth).toBe("2px");
  action.removeAttribute("data-test-focus-visible");
  action.setAttribute("aria-disabled", "true");
  expect.soft(Number.parseFloat(getComputedStyle(plate).opacity)).toBeLessThan(1);
  expect.soft(getComputedStyle(action).backgroundColor).toMatch(/rgba?\(0, 0, 0(?:, 0)?\)/);
  action.removeAttribute("aria-disabled");

  document.body.classList.add("tw-bit-compact");
  expect.soft(getComputedStyle(row).minHeight).toBe("44px");
  expect.soft(getComputedStyle(plate).width).toBe("28px");
  expect.soft(getComputedStyle(plate).height).toBe("28px");
  document.body.classList.remove("tw-bit-compact");

  document.documentElement.style.fontSize = "200%";
  expect.soft(getComputedStyle(row).height).toBe("auto");
  expect.soft(getComputedStyle(row).overflow).toBe("visible");
  document.documentElement.style.removeProperty("font-size");

  document.documentElement.dataset["vaultTestMedia"] = "reduced-motion";
  expect.soft(getComputedStyle(plate).transitionDuration).toBe("0s");
  expect.soft(getComputedStyle(plate).transform).toBe("none");
  document.documentElement.dataset["vaultTestMedia"] = "forced-colors";
  action.dataset["testFocusVisible"] = "true";
  expect.soft(getComputedStyle(plate).forcedColorAdjust).toBe("none");
  expect.soft(getComputedStyle(plate).outlineWidth).toBe("2px");
  document.documentElement.removeAttribute("data-vault-test-media");
  action.removeAttribute("data-test-focus-visible");
}

function passwordHistoryItem(): VaultItem {
  return {
    id: "history-visual",
    type: "login",
    name: "Credential With A Deliberately Hostile Long Name",
    subtitle: "",
    favorite: false,
    folderId: "",
    folderName: "",
    organizationName: "",
    attachmentCount: 0,
    uris: [],
    fields: [],
    createdDate: "2026-07-01T00:00:00.000Z",
    revisionDate: "2026-07-01T00:00:00.000Z",
    passwordHistory: [{
      password: "old-secret-1",
      lastUsedDate: "2026-07-11T08:09:10.000Z",
    }],
    notes: "",
    canLaunch: false,
    canFill: false,
    uri: "",
  };
}

function visualLoginItem(): VaultItem {
  const base = demoVaultItems.find((item) => item.id === "github")!;
  return {
    ...base,
    name: "Production Login With A Deliberately Hostile Long Name",
    fields: [
      ...base.fields
        .filter((field) => !field.id.startsWith("custom:"))
        .map((field) => field.id === "username"
          ? {
              ...field,
              value: "operations-team-with-a-deliberately-long-address@example.enterprise.test",
            }
          : field),
      {
        id: "custom:Environment",
        label: "Environment With A Deliberately Hostile Label That Must Wrap",
        value: "Production value that must remain readable at two hundred percent text",
      },
      {
        id: "custom:PIN",
        label: "Emergency PIN With Another Long Label",
        value: "1234567890",
        type: "hidden",
        concealed: true,
      },
    ],
  };
}

function visualPersonalItem(): VaultItem {
  const base = demoVaultItems.find((item) => item.id === "card")!;
  return {
    ...base,
    fields: [
      ...base.fields,
      {
        id: "custom:Environment",
        label: "Card Environment With A Deliberately Hostile Label That Must Wrap",
        value: "Production value that remains readable at two hundred percent text",
      },
      {
        id: "custom:Enabled",
        label: "Enabled For Emergency Travel",
        value: "true",
        type: "boolean",
      },
    ],
  };
}

async function createRealVaultAddEditFixture(
  routePath: "add-cipher" | "edit-cipher" | "clone-cipher",
  type: "1" | "3",
  cipherId = "",
) {
  TestBed.resetTestingModule();
  const store = new PopupStateStore();
  store.setItems(
    [
      ...demoVaultItems.filter((item) => !["github", "card"].includes(item.id)),
      visualLoginItem(),
      visualPersonalItem(),
    ],
    demoFolders,
  );
  store.setUnlocked("visual@example.test");
  store.setActiveSession({ crypto: { userKeyB64: "visual-user-key" } } as never);
  const queryParamMap = convertToParamMap({ type, ...(cipherId ? { cipherId } : {}) });
  const queryParamMap$ = new BehaviorSubject(queryParamMap);
  await TestBed.configureTestingModule({
    imports: [VaultAddEditPageComponent],
    providers: [
      OfficialI18nService,
      importProvidersFrom(DialogModule),
      provideZoneChangeDetection(),
      provideNoopAnimations(),
      provideRouter([{ path: routePath, component: VaultAddEditPageComponent }]),
      { provide: I18nService, useExisting: OfficialI18nService },
      { provide: PopupStateStore, useValue: store },
      { provide: VaultFacade, useFactory: () => new VaultFacade(store) },
      { provide: RETAINED_LOGIN_FORM_GENERATOR, useExisting: GeneratorService },
      { provide: RETAINED_LOGIN_FORM_STATUS_STORE, useValue: store },
      { provide: POP_OUT_HOST, useValue: null },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: { routeConfig: { path: routePath }, queryParamMap },
          queryParamMap: queryParamMap$.asObservable(),
        },
      },
    ],
  }).compileComponents();
  const router = TestBed.inject(Router);
  Object.defineProperty(router, "url", {
    configurable: true,
    value: `/${routePath}?type=${type}${cipherId ? `&cipherId=${cipherId}` : ""}`,
  });
  vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);
  const fixture = TestBed.createComponent(VaultAddEditPageComponent);
  fixture.detectChanges();
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('input[formcontrolname="name"]'),
    ).not.toBeNull();
  });
  await fixture.whenStable();
  fixture.detectChanges(false);
  return fixture;
}

async function createRealVaultDetailFixture(location: "active" | "deleted" = "active") {
  TestBed.resetTestingModule();
  const store = new PopupStateStore();
  store.setUnlocked("visual@example.test");
  store.setItems(location === "active" ? [visualLoginItem()] : [], demoFolders);
  store.setDeletedItems(location === "deleted" ? [visualLoginItem()] : []);
  await TestBed.configureTestingModule({
    imports: [VaultItemDetailPageComponent],
    providers: [
      provideRouter([]),
      OfficialI18nService,
      { provide: I18nService, useExisting: OfficialI18nService },
      { provide: PopupStateStore, useValue: store },
      { provide: VaultFacade, useFactory: () => new VaultFacade(store) },
      {
        provide: VaultActionsService,
        useValue: {
          copyFieldWithOutcome: vi.fn(),
          fillFieldWithOutcome: vi.fn(),
          launchUriWithOutcome: vi.fn(),
          archiveItemWithOutcome: vi.fn(),
          deleteItemWithOutcome: vi.fn(),
          unarchiveItemWithOutcome: vi.fn(),
          deleteArchivedItemWithOutcome: vi.fn(),
          restoreDeletedItemWithOutcome: vi.fn(),
          permanentlyDeleteItemWithOutcome: vi.fn(),
        },
      },
      { provide: POP_OUT_HOST, useValue: null },
      {
        provide: AUTOFILL_NATIVE_HOST,
        useValue: {
          entryContext: vi.fn(async () => ({ status: "unavailable" })),
          agentSession: vi.fn(async () => ({ status: "unavailable" })),
          cancelReprompt: vi.fn(async () => undefined),
          cancelRepromptBatch: vi.fn(async () => undefined),
        },
      },
      { provide: AUTOFILL_CONTEXT_CLOCK, useValue: () => 1_700_000_000 },
      { provide: VaultRepromptService, useValue: { verify: vi.fn(async () => true) } },
      { provide: OFFICIAL_TOTP_CLOCK, useValue: () => 1_700_000_000 },
    ],
  }).compileComponents();
  const router = TestBed.inject(Router);
  Object.defineProperty(router, "url", { configurable: true, value: "/view-cipher/github" });
  vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);
  const fixture = TestBed.createComponent(VaultItemDetailPageComponent);
  fixture.componentRef.setInput("id", "github");
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges(false);
  return fixture;
}

function appendProjectedPrimaryPaint(owner: HTMLElement): HTMLElement {
  const paint = document.createElement("span");
  paint.dataset["vaultTestPaint"] = "true";
  paint.setAttribute("aria-hidden", "true");
  owner.prepend(paint);
  return paint;
}

function modeledPrimaryPaintHeight(owner: HTMLElement, paint: HTMLElement): number {
  const ownerHeight = cssTestPixels(getComputedStyle(owner).minHeight, effectiveTestRootSize());
  const paintStyle = getComputedStyle(paint);
  const logicalInset = paintStyle.insetBlock !== "" && paintStyle.insetBlock !== "auto"
    ? paintStyle.insetBlock
    : paintStyle.inset.split(" ")[0];
  const inset = cssTestPixels(logicalInset, effectiveTestRootSize());
  return ownerHeight - 2 * inset;
}

function accessibilityHidden(node: Element): boolean {
  for (let current: Element | null = node; current; current = current.parentElement) {
    if (current.getAttribute("aria-hidden") === "true") return true;
  }
  return false;
}

function modeledCustomFieldDistance(group: HTMLElement, row: HTMLElement): number {
  const rootSize = effectiveTestRootSize();
  const rowStyle = getComputedStyle(row);
  const childMargins = Array.from(
    row.querySelectorAll<HTMLElement>(":scope > bit-form-field, :scope > bit-form-control"),
    (field) => cssTestPixels(getComputedStyle(field).marginBottom, rootSize),
  );
  const rowGap = rowStyle.rowGap === "normal" ? rowStyle.gap : rowStyle.rowGap;
  return cssTestPixels(rowGap, rootSize)
    + Math.max(0, ...childMargins);
}

function modeledOtpRowLayout(row: HTMLElement, containerWidth: number) {
  const rootSize = effectiveTestRootSize();
  const rowStyle = getComputedStyle(row);
  const identity = row.querySelector<HTMLElement>(".otp-code-row__identity")!;
  const name = row.querySelector<HTMLElement>(".otp-code-row__name")!;
  const subtitle = row.querySelector<HTMLElement>(".otp-code-row__subtitle")!;
  const code = row.querySelector<HTMLElement>(".otp-code-row__code")!;
  const copy = row.querySelector<HTMLElement>(".otp-code-row__copy")!;
  const copyPlate = row.querySelector<HTMLElement>(".otp-code-row__copy-icon")!;
  const countdown = row.querySelector<HTMLElement>(".otp-code-row__countdown")!;
  const icon = row.querySelector<HTMLElement>(".otp-code-row__icon")!;
  const copyStyle = getComputedStyle(copy);
  const codeStyle = getComputedStyle(code);
  const codeFontSize = cssTestPixels(codeStyle.fontSize, rootSize) || rootSize * 1.125;
  const copyWidth = Math.max(
    cssTestPixels(copyStyle.minWidth, rootSize),
    (code.textContent?.trim().length ?? 0) * codeFontSize * 0.62
      + cssTestPixels(getComputedStyle(copyPlate).width, rootSize)
      + cssTestPixels(copyStyle.columnGap || copyStyle.gap, rootSize)
      + cssTestPixels(copyStyle.paddingLeft, rootSize)
      + cssTestPixels(copyStyle.paddingRight, rootSize),
  );
  const fixedWidth = cssTestPixels(rowStyle.paddingLeft, rootSize)
    + cssTestPixels(rowStyle.paddingRight, rootSize)
    + cssTestPixels(getComputedStyle(icon).width, rootSize)
    + cssTestPixels(getComputedStyle(countdown).width, rootSize)
    + copyWidth
    + 3 * cssTestPixels(rowStyle.columnGap || rowStyle.gap, rootSize);
  const identityWidth = containerWidth - fixedWidth;
  let identityHeight = 0;
  let lineCount = 0;
  let horizontalClip = false;
  for (const node of [name, subtitle]) {
    const computed = getComputedStyle(node);
    const fontSize = cssTestPixels(computed.fontSize, rootSize);
    const lineHeight = cssTestPixels(computed.lineHeight, rootSize) || fontSize * 1.3;
    const estimatedWidth = (node.textContent?.trim().length ?? 0) * fontSize * 0.56;
    const lines = Math.max(1, Math.ceil(estimatedWidth / Math.max(44, identityWidth)));
    lineCount += lines;
    identityHeight += lines * lineHeight;
    horizontalClip ||= computed.whiteSpace !== "normal"
      || ["hidden", "clip"].includes(computed.overflow)
      || !["anywhere", "break-word"].includes(computed.overflowWrap);
  }
  const verticalClip = rowStyle.height !== "auto"
    || [rowStyle.overflow, getComputedStyle(identity).overflow]
      .some((overflow) => overflow === "hidden" || overflow === "clip");
  const codeClip = [copyStyle.overflow, codeStyle.overflow]
    .some((overflow) => overflow === "hidden" || overflow === "clip");
  return {
    horizontalClip,
    verticalClip,
    codeClip,
    overlap: identityWidth < 44,
    lineCount,
    modeledHeight: verticalClip
      ? cssTestPixels(rowStyle.minHeight, rootSize)
      : Math.max(
          cssTestPixels(rowStyle.minHeight, rootSize),
          identityHeight
            + cssTestPixels(rowStyle.paddingTop, rootSize)
            + cssTestPixels(rowStyle.paddingBottom, rootSize),
        ),
  };
}

describe("iOS 27 Vault workflows", () => {
  it("keeps all five real New Item choices in order as continuous 48/44px growable actions", async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [NewItemPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(NewItemPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const group = getComputedStyle(host.querySelector<HTMLElement>(".new-item-grid")!);
    const options = Array.from(host.querySelectorAll<HTMLElement>(".new-item-option"));
    const row = getComputedStyle(options[0]!);
    expect(options.map((option) => option.dataset["popupFocusKey"])).toEqual([
      "new-item:type:1",
      "new-item:type:3",
      "new-item:type:4",
      "new-item:type:2",
      "new-item:folder",
    ]);
    expect(options.every((option) => option.classList.contains("macos-row--double"))).toBe(true);
    expect(options.every((option) => option.classList.contains("macos-pressable"))).toBe(true);
    expect(group.borderRadius).toBe("0px");
    expect(group.boxShadow).toBe("none");
    expect(group.rowGap).toBe("0px");
    expect(row.borderRadius).toBe("0px");
    expect(row.boxShadow).toBe("none");
    expect(row.minHeight).toBe("48px");
    expect(row.height).toBe("auto");
    expect(row.overflow).toBe("visible");
    expect(Number.parseFloat(row.minWidth)).toBeGreaterThanOrEqual(44);
    document.body.classList.add("tw-bit-compact");
    expect(getComputedStyle(host.querySelector<HTMLElement>(".new-item-option")!).minHeight)
      .toBe("44px");
    document.documentElement.style.fontSize = "200%";
    const scaled = getComputedStyle(options[0]!);
    expect(scaled.height).toBe("auto");
    expect(scaled.overflow).toBe("visible");
    expect(getComputedStyle(options[0]!.querySelector<HTMLElement>(".new-item-label")!).overflowWrap)
      .toBe("anywhere");
    expect(getComputedStyle(options[0]!.querySelector<HTMLElement>(".new-item-description")!).whiteSpace)
      .toBe("normal");
    fixture.destroy();
    document.body.className = "";
  });

  it("keeps real Folder rows and action owners continuous at 48/44px and growable at 200%", async () => {
    TestBed.resetTestingModule();
    const store = new PopupStateStore();
    store.setItems([], [{
      id: "work",
      name: "Work Folder With A Deliberately Hostile UnbrokenNameThatMustWrapAtTwoHundredPercent",
    }]);
    await TestBed.configureTestingModule({
      imports: [FoldersPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(FoldersPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const group = getComputedStyle(host.querySelector<HTMLElement>("bit-item-group")!);
    const row = getComputedStyle(host.querySelector<HTMLElement>("bit-item")!);
    expect(group.borderRadius).toBe("12px");
    expect(group.boxShadow).toBe("none");
    expect(row.borderRadius).toBe("0px");
    expect(row.marginBottom).toBe("0px");
    const item = host.querySelector<HTMLElement>("bit-item")!;
    const content = host.querySelector<HTMLElement>("bit-item-content")!;
    const contentText = content.querySelector<HTMLElement>("[bitTypography='body2'] > div:first-child")!;
    const edit = host.querySelector<HTMLElement>("[data-testid='edit-folder-work']")!;
    expect(item.classList).toContain("macos-row--double");
    expect(content.classList).toContain("macos-recovery-row__content");
    expect(getComputedStyle(content).paddingTop).toBe("0px");
    expect(getComputedStyle(content).paddingBottom).toBe("0px");
    expect(getComputedStyle(contentText).whiteSpace).toBe("normal");
    expect(getComputedStyle(contentText).overflow).not.toBe("hidden");
    expect(["anywhere", "break-word"]).toContain(getComputedStyle(contentText).overflowWrap);
    expect(row.minHeight).toBe("48px");
    expect(row.height).toBe("auto");
    expect(row.overflow).toBe("visible");
    expect(getComputedStyle(edit).minWidth).toBe("44px");
    expect(getComputedStyle(edit).minHeight).toBe("44px");
    assertRecoveryRow(item, edit);
    document.body.classList.add("tw-bit-compact");
    expect(getComputedStyle(host.querySelector<HTMLElement>("bit-item")!).minHeight).toBe("44px");
    expect(getComputedStyle(content).minHeight).toBe("44px");
    expect(getComputedStyle(content).paddingTop).toBe("0px");
    expect(getComputedStyle(content).paddingBottom).toBe("0px");
    document.documentElement.dataset["bwCompactMode"] = "true";
    expect(getComputedStyle(content).paddingTop).toBe("0px");
    expect(getComputedStyle(content).paddingBottom).toBe("0px");
    document.documentElement.style.fontSize = "200%";
    expect(getComputedStyle(item).height).toBe("auto");
    expect(getComputedStyle(item).overflow).toBe("visible");
    const modeled = modeledVaultTextLayout(item, content, [contentText], 260);
    expect(modeled.horizontalClip).toBe(false);
    expect(modeled.verticalClip).toBe(false);
    expect(modeled.lineCount).toBeGreaterThan(1);
    expect(modeled.modeledHeight).toBeGreaterThan(48);
    host.querySelector<HTMLButtonElement>("[data-testid='new-folder-button']")!.click();
    fixture.detectChanges();
    const sheet = getComputedStyle(host.querySelector<HTMLElement>(".app-bottom-sheet[open]")!);
    expect(sheet.borderRadius).toBe("16px 16px 0 0");
    fixture.destroy();
    document.body.className = "";
  });

  it("keeps real Archive, Trash, and Password History rows/actions on one recovery contract", async () => {
    TestBed.resetTestingModule();
    const store = new PopupStateStore();
    store.setArchivedItems([{ ...demoVaultItems[0]!, id: "archive-visual", name: "Archived Credential With A Deliberately Hostile Long Name" }]);
    store.setDeletedItems([{ ...demoVaultItems[0]!, id: "trash-visual", name: "Deleted Credential With A Deliberately Hostile Long Name" }]);
    await TestBed.configureTestingModule({
      imports: [ArchivePageComponent, TrashPageComponent],
      providers: [
        provideRouter([]),
        { provide: PopupStateStore, useValue: store },
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();

    const archive = TestBed.createComponent(ArchivePageComponent);
    archive.detectChanges();
    assertRecoveryRow(
      (archive.nativeElement as HTMLElement).querySelector<HTMLElement>("bit-item")!,
      (archive.nativeElement as HTMLElement).querySelector<HTMLElement>("[aria-label^='归档选项']")!,
    );
    archive.destroy();

    const trash = TestBed.createComponent(TrashPageComponent);
    trash.detectChanges();
    assertRecoveryRow(
      (trash.nativeElement as HTMLElement).querySelector<HTMLElement>("bit-item")!,
      (trash.nativeElement as HTMLElement).querySelector<HTMLElement>("[aria-label^='回收站选项']")!,
    );
    trash.destroy();

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [PasswordHistoryVisualHostComponent],
      providers: [
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();
    const history = TestBed.createComponent(PasswordHistoryVisualHostComponent);
    history.detectChanges();
    const historyHost = history.nativeElement as HTMLElement;
    const historyRow = historyHost.querySelector<HTMLElement>("bit-item")!;
    const historyCopy = historyHost.querySelector<HTMLElement>("[data-testid='history-copy-0']")!;
    const historyMain = historyRow.querySelector<HTMLElement>(":scope > [data-item-main-content]")!;
    const historyEnd = historyRow.querySelector<HTMLElement>(":scope > div")!;
    const historyPassword = historyHost.querySelector<HTMLElement>("bit-color-password")!;
    const historyContent = historyHost.querySelector<HTMLElement>(".macos-password-history-row__content")!;
    const historyDate = historyHost.querySelector<HTMLElement>("[data-testid='history-date-0']")!;
    const credentialCharacters = Array.from(historyPassword.querySelectorAll<HTMLElement>("span"));
    assertRecoveryRow(historyRow, historyCopy, false);
    expect(historyRow.classList).toContain("macos-password-history-row");
    expect(historyRow.classList).not.toContain("password-history-row");
    expect(getComputedStyle(historyRow).display).toBe("flex");
    expect(getComputedStyle(historyMain).display).toBe("flex");
    expect(getComputedStyle(historyEnd).display).toBe("flex");
    expect(historyCopy.closest("bit-item") ?? null).toBe(historyRow);
    expect(historyCopy.closest("[data-item-main-content]")).toBeNull();
    expect(credentialCharacters.length).toBeGreaterThan(1);
    expect(credentialCharacters.every((character) => getComputedStyle(character).display !== "grid"))
      .toBe(true);
    for (let ancestor: HTMLElement | null = historyPassword; ancestor; ancestor = ancestor.parentElement) {
      expect(ancestor.getAttribute("aria-hidden")).not.toBe("true");
      if (ancestor === historyRow) break;
    }
    expect(getComputedStyle(historyContent).paddingTop).toBe("0px");
    expect(getComputedStyle(historyContent).paddingBottom).toBe("0px");
    expect(modeledPasswordHistoryHeight(historyRow, historyContent, historyPassword, historyDate))
      .toEqual({ clipped: false, modeledHeight: 48 });
    document.body.classList.add("tw-bit-compact");
    expect(modeledPasswordHistoryHeight(historyRow, historyContent, historyPassword, historyDate))
      .toEqual({ clipped: false, modeledHeight: 44 });
    document.body.classList.remove("tw-bit-compact");
    document.documentElement.style.fontSize = "200%";
    const scaledHistory = modeledPasswordHistoryHeight(
      historyRow,
      historyContent,
      historyPassword,
      historyDate,
    );
    expect(scaledHistory.clipped).toBe(false);
    expect(scaledHistory.modeledHeight).toBeGreaterThan(48);
    document.documentElement.style.removeProperty("font-size");
    expect(historyHost.querySelector("[aria-live], [role='status'], [role='alert']")?.textContent ?? "")
      .not.toContain("old-secret-1");
    history.destroy();
  });

  it("gives New Item and recovery actions distinct pointer states, one keyboard ring, and media fallbacks", async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [NewItemPageComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(NewItemPageComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const action = host.querySelector<HTMLElement>(".new-item-option")!;
    const plate = action.querySelector<HTMLElement>(".new-item-icon")!;
    const initial = getComputedStyle(action).backgroundColor;
    action.dataset["vaultTestInteraction"] = "hover";
    const hover = getComputedStyle(action).backgroundColor;
    action.dataset["vaultTestInteraction"] = "active";
    const pressed = getComputedStyle(action).backgroundColor;
    expect(new Set([initial, hover, pressed]).size).toBe(3);

    action.dataset["vaultTestInteraction"] = "focus";
    expect(getComputedStyle(action).outlineStyle).not.toBe("solid");
    action.removeAttribute("data-vault-test-interaction");
    action.dataset["testFocusVisible"] = "true";
    expect(getComputedStyle(action).outlineWidth).toBe("2px");
    expect(getComputedStyle(plate).outlineStyle).not.toBe("solid");

    action.removeAttribute("data-test-focus-visible");
    action.setAttribute("aria-disabled", "true");
    expect(Number.parseFloat(getComputedStyle(action).opacity)).toBeLessThan(1);
    action.removeAttribute("aria-disabled");

    document.documentElement.dataset["vaultTestMedia"] = "reduced-motion";
    expect(getComputedStyle(action).transitionDuration).toBe("0s");
    expect(getComputedStyle(action).transform).toBe("none");
    document.documentElement.dataset["vaultTestMedia"] = "forced-colors";
    action.dataset["testFocusVisible"] = "true";
    expect(getComputedStyle(action).forcedColorAdjust).toBe("none");
    expect(getComputedStyle(action).outlineWidth).toBe("2px");
    fixture.destroy();
  });

  it("keeps the real OTP row compact, growable, and separates 44px owners from 32/28px plates", async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OtpRowVisualHostComponent],
      providers: [
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        PopupStateStore,
        SettingsService,
        {
          provide: TOTP_CODE_SOURCE,
          useValue: {
            generate: vi.fn(async () => ({
              code: "123456",
              formattedCode: "123 456",
              period: 30,
              secondsRemaining: 18,
              isExpiring: false,
            })),
          },
        },
        { provide: TOTP_CLOCK, useValue: () => 1_700_000_012 },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(OtpRowVisualHostComponent);
    fixture.detectChanges();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const row = host.querySelector<HTMLElement>(".otp-code-row")!;
    const copy = host.querySelector<HTMLElement>(".otp-code-row__copy")!;
    const copyIcon = host.querySelector<HTMLElement>(".otp-code-row__copy-icon")!;
    const countdown = host.querySelector<HTMLElement>(".otp-code-row__countdown")!;
    const identity = host.querySelector<HTMLElement>(".otp-code-row__identity")!;
    const name = host.querySelector<HTMLElement>(".otp-code-row__name")!;
    const subtitle = host.querySelector<HTMLElement>(".otp-code-row__subtitle")!;
    const code = host.querySelector<HTMLElement>(".otp-code-row__code")!;
    expect(row.classList).toContain("macos-row--double");
    expect(copy.classList).toContain("macos-hit-target");
    expect(copyIcon.classList).toContain("macos-icon-plate");
    expect(countdown.classList).toContain("macos-icon-plate");
    expect(getComputedStyle(row).minHeight).toBe("48px");
    expect(getComputedStyle(row).height).toBe("auto");
    expect(getComputedStyle(row).overflow).toBe("visible");
    expect(getComputedStyle(copy).minHeight).toBe("44px");
    expect(getComputedStyle(copyIcon).width).toBe("32px");
    expect(getComputedStyle(copyIcon).height).toBe("32px");
    expect(getComputedStyle(countdown).width).toBe("32px");
    expect(getComputedStyle(countdown).height).toBe("32px");
    expect(getComputedStyle(identity).minWidth).toBe("0px");
    expect(getComputedStyle(name).whiteSpace).toBe("normal");
    expect(getComputedStyle(name).overflowWrap).toBe("anywhere");
    expect(getComputedStyle(subtitle).whiteSpace).toBe("normal");
    expect(getComputedStyle(subtitle).overflowWrap).toBe("anywhere");
    expect(getComputedStyle(code).overflow).toBe("visible");
    const normalLayout = modeledOtpRowLayout(row, 480);
    expect(normalLayout.horizontalClip).toBe(false);
    expect(normalLayout.verticalClip).toBe(false);
    expect(normalLayout.codeClip).toBe(false);
    expect(normalLayout.overlap).toBe(false);
    expect(normalLayout.modeledHeight).toBeGreaterThan(48);

    document.documentElement.setAttribute("data-bw-compact-mode", "true");
    expect(getComputedStyle(row).minHeight).toBe("44px");
    expect(getComputedStyle(copyIcon).width).toBe("28px");
    expect(getComputedStyle(copyIcon).height).toBe("28px");
    expect(getComputedStyle(countdown).width).toBe("28px");
    expect(getComputedStyle(countdown).height).toBe("28px");

    document.documentElement.style.fontSize = "200%";
    expect(getComputedStyle(document.documentElement).fontSize).toBe("200%");
    expect(getComputedStyle(row).height).toBe("auto");
    expect(getComputedStyle(identity).overflow).toBe("visible");
    expect(getComputedStyle(name).overflow).toBe("visible");
    expect(getComputedStyle(subtitle).overflow).toBe("visible");
    expect(getComputedStyle(code).overflow).toBe("visible");
    const scaledLayout = modeledOtpRowLayout(row, 480);
    expect(scaledLayout.horizontalClip).toBe(false);
    expect(scaledLayout.verticalClip).toBe(false);
    expect(scaledLayout.codeClip).toBe(false);
    expect(scaledLayout.overlap).toBe(false);
    expect(scaledLayout.lineCount).toBeGreaterThan(normalLayout.lineCount);
    expect(scaledLayout.modeledHeight).toBeGreaterThan(normalLayout.modeledHeight);
    fixture.destroy();
  });

  it("keeps OTP feedback on the nested plate with keyboard-only focus and media fallbacks", async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OtpRowVisualHostComponent],
      providers: [
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        PopupStateStore,
        SettingsService,
        {
          provide: TOTP_CODE_SOURCE,
          useValue: {
            generate: vi.fn(async () => ({
              code: "123456",
              formattedCode: "123 456",
              period: 30,
              secondsRemaining: 18,
              isExpiring: false,
            })),
          },
        },
        { provide: TOTP_CLOCK, useValue: () => 1_700_000_012 },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(OtpRowVisualHostComponent);
    fixture.detectChanges();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const copy = host.querySelector<HTMLButtonElement>(".otp-code-row__copy")!;
    const plate = host.querySelector<HTMLElement>(".otp-code-row__copy-icon")!;
    const transparent = "rgba(0, 0, 0, 0)";
    expect(getComputedStyle(copy).backgroundColor).toBe(transparent);
    expect(getComputedStyle(plate).backgroundColor).toBe(transparent);

    copy.dataset["vaultTestInteraction"] = "focus";
    expect(getComputedStyle(copy).outlineStyle).not.toBe("solid");
    expect(getComputedStyle(plate).outlineStyle).not.toBe("solid");
    copy.dataset["testFocusVisible"] = "true";
    expect(getComputedStyle(copy).outlineStyle).not.toBe("solid");
    expect(getComputedStyle(plate).outlineWidth).toBe("2px");
    expect(getComputedStyle(plate).outlineStyle).toBe("solid");

    copy.removeAttribute("data-test-focus-visible");
    copy.dataset["vaultTestInteraction"] = "hover";
    const hover = getComputedStyle(plate).backgroundColor;
    expect(hover).not.toBe(transparent);
    expect(getComputedStyle(copy).backgroundColor).toBe(transparent);
    copy.dataset["vaultTestInteraction"] = "active";
    const pressed = getComputedStyle(plate).backgroundColor;
    expect(pressed).not.toBe(transparent);
    expect(pressed).not.toBe(hover);
    copy.disabled = true;
    copy.dataset["vaultTestInteraction"] = "hover active";
    expect(Number.parseFloat(getComputedStyle(plate).opacity)).toBeLessThan(1);
    expect(getComputedStyle(copy).backgroundColor).toBe(transparent);
    copy.disabled = false;
    copy.setAttribute("aria-disabled", "true");
    copy.dataset["vaultTestInteraction"] = "hover active";
    expect(Number.parseFloat(getComputedStyle(plate).opacity)).toBeLessThan(1);
    expect(getComputedStyle(copy).backgroundColor).toBe(transparent);
    copy.removeAttribute("aria-disabled");

    document.documentElement.setAttribute("data-vault-test-media", "reduced-motion");
    expect(getComputedStyle(plate).transitionDuration).toBe("0s");
    expect(getComputedStyle(plate).transform).toBe("none");
    document.documentElement.setAttribute("data-vault-test-media", "forced-colors");
    copy.dataset["testFocusVisible"] = "true";
    expect(getComputedStyle(plate).forcedColorAdjust).toBe("none");
    expect(getComputedStyle(plate).outlineWidth).toBe("2px");
    fixture.destroy();
  });

  it("computes a real retained Vault row at 48/44 pixels with separate 44px owners and 32/28px plates", async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [VaultRowVisualHostComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(VaultRowVisualHostComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const row = host.querySelector<HTMLElement>("bit-item.vault-list-row")!;
    const mainContent = row.querySelector<HTMLElement>("[data-item-main-content]")!;
    const content = host.querySelector<HTMLElement>('[data-testid="vault-item-content"]')!;
    const name = host.querySelector<HTMLElement>('[data-testid="item-name"]')!;
    const subtitle = host.querySelector<HTMLElement>('[slot="secondary"]')!;
    const actions = host.querySelectorAll<HTMLElement>('button[aria-label]');
    const fieldActions = host.querySelectorAll<HTMLElement>("[data-field]");
    const plates = host.querySelectorAll<HTMLElement>("[data-field] .bwi");
    expect(row.classList).toContain("macos-row--double");
    expect(getComputedStyle(row).minHeight).toBe("48px");
    expect(getComputedStyle(row).borderRadius).toBe("0px");
    expect(getComputedStyle(row).boxShadow).toBe("none");
    expect(getComputedStyle(mainContent).minWidth).toBe("0px");
    expect(getComputedStyle(mainContent).overflow).toBe("visible");
    expect(getComputedStyle(content).minHeight).toBe("48px");
    expect(getComputedStyle(content).height).toBe("auto");
    expect(actions.length).toBeGreaterThan(0);
    expect(Array.from(actions, (action) => [
      getComputedStyle(action).minWidth,
      getComputedStyle(action).minHeight,
    ])).toEqual(Array.from(actions, () => ["44px", "44px"]));
    expect(Array.from(fieldActions, (action) => action.classList.contains("macos-hit-target")))
      .toEqual(Array.from(fieldActions, () => true));
    expect(Array.from(plates, (plate) => [
      getComputedStyle(plate).width,
      getComputedStyle(plate).height,
    ])).toEqual(Array.from(plates, () => ["32px", "32px"]));
    const normalLayout = modeledVaultTextLayout(row, content, [name, subtitle], 480);
    expect(normalLayout.horizontalClip).toBe(false);
    expect(normalLayout.verticalClip).toBe(false);
    expect(normalLayout.lineCount).toBeGreaterThan(2);
    expect(normalLayout.modeledHeight).toBeGreaterThan(48);

    document.documentElement.setAttribute("data-bw-compact-mode", "true");
    expect(getComputedStyle(row).minHeight).toBe("44px");
    expect(getComputedStyle(content).minHeight).toBe("44px");
    expect(getComputedStyle(content).height).toBe("auto");
    expect(Array.from(plates, (plate) => [
      getComputedStyle(plate).width,
      getComputedStyle(plate).height,
    ])).toEqual(Array.from(plates, () => ["28px", "28px"]));

    document.documentElement.style.fontSize = "200%";
    expect(getComputedStyle(document.documentElement).fontSize).toBe("200%");
    expect(getComputedStyle(row).minWidth).toBe("0px");
    expect(getComputedStyle(content).minWidth).toBe("0px");
    expect(getComputedStyle(name).minWidth).toBe("0px");
    expect(getComputedStyle(name).overflowWrap).toBe("anywhere");
    expect(getComputedStyle(subtitle).overflowWrap).toBe("anywhere");
    const scaledLayout = modeledVaultTextLayout(row, content, [name, subtitle], 480);
    expect(scaledLayout.horizontalClip).toBe(false);
    expect(scaledLayout.verticalClip).toBe(false);
    expect(scaledLayout.lineCount).toBeGreaterThan(normalLayout.lineCount);
    expect(scaledLayout.modeledHeight).toBeGreaterThan(normalLayout.modeledHeight);
    expect(scaledLayout.modeledHeight).toBeGreaterThan(44);
    fixture.destroy();
  });

  it("keeps one keyboard-only 2px ring on each retained credential plate", async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [VaultRowVisualHostComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(VaultRowVisualHostComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const controls = [
      host.querySelector<HTMLButtonElement>('[data-field="username"]')!,
      host.querySelector<HTMLButtonElement>('[data-field="password"]')!,
      host.querySelector<HTMLButtonElement>('[data-field="totp"]')!,
    ];

    expect(controls.every(Boolean)).toBe(true);
    for (const control of controls) {
      const plate = control.querySelector<HTMLElement>(".bwi")!;
      control.dataset["vaultTestInteraction"] = "focus";
      expect(getComputedStyle(control).outlineStyle).not.toBe("solid");
      expect(getComputedStyle(plate).outlineStyle).not.toBe("solid");

      control.dataset["testFocusVisible"] = "true";
      const controlStyle = getComputedStyle(control);
      const plateStyle = getComputedStyle(plate);
      expect(controlStyle.outlineStyle).not.toBe("solid");
      expect(plateStyle.outlineWidth).toBe("2px");
      expect(plateStyle.outlineStyle).toBe("solid");
      control.removeAttribute("data-test-focus-visible");
      control.removeAttribute("data-vault-test-interaction");
    }
    fixture.destroy();
  });

  it("gives retained credential plates distinct immediate feedback and accessible media fallbacks", async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [VaultRowVisualHostComponent],
      providers: [
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(VaultRowVisualHostComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const actions = Array.from(host.querySelectorAll<HTMLButtonElement>("[data-field]"));
    const plates = actions.map((action) => action.querySelector<HTMLElement>(".bwi")!);
    const transparent = "rgba(0, 0, 0, 0)";

    expect(new Set(plates.map((plate) => getComputedStyle(plate).color)).size).toBe(3);
    for (const [index, action] of actions.entries()) {
      const plate = plates[index]!;
      expect(getComputedStyle(action).backgroundColor).toBe(transparent);
      expect(getComputedStyle(plate).backgroundColor).toBe(transparent);

      action.dataset["vaultTestInteraction"] = "hover";
      const hover = getComputedStyle(plate).backgroundColor;
      expect(hover).not.toBe(transparent);
      expect(getComputedStyle(action).backgroundColor).toBe(transparent);

      action.dataset["vaultTestInteraction"] = "active";
      const pressed = getComputedStyle(plate).backgroundColor;
      expect(pressed).not.toBe(transparent);
      expect(pressed).not.toBe(hover);

      action.disabled = true;
      action.dataset["vaultTestInteraction"] = "hover active";
      expect(Number.parseFloat(getComputedStyle(plate).opacity)).toBeLessThan(1);
      expect(getComputedStyle(action).backgroundColor).toBe(transparent);
      action.disabled = false;
      action.removeAttribute("data-vault-test-interaction");
    }

    const username = actions[0]!;
    const usernamePlate = plates[0]!;
    document.documentElement.setAttribute("data-vault-test-media", "reduced-motion");
    expect(getComputedStyle(usernamePlate).transitionDuration).toBe("0s");
    expect(getComputedStyle(usernamePlate).transform).toBe("none");
    document.documentElement.setAttribute("data-vault-test-media", "forced-colors");
    username.dataset["testFocusVisible"] = "true";
    expect(getComputedStyle(usernamePlate).forcedColorAdjust).toBe("none");
    expect(getComputedStyle(usernamePlate).outlineWidth).toBe("2px");

    document.documentElement.removeAttribute("data-vault-test-media");
    username.removeAttribute("data-test-focus-visible");
    username.removeAttribute("data-vault-test-interaction");
    fixture.destroy();
  });

  it("renders real retained Vault fields with separate hit and painted geometry", async () => {
    TestBed.resetTestingModule();
    const store = new PopupStateStore();
    await TestBed.configureTestingModule({
      imports: [VaultFormVisualHostComponent],
      providers: [
        importProvidersFrom(DialogModule),
        provideZoneChangeDetection(),
        provideNoopAnimations(),
        provideRouter([]),
        OfficialI18nService,
        { provide: I18nService, useExisting: OfficialI18nService },
        { provide: RETAINED_LOGIN_FORM_STATUS_STORE, useValue: store },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(VaultFormVisualHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges(false);

    const host = fixture.nativeElement as HTMLElement;
    const card = host.querySelector<HTMLElement>(".cipher-form-scroll bit-card")!;
    const input = host.querySelector<HTMLInputElement>('input[formcontrolname="name"]')!;
    const fieldShell = input.closest<HTMLElement>("[bitfieldcontainer]")!;
    const ngSelectShell = host.querySelector<HTMLElement>(
      ".cipher-form-scroll .visual-multi-select .ng-select-container",
    )!;
    const outsideNgSelectShell = host.querySelector<HTMLElement>(
      '[data-testid="outside-sheet"] .ng-select-container',
    )!;
    const textarea = host.querySelector<HTMLTextAreaElement>(
      '.cipher-form-scroll textarea[formcontrolname="notes"]',
    )!;
    const suffix = host.querySelector<HTMLButtonElement>(
      ".cipher-form-scroll button[bitsuffix]",
    )!;
    const suffixPlate = suffix.querySelector<HTMLElement>(".bwi")!;
    const detailField = host.querySelector<HTMLElement>(".official-read-only-field")!;
    const detailControl = host.querySelector<HTMLElement>(".official-read-only-control")!;
    expect(card).not.toBeNull();
    expect(input).not.toBeNull();
    expect(fieldShell).not.toBeNull();
    expect(ngSelectShell).not.toBeNull();
    expect(getComputedStyle(card).borderRadius).toBe("0px");
    expect(getComputedStyle(card).boxShadow).toBe("none");
    expect(textarea).not.toBeNull();
    expect(suffix).not.toBeNull();
    expect(suffixPlate).not.toBeNull();
    expect(detailField).not.toBeNull();
    expect(detailControl).not.toBeNull();
    expect(parseFloat(getComputedStyle(detailField).minHeight)).toBeGreaterThanOrEqual(44);
    expect(getComputedStyle(detailField).height).toBe("auto");
    expect(getComputedStyle(detailField).boxShadow).toBe("none");
    expect(parseFloat(getComputedStyle(detailControl).minHeight)).toBeGreaterThanOrEqual(44);
    expect(getComputedStyle(fieldShell).borderRadius).toBe("9px");
    expect(parseFloat(getComputedStyle(fieldShell).minHeight)).toBeGreaterThanOrEqual(44);
    expect(getComputedStyle(input).height).toBe("auto");
    expect(getComputedStyle(input).minHeight).toBe("40px");
    expect(getComputedStyle(ngSelectShell).borderRadius).toBe("9px");
    expect(getComputedStyle(ngSelectShell).minHeight).toBe("40px");
    expect(getComputedStyle(textarea).minHeight).toBe("72px");
    expect(parseFloat(getComputedStyle(suffix).minWidth)).toBeGreaterThanOrEqual(44);
    expect(parseFloat(getComputedStyle(suffix).minHeight)).toBeGreaterThanOrEqual(44);
    expect(getComputedStyle(suffixPlate).width).toBe("32px");
    expect(getComputedStyle(suffixPlate).height).toBe("32px");
    expect(getComputedStyle(outsideNgSelectShell).borderRadius).toBe("11px");

    suffix.dataset["vaultTestInteraction"] = "hover";
    expect(getComputedStyle(suffix).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(suffixPlate).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    suffix.dataset["vaultTestInteraction"] = "active";
    expect(getComputedStyle(suffixPlate).transform).toContain("0.96");
    suffix.disabled = true;
    expect(Number.parseFloat(getComputedStyle(suffixPlate).opacity)).toBeLessThan(1);
    suffix.disabled = false;
    suffix.removeAttribute("data-vault-test-interaction");

    input.focus();
    input.dataset["testFocusVisible"] = "true";
    const fieldFocus = getComputedStyle(fieldShell);
    expect(fieldFocus.outlineWidth).toBe("2px");
    expect(fieldFocus.outlineStyle).toBe("solid");
    expect(fieldFocus.outlineOffset).toBe("2px");
    expect(fieldFocus.boxShadow).toBe("none");
    expect(getComputedStyle(input).outlineStyle).toBe("none");

    document.body.classList.add("tw-bit-compact");
    expect(getComputedStyle(input).minHeight).toBe("36px");
    expect(getComputedStyle(ngSelectShell).minHeight).toBe("36px");
    expect(getComputedStyle(host.querySelector<HTMLElement>(".cipher-form-scroll form")!)
      .gap).toBe("16px");
    expect(getComputedStyle(host.querySelector<HTMLElement>(".cipher-form-scroll section")!)
      .marginBottom).toBe("0px");
    document.body.classList.remove("tw-bit-compact");

    document.documentElement.style.fontSize = "200%";
    expect(getComputedStyle(input).height).toBe("auto");
    expect(parseFloat(getComputedStyle(input).minHeight)).toBeGreaterThanOrEqual(40);
    expect(getComputedStyle(detailField).height).toBe("auto");
    expect(getComputedStyle(detailControl).overflow).not.toBe("hidden");

    document.documentElement.setAttribute("data-vault-test-media", "reduced-motion");
    expect(getComputedStyle(suffixPlate).transitionDuration).toBe("0s");
    document.documentElement.setAttribute("data-vault-test-media", "forced-colors");
    suffix.dataset["testFocusVisible"] = "true";
    expect(getComputedStyle(suffix).outlineStyle).toBe("none");
    expect(getComputedStyle(suffixPlate).forcedColorAdjust).toBe("none");
    expect(getComputedStyle(suffixPlate).outlineWidth).toBe("2px");
    fixture.destroy();
  });

  it("mounts the real Login add/edit/clone routes with their production form and footer owners", async () => {
    for (const route of [
      { path: "add-cipher", id: "", mode: "add" },
      { path: "edit-cipher", id: "github", mode: "edit" },
      { path: "clone-cipher", id: "github", mode: "clone" },
    ] as const) {
      const fixture = await createRealVaultAddEditFixture(route.path, "1", route.id);
      const host = fixture.nativeElement as HTMLElement;
      const save = host.querySelector<HTMLButtonElement>('popup-footer button[type="submit"]')!;
      expect(fixture.componentInstance.officialLoginConfig.mode).toBe(route.mode);
      expect(host.classList).toContain("macos-page--vault-form");
      expect(host.querySelector("popup-page.macos-page--vault-form")).not.toBeNull();
      expect(host.querySelector("form.macos-cipher-form")).not.toBeNull();
      expect(save.classList).toContain("macos-button-owner");
      expect(save.classList).toContain("macos-primary-action");
      expect(getComputedStyle(save).minHeight).toBe("44px");
      expect(getComputedStyle(save).backgroundColor).toBe("rgba(0, 0, 0, 0)");
      fixture.destroy();
    }
  });

  it("paints real Save and Edit primary feedback on a distinct stateful layer", async () => {
    const formFixture = await createRealVaultAddEditFixture("edit-cipher", "1", "github");
    const save = (formFixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      'popup-footer button[type="submit"]',
    )!;
    const savePaint = document.createElement("span");
    savePaint.dataset["vaultTestPaint"] = "true";
    save.prepend(savePaint);
    expect(getComputedStyle(save).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    const initial = getComputedStyle(savePaint).backgroundColor;
    save.dataset["vaultTestInteraction"] = "hover";
    const hover = getComputedStyle(savePaint).backgroundColor;
    save.dataset["vaultTestInteraction"] = "active";
    const pressed = getComputedStyle(savePaint).backgroundColor;
    expect(new Set([initial, hover, pressed]).size).toBe(3);
    save.disabled = true;
    save.dataset["vaultTestInteraction"] = "hover active";
    expect(getComputedStyle(savePaint).backgroundColor).not.toBe(hover);
    expect(Number.parseFloat(getComputedStyle(savePaint).opacity)).toBeLessThan(1);
    document.documentElement.dataset["vaultTestMedia"] = "forced-colors";
    expect(getComputedStyle(savePaint).forcedColorAdjust).toBe("none");
    expect(getComputedStyle(savePaint).backgroundColor).toBe("rgb(204, 204, 204)");
    formFixture.destroy();

    const detailFixture = await createRealVaultDetailFixture();
    const edit = (detailFixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      'popup-footer a.macos-primary-action',
    )!;
    const editPaint = document.createElement("span");
    editPaint.dataset["vaultTestPaint"] = "true";
    edit.prepend(editPaint);
    expect(getComputedStyle(edit).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(editPaint).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    detailFixture.destroy();
  });

  it("keeps real Save, Edit, and Restore paint at 40/36px with forced-color label contrast", async () => {
    const assertPrimaryGeometry = (owner: HTMLElement) => {
      const paint = appendProjectedPrimaryPaint(owner);
      expect(modeledPrimaryPaintHeight(owner, paint)).toBe(40);
      document.documentElement.setAttribute("data-bw-compact-mode", "true");
      expect(getComputedStyle(paint).insetBlock).toBe("4px");
      expect(modeledPrimaryPaintHeight(owner, paint)).toBe(36);
      document.documentElement.removeAttribute("data-bw-compact-mode");

      document.documentElement.setAttribute("data-vault-test-media", "forced-colors");
      expect(getComputedStyle(owner).color).toBe("rgb(0, 0, 0)");
      expect(getComputedStyle(paint).backgroundColor).toBe("rgb(204, 204, 204)");
      owner.setAttribute("aria-disabled", "true");
      expect(getComputedStyle(owner).color).toBe("rgb(102, 102, 102)");
      expect(getComputedStyle(paint).color).toBe("rgb(102, 102, 102)");
      owner.removeAttribute("aria-disabled");
      document.documentElement.removeAttribute("data-vault-test-media");
    };

    const saveFixture = await createRealVaultAddEditFixture("edit-cipher", "1", "github");
    assertPrimaryGeometry((saveFixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      'popup-footer button[type="submit"]',
    )!);
    saveFixture.destroy();

    const editFixture = await createRealVaultDetailFixture();
    assertPrimaryGeometry((editFixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      'popup-footer a.macos-primary-action',
    )!);
    editFixture.destroy();

    const restoreFixture = await createRealVaultDetailFixture("deleted");
    assertPrimaryGeometry((restoreFixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      'popup-footer button.macos-primary-action',
    )!);
    restoreFixture.destroy();
  });

  it("flattens real nonempty Login and Personal custom-field rows and action plates", async () => {
    for (const route of [
      { type: "1", id: "github" },
      { type: "3", id: "card" },
    ] as const) {
      const fixture = await createRealVaultAddEditFixture("edit-cipher", route.type, route.id);
      const host = fixture.nativeElement as HTMLElement;
      const group = host.querySelector<HTMLElement>('[data-testid="custom-fields"]')!;
      const rows = Array.from(group.querySelectorAll<HTMLElement>(":scope > [data-testid$='-entry']"));
      expect(rows.length).toBeGreaterThanOrEqual(2);
      for (const row of rows) {
        const computed = getComputedStyle(row);
        expect(row.classList).toContain("macos-custom-field-row");
        expect(computed.padding).toBe("0px");
        expect(computed.marginLeft).toBe("0px");
        expect(computed.marginRight).toBe("0px");
        expect(computed.gap).toBe("12px");
        expect(computed.flexWrap).toBe("wrap");
        expect(computed.backgroundColor).toBe("rgba(0, 0, 0, 0)");
        expect(computed.borderRadius).toBe("0px");
        expect(modeledCustomFieldDistance(group, row)).toBe(12);
        expect(Array.from(
          row.querySelectorAll<HTMLElement>(":scope > bit-form-field, :scope > bit-form-control"),
          (field) => getComputedStyle(field).marginBottom,
        )).toEqual(Array.from(
          row.querySelectorAll(":scope > bit-form-field, :scope > bit-form-control"),
          () => "0px",
        ));
      }
      const actions = Array.from(group.querySelectorAll<HTMLElement>(
        '[data-testid="edit-custom-field-button"], [data-testid="reorder-toggle-button"]',
      ));
      expect(actions.length).toBeGreaterThanOrEqual(4);
      for (const action of actions) {
        const plate = action.querySelector<HTMLElement>(".bwi")!;
        expect(action.classList).toContain("macos-hit-target");
        expect(getComputedStyle(action).minWidth).toBe("44px");
        expect(getComputedStyle(action).minHeight).toBe("44px");
        expect(getComputedStyle(plate).width).toBe("32px");
        expect(getComputedStyle(plate).height).toBe("32px");
      }
      document.documentElement.setAttribute("data-bw-compact-mode", "true");
      expect(getComputedStyle(rows[0]!).gap).toBe("10px");
      expect(modeledCustomFieldDistance(group, rows[0]!)).toBe(10);
      expect(getComputedStyle(actions[0]!.querySelector<HTMLElement>(".bwi")!).width).toBe("28px");
      document.documentElement.style.fontSize = "200%";
      expect(getComputedStyle(rows[0]!).height).toBe("auto");
      expect(getComputedStyle(rows[0]!).overflow).toBe("visible");
      const label = rows[0]!.querySelector<HTMLElement>("bit-label")!;
      expect(getComputedStyle(label).whiteSpace).toBe("normal");
      expect(getComputedStyle(label).overflowWrap).toBe("anywhere");
      fixture.destroy();
      document.documentElement.removeAttribute("data-bw-compact-mode");
      document.documentElement.style.removeProperty("font-size");
    }
  });

  it("grows the real Login detail value at 200% without exposing duplicate accessible secrets", async () => {
    const fixture = await createRealVaultDetailFixture();
    const host = fixture.nativeElement as HTMLElement;
    const usernameInput = host.querySelector<HTMLInputElement>('[data-testid="login-username"]')!;
    const usernameValue = usernameInput.value;
    const usernameDisplay = host.querySelector<HTMLElement>(
      '[data-testid="login-username-value"]',
    )!;
    expect(usernameInput.getAttribute("aria-hidden")).toBe("true");
    expect(usernameInput.tabIndex).toBe(-1);
    expect(usernameDisplay.textContent?.trim()).toBe(usernameValue);
    expect(usernameDisplay.getAttribute("role")).toBe("textbox");
    expect(usernameDisplay.getAttribute("aria-readonly")).toBe("true");
    document.documentElement.style.fontSize = "200%";
    expect(getComputedStyle(usernameDisplay).height).toBe("auto");
    expect(getComputedStyle(usernameDisplay).whiteSpace).toBe("normal");
    expect(getComputedStyle(usernameDisplay).overflow).toBe("visible");
    expect(getComputedStyle(usernameDisplay).overflowWrap).toBe("anywhere");
    document.documentElement.setAttribute("data-bw-compact-mode", "true");
    expect(getComputedStyle(usernameDisplay).height).toBe("auto");
    expect(getComputedStyle(usernameDisplay).minHeight).toBe("36px");
    expect(usernameDisplay.textContent!.length).toBeGreaterThan(48);

    const passwordInput = host.querySelector<HTMLInputElement>('[data-testid="login-password"]')!;
    const secret = passwordInput.value;
    const passwordDisplay = host.querySelector<HTMLElement>(
      '[data-testid="login-password-value"]',
    )!;
    expect(passwordInput.getAttribute("aria-hidden")).toBe("true");
    expect(passwordDisplay.textContent).not.toContain(secret);
    expect(host.querySelectorAll('[data-testid="login-password-value"]').length).toBe(1);
    expect(Array.from(host.querySelectorAll<HTMLElement>("[aria-live], [role='status'], [role='alert']"))
      .every((node) => !node.textContent?.includes(secret))).toBe(true);
    host.querySelector<HTMLButtonElement>('[data-testid="toggle-password"]')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges(false);
    expect(host.querySelector<HTMLElement>('[data-testid="login-password-value"]')!.textContent)
      .toContain(secret);
    expect(host.querySelectorAll('[data-testid="login-password-value"]').length).toBe(1);
    host.querySelector<HTMLButtonElement>('[data-testid="toggle-password-count"]')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges(false);
    const coloredPassword = host.querySelector<HTMLElement>("bit-color-password")!;
    const coloredSecret = Array.from(
      coloredPassword.querySelectorAll<HTMLElement>("[data-password-character] > span:first-child"),
      (character) => character.textContent ?? "",
    ).join("");
    const secretOwners = [
      {
        node: host.querySelector<HTMLElement>('[data-testid="login-password-value"]')!,
        value: host.querySelector<HTMLElement>('[data-testid="login-password-value"]')!.textContent ?? "",
      },
      { node: coloredPassword, value: coloredSecret },
    ].filter(({ node, value }) => value.includes(secret) && !accessibilityHidden(node));
    expect(secretOwners).toHaveLength(1);
    expect(secretOwners[0]?.node.dataset["testid"]).toBe("login-password-value");
    expect(coloredSecret).toBe(secret);
    expect(accessibilityHidden(coloredPassword)).toBe(true);

    const totpInput = host.querySelector<HTMLInputElement>('[data-testid="login-totp"]')!;
    const totpDisplay = host.querySelector<HTMLElement>('[data-testid="login-totp-value"]')!;
    expect(totpInput.getAttribute("aria-hidden")).toBe("true");
    expect(totpDisplay.getAttribute("role")).toBe("textbox");
    expect([totpInput, totpDisplay].filter((node) => !accessibilityHidden(node))).toEqual([
      totpDisplay,
    ]);
    fixture.destroy();
  });
});
