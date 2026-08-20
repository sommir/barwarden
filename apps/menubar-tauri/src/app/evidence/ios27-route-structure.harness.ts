import type { ComponentFixture } from "@angular/core/testing";
import { TestBed } from "@angular/core/testing";
import { Router } from "@angular/router";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { AppComponent } from "../app.component";
import { appConfig } from "../app.config";
import { AuthFacade, type AuthStartupResult } from "../auth/auth.facade";
import { applyAuthEvidenceState } from "../auth/auth-evidence-preview";
import {
  AUTH_EVIDENCE_STATE,
  AUTH_EVIDENCE_STATES,
  type AuthEvidenceState,
} from "../auth/auth-evidence-state";
import type { Ios27PageFamily, PopupLayer } from "../platform/popup-route-metadata";
import { PopupStateStore } from "../popup-state";
import { applySendEvidenceState } from "../send/send-evidence-preview";
import {
  SEND_EVIDENCE_STATE,
  sendEvidenceStates,
  type SendEvidenceState,
} from "../send/send-evidence-state";
import {
  applySettingsEvidenceState,
  createSettingsEvidencePreview,
} from "../settings/settings-evidence-preview";
import {
  SETTINGS_EVIDENCE_STATE,
  settingsEvidenceStates,
  type SettingsEvidenceState,
} from "../settings/settings-evidence-state";
import { SettingsService } from "../settings/settings.service";
import { applyVaultMainEvidenceState } from "../vault/vault-main-evidence-preview";
import {
  vaultMainEvidenceStates,
  type VaultMainEvidenceState,
} from "../vault/vault-main-evidence-state";
import { createEvidenceProviders } from "./evidence-providers";

export interface ProductionRouteStructuralCase {
  readonly route: string;
  readonly family: Ios27PageFamily;
  readonly layer: PopupLayer;
  readonly evidenceSearch: string;
  readonly routeHostSelector: string;
}

const structuralCase = (
  route: string,
  family: Ios27PageFamily,
  layer: PopupLayer,
  evidenceSearch: string,
  routeHostSelector: string,
): ProductionRouteStructuralCase => ({ route, family, layer, evidenceSearch, routeHostSelector });

export const productionRouteStructuralCases = [
  structuralCase("/login", "auth", "base", "?authEvidence=email", "bw-login-page"),
  structuralCase("/lock", "auth", "base", "?authEvidence=alternative-unlock-startup", "bw-lock-page"),
  structuralCase("/2fa", "auth", "secondary", "?authEvidence=authenticator", "bw-two-factor-page"),
  structuralCase("/new-device-verification", "auth", "secondary", "?authEvidence=new-device", "bw-new-device-verification-page"),
  structuralCase("/hint", "auth", "secondary", "?authEvidence=hint", "bw-password-hint-page"),
  structuralCase("/account-switcher", "auth", "secondary", "?authEvidence=account-switcher", "bw-official-account-switcher"),
  structuralCase("/tabs/vault", "vault", "base", "?vaultEvidence=populated", "bw-vault-list-page"),
  structuralCase("/tabs/otp", "otp", "base", "?vaultEvidence=populated", "bw-otp-page"),
  structuralCase("/tabs/generator", "generator", "base", "?vaultEvidence=populated", "bw-generator-page"),
  structuralCase("/tabs/send", "send", "base", "?sendEvidence=list-populated", "bw-send-page"),
  structuralCase("/tabs/settings", "settings", "base", "?settingsEvidence=settings-main", "bw-settings-page"),
  structuralCase("/vault-settings", "settings", "secondary", "?settingsEvidence=vault-settings", "bw-vault-settings-page"),
  structuralCase("/account-security", "settings", "secondary", "?settingsEvidence=account-security", "bw-account-security-page"),
  structuralCase("/settings-password", "settings", "secondary", "?settingsEvidence=change-password-handoff", "bw-settings-password-page"),
  structuralCase("/autofill", "settings", "secondary", "?settingsEvidence=one-field-settings", "bw-autofill-settings-page"),
  structuralCase("/keyboard-shortcut", "settings", "secondary", "?settingsEvidence=settings-main", "bw-keyboard-shortcut-page"),
  structuralCase("/appearance", "settings", "secondary", "?settingsEvidence=appearance", "bw-appearance-page"),
  structuralCase("/new-item", "vault", "secondary", "?vaultEvidence=populated", "bw-new-item-page"),
  structuralCase("/folders", "vault", "secondary", "?vaultEvidence=folders-list", "bw-folders-page"),
  structuralCase("/archive", "vault", "secondary", "?vaultEvidence=archive-list", "bw-archive-page"),
  structuralCase("/trash", "vault", "secondary", "?vaultEvidence=trash-list", "bw-trash-page"),
  structuralCase("/view-cipher/calendar", "vault", "secondary", "?vaultEvidence=login-workflow-detail-default", "bw-vault-item-detail-page"),
  structuralCase("/add-cipher?type=1", "vault", "secondary", "?vaultEvidence=login-workflow-form-add", "bw-vault-add-edit-page"),
  structuralCase("/edit-cipher?cipherId=calendar&type=1", "vault", "secondary", "?vaultEvidence=login-workflow-form-edit", "bw-vault-add-edit-page"),
  structuralCase("/clone-cipher?cipherId=calendar&type=1", "vault", "secondary", "?vaultEvidence=login-workflow-form-clone", "bw-vault-add-edit-page"),
  structuralCase("/cipher-password-history?cipherId=calendar", "vault", "secondary", "?vaultEvidence=password-history-populated", "bw-vault-password-history-page"),
  structuralCase("/generator-history", "generator", "secondary", "?vaultEvidence=populated", "bw-generator-history-page"),
  structuralCase("/add-send?type=text", "send", "secondary", "?sendEvidence=form-add", "bw-send-add-edit-page"),
  structuralCase("/edit-send?sendId=m12-text-send&type=text", "send", "secondary", "?sendEvidence=form-edit", "bw-send-add-edit-page"),
  structuralCase("/send-created?sendId=m12-text-send&type=text", "send", "secondary", "?sendEvidence=created", "bw-send-created-page"),
  structuralCase("/about", "document", "secondary", "?settingsEvidence=about", "bw-about-page"),
  structuralCase("/third-party-notices", "document", "secondary", "?settingsEvidence=about", "bw-third-party-notices-page"),
  structuralCase("/third-party-licenses", "document", "secondary", "?settingsEvidence=about", "bw-third-party-licenses-page"),
] as const;

const evidenceValues: Readonly<Record<string, readonly string[]>> = {
  authEvidence: AUTH_EVIDENCE_STATES,
  vaultEvidence: vaultMainEvidenceStates,
  sendEvidence: sendEvidenceStates,
  settingsEvidence: settingsEvidenceStates,
};

for (const testCase of productionRouteStructuralCases) {
  const entries = [...new URLSearchParams(testCase.evidenceSearch).entries()];
  if (entries.length !== 1) {
    throw new Error(`One evidence value required for ${testCase.route}`);
  }
  const [key, value] = entries[0]!;
  if (!evidenceValues[key]?.includes(value)) {
    throw new Error(`Invalid ${key}=${value} for ${testCase.route}`);
  }
}

export async function mountProductionRoute(
  testCase: ProductionRouteStructuralCase,
): Promise<{
  fixture: ComponentFixture<AppComponent>;
  host: HTMLElement;
  router: Router;
}> {
  const settingsPreview = createSettingsEvidencePreview(testCase.evidenceSearch, true);
  const evidenceProviders = settingsPreview
    ? settingsPreview.providers
    : createEvidenceProviders(testCase.evidenceSearch, true);
  const style = document.createElement("style");
  style.dataset.testOwner = "ios27-route-structure";
  style.textContent = [
    "macos-tokens.css",
    "macos-materials.css",
    "macos-motion.css",
    "global.css",
  ].map((file) => readFileSync(
    join(process.cwd(), "apps/menubar-tauri/src/styles", file),
    "utf8",
  )).join("\n").replace(/^@import[^;]+;\s*/gm, "");
  document.head.append(style);
  document.documentElement.style.width = "480px";
  document.documentElement.style.height = "600px";

  await TestBed.configureTestingModule({
    imports: [AppComponent],
    providers: [
      ...appConfig.providers,
      ...evidenceProviders,
      // The normal Vitest build intentionally aliases interactive evidence
      // preview imports to production-safe stubs. The harness applies the
      // typed fixture itself, then keeps AppComponent on its ordinary startup
      // path so those stubs cannot redirect the mounted route.
      { provide: AUTH_EVIDENCE_STATE, useValue: null },
      { provide: SEND_EVIDENCE_STATE, useValue: null },
      { provide: SETTINGS_EVIDENCE_STATE, useValue: null },
    ],
  }).compileComponents();
  const store = TestBed.inject(PopupStateStore);
  applyEvidenceState(testCase, store, TestBed.inject(SettingsService));
  const auth = TestBed.inject(AuthFacade);
  auth.restoreStartup = async () => startupResult(store);
  const router = TestBed.inject(Router);
  const fixture = TestBed.createComponent(AppComponent);
  fixture.detectChanges();
  await waitForAppStartup(fixture);
  await router.navigateByUrl(testCase.route);
  fixture.detectChanges();
  await fixture.whenStable();
  return { fixture, host: fixture.nativeElement as HTMLElement, router };
}

function applyEvidenceState(
  testCase: ProductionRouteStructuralCase,
  store: PopupStateStore,
  settings: SettingsService,
): void {
  const [key, value] = [...new URLSearchParams(testCase.evidenceSearch).entries()][0]!;
  switch (key) {
    case "authEvidence":
      applyAuthEvidenceState(store, value as AuthEvidenceState);
      if (testCase.route === "/lock" && !store.snapshot().email) {
        store.setLockedAccount("auth-evidence@example.test", "https://vault.example.test");
      }
      return;
    case "vaultEvidence":
      applyVaultMainEvidenceState(store, value as VaultMainEvidenceState);
      return;
    case "sendEvidence":
      applySendEvidenceState(store, value as SendEvidenceState);
      return;
    case "settingsEvidence":
      applySettingsEvidenceState(store, settings, value as SettingsEvidenceState);
      return;
  }
}

function startupResult(store: PopupStateStore): AuthStartupResult {
  const state = store.snapshot();
  if (state.isUnlocked) return "unlocked";
  return state.email ? "locked" : "login";
}

async function waitForAppStartup(fixture: ComponentFixture<AppComponent>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    fixture.detectChanges();
    if (!(fixture.nativeElement as HTMLElement).querySelector(
      ".app-bootstrap-loading--runtime",
    )) {
      return;
    }
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  }
  throw new Error("AppComponent startup did not settle for structural route mount");
}
