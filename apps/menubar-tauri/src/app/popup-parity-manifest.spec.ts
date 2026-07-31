import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  popupParityCompletionStatus,
  popupParityManifest,
  popupParitySummary,
  validateCompletedPopupParityEntries,
  type PopupParityEntry,
  type PopupParitySourceMapping,
} from "./popup-parity-manifest";
import {
  globalShortcutSettingsSourceRow,
  m12TextSendSourceRows,
  m13SettingsSourceRows,
  officialSourceMappings,
} from "./upstream-source-map";
import { evidenceCapturePath } from "../../e2e/evidence-path";

const m11GeneratorEvidencePath = "docs/superpowers/screenshots/m11-generator-2026-07-19";
const m11GeneratorRuntimeResultPath =
  "docs/superpowers/specs/2026-07-19-m11-generator-runtime-result.md";
const m11GeneratorAuthorities = [
  "generator-password-480x600.png",
  "generator-passphrase-480x600.png",
  "generator-username-word-480x600.png",
  "generator-username-plus-address-480x600.png",
  "generator-username-catchall-480x600.png",
  "generator-long-value-480x600.png",
  "generator-history-populated-480x600.png",
  "generator-history-clear-confirmation-480x600.png",
  "generator-history-empty-480x600.png",
] as const;
const m13SettingsEvidencePath = "docs/superpowers/screenshots/m13-settings-2026-07-20";
const m13SettingsRuntimeResultPath =
  "docs/superpowers/specs/2026-07-20-m13-settings-runtime-result.md";
const m13SettingsRuntimeTest =
  "apps/menubar-tauri/e2e/official-settings-workflows.spec.ts";
const m15NativeRuntimeResultPath =
  "docs/superpowers/specs/2026-07-13-macos-runtime-result.md";
const alternativeUnlockRuntimeTest =
  "apps/menubar-tauri/e2e/pin-biometric-unlock.spec.ts";
const m15CrossMilestoneAttestationPath =
  "docs/superpowers/specs/2026-07-22-m15-evidence-attestation.json";
const canonicalM15Evidence = [
  {
    milestone: "M11",
    provenancePath: "docs/superpowers/screenshots/m11-generator-2026-07-19/PROVENANCE.md",
  },
  {
    milestone: "M12",
    provenancePath: "docs/superpowers/screenshots/m12-text-send-2026-07-19/PROVENANCE.md",
  },
  {
    milestone: "M13",
    provenancePath: "docs/superpowers/screenshots/m13-settings-2026-07-20/provenance.json",
  },
] as const;
const m13SettingsAuthorities = [
  "settings-main-480x600.png",
  "account-security-480x600.png",
  "vault-settings-480x600.png",
  "vault-settings-sync-failure-480x600.png",
  "one-field-settings-480x600.png",
  "appearance-480x600.png",
  "about-480x600.png",
  "about-dialog-480x600.png",
  "change-password-handoff-480x600.png",
] as const;
const localEvidenceRoot = "docs/superpowers/";

function expectLocalEvidenceIsPrivate(reference: string): void {
  expect(reference.startsWith(localEvidenceRoot)).toBe(true);
  const ignoreRules = readFileSync(join(process.cwd(), ".gitignore"), "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim());
  expect(ignoreRules).toContain(localEvidenceRoot);
}

const expectedInventory = [
  { id: "auth.startup", officialRoutes: ["root redirect"], classification: "required-native", status: "partial" },
  { id: "auth.login-email", officialRoutes: ["/login"], classification: "required-native", status: "partial" },
  { id: "auth.login-password", officialRoutes: ["/login"], classification: "required-native", status: "partial" },
  { id: "auth.environment", officialRoutes: ["/login"], classification: "required-native", status: "partial" },
  { id: "auth.password-hint", officialRoutes: ["/hint"], classification: "required-native", status: "partial" },
  { id: "auth.two-factor-select", officialRoutes: ["/2fa"], classification: "required-native", status: "partial" },
  { id: "auth.two-factor-code", officialRoutes: ["/2fa"], classification: "required-native", status: "partial" },
  {
    id: "auth.new-device",
    officialRoutes: ["/new-device-verification"],
    classification: "required-native",
    status: "partial",
  },
  { id: "auth.lock", officialRoutes: ["/lock"], classification: "required-native", status: "partial" },
  { id: "auth.account-menu", officialRoutes: ["current route header"], classification: "required-native", status: "partial" },
  {
    id: "auth.account-switch",
    officialRoutes: ["/account-switcher"],
    classification: "required-native",
    status: "partial",
  },
  {
    id: "auth.offline-restore",
    officialRoutes: ["startup restore", "/lock", "/tabs/vault"],
    classification: "required-native",
    status: "partial",
  },
  { id: "vault.header", officialRoutes: ["/tabs/vault"], classification: "required-native", status: "partial" },
  { id: "vault.new-menu", officialRoutes: ["/tabs/vault"], classification: "required-native", status: "partial" },
  { id: "vault.search", officialRoutes: ["/tabs/vault"], classification: "required-native", status: "partial" },
  { id: "vault.filters", officialRoutes: ["/tabs/vault"], classification: "required-native", status: "partial" },
  { id: "vault.sections", officialRoutes: ["/tabs/vault"], classification: "required-native", status: "partial" },
  { id: "vault.row", officialRoutes: ["/tabs/vault"], classification: "required-native", status: "partial" },
  { id: "vault.row-copy", officialRoutes: ["/tabs/vault"], classification: "required-native", status: "partial" },
  { id: "vault.row-menu", officialRoutes: ["/tabs/vault"], classification: "required-native", status: "partial" },
  { id: "vault.loading", officialRoutes: ["/tabs/vault"], classification: "required-native", status: "partial" },
  { id: "vault.empty", officialRoutes: ["/tabs/vault"], classification: "required-native", status: "partial" },
  { id: "vault.no-results", officialRoutes: ["/tabs/vault"], classification: "required-native", status: "partial" },
  { id: "vault.offline-error", officialRoutes: ["/tabs/vault"], classification: "required-native", status: "partial" },
  ...[
    "cipher.view-shell",
    "cipher.view-login",
    "cipher.view-card",
    "cipher.view-identity",
    "cipher.view-note",
    "cipher.reveal-copy",
    "cipher.one-field",
    "cipher.uri",
    "cipher.totp",
    "cipher.lifecycle",
  ].map((id) => ({ id, officialRoutes: ["/view-cipher"], classification: "required-native" as const, status: "partial" as const })),
  { id: "vault.new-item", officialRoutes: ["/new-item"], classification: "required-native", status: "partial" },
  ...[
    "cipher.form-shell",
    "cipher.form-login",
    "cipher.form-card",
    "cipher.form-identity",
    "cipher.form-note",
    "cipher.form-validation",
    "cipher.form-preservation",
    "cipher.form-races",
  ].map((id) => ({
    id,
    officialRoutes: ["/add-cipher", "/edit-cipher", "/clone-cipher"],
    classification: "required-native" as const,
    status: "partial" as const,
  })),
  {
    id: "vault.password-history",
    officialRoutes: ["/cipher-password-history"],
    classification: "required-native",
    status: "partial",
  },
  { id: "vault.folders", officialRoutes: ["/folders"], classification: "required-native", status: "partial" },
  { id: "vault.archive", officialRoutes: ["/archive"], classification: "required-native", status: "partial" },
  { id: "vault.trash", officialRoutes: ["/trash"], classification: "required-native", status: "partial" },
  {
    id: "generator.main",
    officialRoutes: ["/tabs/generator", "/generator"],
    classification: "required-native",
    status: "partial",
  },
  {
    id: "generator.history",
    officialRoutes: ["/generator-history"],
    classification: "required-native",
    status: "partial",
  },
  { id: "send.list", officialRoutes: ["/tabs/send"], classification: "required-native", status: "partial" },
  { id: "send.view", officialRoutes: ["/edit-send"], classification: "required-native", status: "partial" },
  { id: "send.form", officialRoutes: ["/add-send", "/edit-send"], classification: "required-native", status: "partial" },
  { id: "send.created", officialRoutes: ["/send-created"], classification: "required-native", status: "partial" },
  { id: "send.lifecycle", officialRoutes: ["/tabs/send", "/add-send", "/edit-send", "/send-created"], classification: "required-native", status: "partial" },
  { id: "settings.main", officialRoutes: ["/tabs/settings"], classification: "required-native", status: "partial" },
  {
    id: "settings.global-shortcut",
    officialRoutes: ["/keyboard-shortcut"],
    classification: "required-native",
    status: "partial",
  },
  {
    id: "settings.account-security",
    officialRoutes: ["/account-security"],
    classification: "required-native",
    status: "partial",
  },
  { id: "settings.vault", officialRoutes: ["/vault-settings"], classification: "required-native", status: "partial" },
  {
    id: "settings.autofill-replacement",
    officialRoutes: ["/autofill"],
    classification: "required-native",
    status: "partial",
  },
  { id: "settings.appearance", officialRoutes: ["/appearance"], classification: "required-native", status: "partial" },
  { id: "settings.about", officialRoutes: ["/about"], classification: "required-native", status: "partial" },
  {
    id: "handoff.change-password",
    officialRoutes: ["/settings-password"],
    classification: "web-vault-handoff",
    status: "partial",
  },
  {
    id: "native.tray-window",
    officialRoutes: ["tray", "popup", "pop-out"],
    classification: "required-native",
    status: "partial",
  },
  {
    id: "native.keychain",
    officialRoutes: ["secure account/session storage"],
    classification: "required-native",
    status: "partial",
  },
  {
    id: "native.clipboard",
    officialRoutes: ["copy and timed clear"],
    classification: "required-native",
    status: "partial",
  },
  {
    id: "native.one-field-fill",
    officialRoutes: ["selected field paste"],
    classification: "required-native",
    status: "partial",
  },
  {
    id: "native.url-open",
    officialRoutes: ["environment-aware external URL"],
    classification: "required-native",
    status: "partial",
  },
  {
    id: "native.permissions",
    officialRoutes: ["permission checks and feedback"],
    classification: "required-native",
    status: "partial",
  },
  {
    id: "excluded.current-tab",
    officialRoutes: ["/tabs/current", "URL ranking"],
    classification: "excluded-browser",
    status: "missing",
  },
  {
    id: "excluded.dom-autofill",
    officialRoutes: ["content/DOM autofill"],
    classification: "excluded-browser",
    status: "missing",
  },
  {
    id: "excluded.browser-background",
    officialRoutes: ["background", "messaging", "badge", "page action"],
    classification: "excluded-browser",
    status: "missing",
  },
  {
    id: "excluded.browser-navigation",
    officialRoutes: ["webRequest", "webNavigation"],
    classification: "excluded-browser",
    status: "missing",
  },
  {
    id: "excluded.native-messaging",
    officialRoutes: ["desktop native messaging"],
    classification: "excluded-browser",
    status: "missing",
  },
  {
    id: "excluded.fido2",
    officialRoutes: ["/fido2 interception"],
    classification: "excluded-browser",
    status: "missing",
  },
  {
    id: "excluded.browser-prompts",
    officialRoutes: ["default-manager", "triage", "phishing", "intro"],
    classification: "excluded-browser",
    status: "missing",
  },
] as const;

const expectedSummary = expectedInventory.reduce(
  (summary, entry) =>
    entry.classification === "excluded-browser"
      ? summary
      : { ...summary, [entry.status]: summary[entry.status] + 1 },
  { missing: 0, partial: 0, complete: 0 },
);

const expectedAuditEvidencePath = "docs/superpowers/specs/2026-07-10-popup-completeness-audit.md";
const expectedGlobalShortcutEvidencePath =
  "docs/superpowers/reports/2026-07-24-global-shortcut-settings.md";
const expectedTask5VisualEvidencePath = "docs/superpowers/screenshots/standard-auth-server-matrix-2026-07-11";
const expectedTask5NativeEvidencePath = "docs/superpowers/specs/2026-07-11-standard-auth-server-matrix-result.md";
const expectedPasswordHistoryUpstreamSources = [
  "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/vault-password-history/vault-password-history.component.ts",
  "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/vault-password-history/vault-password-history.component.html",
  "vendor/bitwarden-clients/apps/browser/src/vault/popup/services/browser-view-password-history.service.ts",
  "vendor/bitwarden-clients/libs/vault/src/components/password-history-view/password-history-view.component.ts",
  "vendor/bitwarden-clients/libs/vault/src/components/password-history-view/password-history-view.component.html",
] as const;
const expectedPasswordHistoryTests = [
  "apps/menubar-tauri/src/app/app.routes.spec.ts",
  "apps/menubar-tauri/src/app/vault/vault-password-history-page.component.spec.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/recovery/password-history/official-password-history-view.component.spec.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/recovery/recovery-overlay.guard.spec.ts",
  "apps/menubar-tauri/e2e/vault-login-workflow.spec.ts",
  "apps/menubar-tauri/e2e/official-recovery-workflows.spec.ts",
] as const;
const expectedStartupTests = [
  "apps/menubar-tauri/src/app/auth/auth.facade.spec.ts",
  "apps/menubar-tauri/src/app/app.component.spec.ts",
] as const;
const expectedStartupUpstreamSources = [
  "vendor/bitwarden-clients/apps/browser/src/popup/app-routing.module.ts",
  "vendor/bitwarden-clients/libs/angular/src/auth/guards/redirect/redirect.guard.ts",
  "vendor/bitwarden-clients/apps/browser/src/platform/popup/components/popup-focus-wrap.directive.ts",
] as const;
const expectedStartupRemainingGaps = [
  "Credentialed startup-restore results for Bitwarden US and EU remain open because cloud credentials were not supplied.",
  "Cross-account active-account restoration remains unrun because second-account credentials were not supplied.",
  "Task 8 did not exercise deterministic or credentialed startup restore or relaunch behavior.",
  "Current-head native startup and Keychain lifecycle evidence is not available.",
] as const;
const expectedStartupEvidence = [
  { gate: "visual", path: expectedTask5VisualEvidencePath, surfaceIds: ["auth.startup"] },
  { gate: "audit", path: expectedAuditEvidencePath, surfaceIds: ["auth.startup"] },
] as const;
const expectedLoginTests = [
  "apps/menubar-tauri/src/app/auth/login-page.component.spec.ts",
  "apps/menubar-tauri/src/app/auth/official-password-auth.adapter.spec.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/auth/login/auth-login-overlay.guard.spec.ts",
  "apps/menubar-tauri/src/app/auth/login-environment-selector.component.spec.ts",
  "apps/menubar-tauri/src/app/auth/official-environment.adapter.spec.ts",
  "apps/menubar-tauri/src/app/auth/auth.facade.spec.ts",
  "apps/menubar-tauri/src/app/auth/standard-server-matrix.spec.ts",
  "apps/menubar-tauri/src/auth/live-standard-password-login.spec.ts",
] as const;
const expectedLoginPageUpstreamSources = [
  "vendor/bitwarden-clients/libs/auth/src/angular/login/login.component.ts",
  "vendor/bitwarden-clients/libs/auth/src/angular/login/login.component.html",
  "vendor/bitwarden-clients/libs/auth/src/angular/login/login-component.service.ts",
] as const;
const expectedLoginUpstreamSources = [
  ...expectedLoginPageUpstreamSources,
  "vendor/bitwarden-clients/apps/browser/src/popup/components/extension-anon-layout-wrapper/extension-anon-layout-wrapper.component.ts",
  "vendor/bitwarden-clients/apps/browser/src/popup/components/extension-anon-layout-wrapper/extension-anon-layout-wrapper.component.html",
  "vendor/bitwarden-clients/libs/angular/src/auth/environment-selector/environment-selector.component.ts",
  "vendor/bitwarden-clients/libs/angular/src/auth/environment-selector/environment-selector.component.html",
  "vendor/bitwarden-clients/libs/angular/src/auth/self-hosted-env-config-dialog/self-hosted-env-config-dialog.component.ts",
  "vendor/bitwarden-clients/libs/angular/src/auth/self-hosted-env-config-dialog/self-hosted-env-config-dialog.component.html",
] as const;
const expectedLoginLocalModules = [
  "apps/menubar-tauri/src/app/auth/login-page.component.ts",
  "apps/menubar-tauri/src/app/auth/official-password-auth.adapter.ts",
  "apps/menubar-tauri/src/app/auth/official-environment.adapter.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/auth/anonymous/official-anonymous-shell.component.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/auth/environment/official-environment-selector.component.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/auth/environment/official-self-hosted-dialog.component.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/auth/login/official-password-login.component.ts",
] as const;
const expectedLoginRemainingGaps = [
  "Credentialed Bitwarden US and EU password login/sync remains open because cloud credentials were not supplied.",
  "Credentialed Argon2id cloud and self-hosted password login/sync remains open because explicit Argon2id account credentials were not supplied.",
  "Credentialed password-auth failure and failed-initial-sync cleanup outcomes remain unrun.",
] as const;
const expectedLoginEvidence = [
  { gate: "visual", path: expectedTask5VisualEvidencePath, surfaceIds: ["auth.login"] },
  { gate: "audit", path: expectedAuditEvidencePath, surfaceIds: ["auth.login"] },
] as const;
const expectedLockTests = [
  "apps/menubar-tauri/src/app/auth/lock-page.component.spec.ts",
  "apps/menubar-tauri/src/app/auth/official-master-password-unlock.adapter.spec.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/auth/lock/auth-lock-overlay.guard.spec.ts",
  "apps/menubar-tauri/src/app/auth/auth.facade.spec.ts",
  "apps/menubar-tauri/src/app/app.component.spec.ts",
] as const;
const expectedLockUpstreamSources = [
  "vendor/bitwarden-clients/libs/key-management-ui/src/lock/components/lock.component.ts",
  "vendor/bitwarden-clients/libs/key-management-ui/src/lock/components/lock.component.html",
  "vendor/bitwarden-clients/libs/key-management-ui/src/lock/components/master-password-lock/master-password-lock.component.ts",
  "vendor/bitwarden-clients/libs/key-management-ui/src/lock/components/master-password-lock/master-password-lock.component.html",
] as const;
const expectedLockRemainingGaps = [
  "Credentialed locked-session unlock outcomes for Bitwarden US and EU remain open because cloud credentials were not supplied.",
  "Current-bundle logout remains unrun pending action-time confirmation because it deletes the local Keychain account.",
  "Current-head native locked-session unlock and Keychain lifecycle evidence is not available.",
] as const;
const expectedLockEvidence = [
  { gate: "visual", path: expectedTask5VisualEvidencePath, surfaceIds: ["auth.lock"] },
  { gate: "audit", path: expectedAuditEvidencePath, surfaceIds: ["auth.lock"] },
] as const;
const expectedTwoFactorTests = [
  "apps/menubar-tauri/src/app/auth/auth.facade.spec.ts",
  "apps/menubar-tauri/src/app/auth/auth-challenge-pages.spec.ts",
  "apps/menubar-tauri/src/app/auth/standard-server-matrix.spec.ts",
] as const;
const expectedTwoFactorUpstreamSources = [
  "vendor/bitwarden-clients/apps/browser/src/auth/services/extension-two-factor-auth-component.service.ts",
  "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/two-factor-auth.component.ts",
  "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/two-factor-auth.component.html",
  "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/two-factor-options.component.ts",
  "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/two-factor-options.component.html",
] as const;
const expectedTwoFactorRemainingGaps = [
  "Live provider-0 and provider-1 challenge success, failure, and cancel/back flows remain unrun because challenge credentials were not supplied.",
  "Current-bundle Keychain behavior for incomplete two-factor challenges remains unverified.",
] as const;
const expectedTwoFactorEvidence = [
  { gate: "visual", path: expectedTask5VisualEvidencePath, surfaceIds: ["auth.two-factor"] },
  { gate: "audit", path: expectedAuditEvidencePath, surfaceIds: ["auth.two-factor"] },
] as const;
const expectedNewDeviceTests = [
  "apps/menubar-tauri/src/app/auth/auth.facade.spec.ts",
  "apps/menubar-tauri/src/app/auth/auth-challenge-pages.spec.ts",
  "apps/menubar-tauri/src/app/auth/official-new-device.adapter.spec.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/auth/new-device/auth-new-device-overlay.guard.spec.ts",
] as const;
const expectedNewDeviceUpstreamSources = [
  "vendor/bitwarden-clients/apps/browser/src/auth/services/new-device-verification/extension-new-device-verification-component.service.ts",
  "vendor/bitwarden-clients/libs/auth/src/angular/new-device-verification/new-device-verification.component.ts",
  "vendor/bitwarden-clients/libs/auth/src/angular/new-device-verification/new-device-verification.component.html",
] as const;
const expectedNewDeviceRemainingGaps = [
  "Live new-device email-OTP success, failure, and cancel/back flows remain unrun because challenge credentials were not supplied.",
  "Current-bundle Keychain behavior for incomplete new-device verification remains unverified.",
] as const;
const expectedNewDeviceEvidence = [
  { gate: "visual", path: expectedTask5VisualEvidencePath, surfaceIds: ["auth.new-device"] },
  { gate: "audit", path: expectedAuditEvidencePath, surfaceIds: ["auth.new-device"] },
] as const;
const expectedPasswordHintTests = [
  "apps/menubar-tauri/src/app/auth/password-hint-page.component.spec.ts",
  "apps/menubar-tauri/src/app/auth/official-password-hint-api.adapter.spec.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/auth/login/auth-login-overlay.guard.spec.ts",
  "apps/menubar-tauri/src/app/auth/auth-challenge-pages.spec.ts",
  "apps/menubar-tauri/src/app/auth/standard-server-matrix.spec.ts",
] as const;
const expectedPasswordHintUpstreamSources = [
  "vendor/bitwarden-clients/libs/auth/src/angular/password-hint/password-hint.component.ts",
  "vendor/bitwarden-clients/libs/auth/src/angular/password-hint/password-hint.component.html",
] as const;
const expectedPasswordHintLocalModules = [
  "apps/menubar-tauri/src/app/auth/password-hint-page.component.ts",
  "apps/menubar-tauri/src/app/auth/official-password-hint-api.adapter.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/auth/login/official-password-hint.component.ts",
] as const;
const expectedPasswordHintRemainingGaps = [
  "Current-bundle 480x600 source comparison for the password-hint request flow remains unrun.",
  "Credentialed password-hint delivery remains unrun for Bitwarden US, EU, and self-hosted accounts.",
  "Current-bundle Keychain behavior for password-hint requests remains unverified.",
] as const;
const expectedAccountSwitcherTests = [
  "apps/menubar-tauri/src/app/auth/auth.facade.spec.ts",
  "apps/menubar-tauri/src/app/auth/official-account-switcher.adapter.spec.ts",
  "apps/menubar-tauri/src/app/settings/account-actions-page.component.spec.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/auth-account-switching-overlay.guard.spec.ts",
  "apps/menubar-tauri/src/app/app.component.spec.ts",
  "apps/menubar-tauri/e2e/generator-account-settings.spec.ts",
] as const;
const expectedAccountSwitcherLocalModules = [
  "apps/menubar-tauri/src/app/auth/official-account-switcher.adapter.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/official-account-switcher.component.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/official-account.component.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/official-account-switcher.transform-manifest.json",
  "apps/menubar-tauri/src/app/popup-header-actions.component.ts",
] as const;
const expectedAccountSwitcherUpstreamSources = [
  "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/account-switcher.component.ts",
  "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/account-switcher.component.html",
  "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/account.component.ts",
  "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/account.component.html",
  "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/current-account.component.ts",
  "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/current-account.component.html",
  "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/services/account-switcher.service.ts",
] as const;
const expectedAccountSwitcherRemainingGaps = [
  "Cross-account switching and restore remain unrun because second-account credentials were not supplied.",
  "Current-bundle logout remains unrun pending action-time confirmation because it deletes the local Keychain account.",
] as const;
const expectedAccountSwitcherEvidence = [
  {
    gate: "visual",
    path: "docs/superpowers/screenshots/g3-generator-account-settings-2026-07-13",
    surfaceIds: ["auth.account-switcher"],
  },
  {
    gate: "audit",
    path: "docs/superpowers/specs/2026-07-12-official-popup-scope-ui-audit.md",
    surfaceIds: ["auth.account-switcher"],
  },
] as const;
const expectedKeychainLocalModules = [
  "apps/menubar-tauri/src/auth/account-session-store.ts",
  "apps/menubar-tauri/src-tauri/src/keychain.rs",
] as const;
const expectedKeychainTests = ["apps/menubar-tauri/src-tauri/src/keychain.rs"] as const;
const expectedKeychainRemainingGaps = [
  "Current built-app two-account, selected-account removal, online relaunch, and offline relaunch remain blocked because disposable second-account credentials were unavailable; no historical credentials were used.",
] as const;
const expectedKeychainEvidence = [
  { gate: "native", path: expectedTask5NativeEvidencePath, surfaceIds: ["native.keychain"] },
  { gate: "audit", path: expectedAuditEvidencePath, surfaceIds: ["native.keychain"] },
  { gate: "audit", path: m15NativeRuntimeResultPath, surfaceIds: ["native.keychain"] },
] as const;
const expectedNewItemTests = [
  "apps/menubar-tauri/src/app/app.routes.spec.ts",
  "apps/menubar-tauri/src/app/vault/new-item-page.component.spec.ts",
] as const;
const expectedNewItemUpstreamSources = [
  "vendor/bitwarden-clients/apps/browser/src/popup/app-routing.module.ts",
  "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/new-item-page/new-item-page.component.ts",
  "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/new-item-page/new-item-page.component.html",
  "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/new-item-dropdown/new-item-dropdown.component.ts",
  "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/new-item-dropdown/new-item-dropdown.component.html",
  "vendor/bitwarden-clients/libs/vault/src/components/add-item-grid/add-item-grid.component.ts",
  "vendor/bitwarden-clients/libs/vault/src/components/add-item-grid/add-item-grid.component.html",
  "vendor/bitwarden-clients/libs/vault/src/components/add-edit-folder-dialog/add-edit-folder-dialog.component.ts",
  "vendor/bitwarden-clients/libs/vault/src/components/add-edit-folder-dialog/add-edit-folder-dialog.component.html",
] as const;
const expectedNewItemRemainingGaps = [
  "Route-specific visual/native/audit evidence for the current Tauri new-item bundle is still missing.",
] as const;

const expectedExcludedReasons = new Map([
  ["excluded.current-tab", "Browser tab and current-URL detection. Current-site suggestion ranking."],
  ["excluded.dom-autofill", "DOM or multi-field autofill. Content scripts and page-detail parsing."],
  ["excluded.browser-background", "Browser background/service-worker messaging."],
  ["excluded.browser-navigation", "`webRequest`, `webNavigation`, badge, and page-action behavior."],
  ["excluded.native-messaging", "Native messaging to the official desktop application."],
  ["excluded.fido2", "Browser FIDO2/passkey interception."],
  [
    "excluded.browser-prompts",
    "Browser default-password-manager prompts, autofill triage, phishing interstitial injection, and install/intro marketing surfaces.",
  ],
]);

describe("popupParityManifest", () => {
  it("contains no deferred Plan A manifest surface", () => {
    const ids = popupParityManifest.map((entry) => entry.id);
    expect(ids).not.toEqual(expect.arrayContaining([
      "vault.attachments",
      "vault.assign-collections",
      "vault.import",
      "vault.export",
      "vault.at-risk",
      "send.file-transfer",
      "settings.notifications",
    ]));
  });

  it("narrows retained settings routes to Plan A", () => {
    const entry = (id: string) => popupParityManifest.find((item) => item.id === id);
    expect(entry("settings.account-security")?.localRoutes).toEqual(["/account-security"]);
    expect(entry("settings.autofill-replacement")?.localRoutes).toEqual(["/autofill"]);
    expect(entry("settings.global-shortcut")?.localRoutes).toEqual(["/keyboard-shortcut"]);
  });

  it("assigns all seven retained Settings rows to their exact M13 production owner", () => {
    expect(m13SettingsSourceRows).toEqual([
      expect.objectContaining({ id: "settings.main", ownership: "overlay", status: "partial" }),
      expect.objectContaining({ id: "settings.account-security", ownership: "overlay", status: "partial" }),
      expect.objectContaining({ id: "settings.vault", ownership: "overlay", status: "partial" }),
      expect.objectContaining({ id: "settings.autofill-replacement", ownership: "native", status: "partial" }),
      expect.objectContaining({ id: "settings.appearance", ownership: "overlay", status: "partial" }),
      expect.objectContaining({ id: "settings.about", ownership: "overlay", status: "partial" }),
      expect.objectContaining({ id: "handoff.change-password", ownership: "web-vault-handoff", status: "partial" }),
    ]);

    for (const row of m13SettingsSourceRows) {
      const manifestEntry = popupParityManifest.find((entry) => entry.id === row.id);
      expect(manifestEntry?.productionOwner, `${row.id} manifest owner`).toBe(row.ownership);
      expect(manifestEntry?.status, `${row.id} manifest status`).toBe("partial");
      expect(manifestEntry?.localModules, `${row.id} manifest local modules`).toEqual(row.localModules);
      expect(manifestEntry?.upstreamSources, `${row.id} manifest authorities`).toEqual(row.pinnedAuthorities);
      expect(manifestEntry?.tests, `${row.id} manifest tests`).toEqual(row.tests);
      expect(manifestEntry?.remainingGaps, `${row.id} manifest remaining gaps`).toEqual(row.remainingGaps);
      expect(row.pinnedAuthorities.length, `${row.id} authorities`).toBeGreaterThan(0);
      expect(row.localModules.length, `${row.id} local modules`).toBeGreaterThan(0);
      expect(row.tests.length, `${row.id} focused tests`).toBeGreaterThan(0);
      expect(row.evidencePath, `${row.id} M13 evidence`).toBe(m13SettingsRuntimeResultPath);
      expect(row.remainingGaps).toEqual(
        row.id === "settings.account-security"
          ? [
              "M15 built-app native proof remains open.",
              "M16 release-candidate comparison remains open.",
              "Physical signed-build Touch ID acceptance remains pending.",
              "Stable signing, notarization, stapling, and Gatekeeper acceptance remain release blockers.",
            ]
          : [
              "M15 built-app native proof remains open.",
              "M16 release-candidate comparison remains open.",
            ],
      );
    }
  });

  it("assigns the global shortcut route to one dedicated native Settings owner", () => {
    const manifestEntry = popupParityManifest.find(
      ({ id }) => id === globalShortcutSettingsSourceRow.id,
    );

    expect(globalShortcutSettingsSourceRow).toMatchObject({
      id: "settings.global-shortcut",
      ownership: "native",
      status: "partial",
    });
    expect(manifestEntry).toMatchObject({
      id: "settings.global-shortcut",
      officialRoutes: ["/keyboard-shortcut"],
      localRoutes: ["/keyboard-shortcut"],
      productionOwner: "native",
      status: "partial",
    });
    expect(manifestEntry?.localModules).toEqual(globalShortcutSettingsSourceRow.localModules);
    expect(manifestEntry?.upstreamSources).toEqual(globalShortcutSettingsSourceRow.pinnedAuthorities);
    expect(manifestEntry?.tests).toEqual(globalShortcutSettingsSourceRow.tests);
    expect(manifestEntry?.remainingGaps).toEqual(globalShortcutSettingsSourceRow.remainingGaps);
  });

  it.skipIf(!existsSync(join(process.cwd(), expectedGlobalShortcutEvidencePath)))(
    "resolves local evidence for the global shortcut Settings surface",
    () => {
    const surfaceId = globalShortcutSettingsSourceRow.id;
    const manifestEntry = popupParityManifest.find(({ id }) => id === surfaceId);
    const relevantEvidencePaths = [
      globalShortcutSettingsSourceRow.evidencePath,
      ...(manifestEntry?.evidence
        .filter(({ surfaceIds }) => surfaceIds.includes(surfaceId))
        .map(({ path }) => path) ?? []),
    ];

    expect(relevantEvidencePaths).toEqual([
      expectedGlobalShortcutEvidencePath,
      expectedGlobalShortcutEvidencePath,
    ]);

    for (const evidencePath of new Set(relevantEvidencePaths)) {
      const absolutePath = join(process.cwd(), evidencePath);
      expect(existsSync(absolutePath), evidencePath).toBe(true);
      const content = readFileSync(absolutePath, "utf8");
      expect(content, `${evidencePath} surface id`).toContain("settings.global-shortcut");
      expect(content, `${evidencePath} route`).toContain("/keyboard-shortcut");
    }
    },
  );

  it("maps all seven retained Settings rows to current nine-authority M13 evidence", () => {
    const ids = [
      "settings.main",
      "settings.account-security",
      "settings.vault",
      "settings.autofill-replacement",
      "settings.appearance",
      "settings.about",
      "handoff.change-password",
    ];
    const entries = popupParityManifest.filter(({ id }) => ids.includes(id));

    expect(entries.map(({ id }) => id)).toEqual(ids);
    for (const entry of entries) {
      expect(entry.tests).toContain(m13SettingsRuntimeTest);
      expect(entry.evidence).toEqual(expect.arrayContaining([
        { gate: "visual", path: m13SettingsEvidencePath, surfaceIds: [entry.id] },
        { gate: "audit", path: m13SettingsRuntimeResultPath, surfaceIds: [entry.id] },
      ]));
      expect(entry.remainingGaps).toEqual(
        entry.id === "settings.account-security"
          ? [
              "M15 built-app native proof remains open.",
              "M16 release-candidate comparison remains open.",
              "Physical signed-build Touch ID acceptance remains pending.",
              "Stable signing, notarization, stapling, and Gatekeeper acceptance remain release blockers.",
            ]
          : [
              "M15 built-app native proof remains open.",
              "M16 release-candidate comparison remains open.",
            ],
      );
    }

    expect(m13SettingsAuthorities).toHaveLength(9);
    expectLocalEvidenceIsPrivate(m13SettingsEvidencePath);
  });

  it("records the exact initial inventory once and in order", () => {
    expect(
      popupParityManifest.map(({ id, officialRoutes, classification, status }) => ({
        id,
        officialRoutes,
        classification,
        status,
      })),
    ).toEqual(expectedInventory);
    expect(new Set(popupParityManifest.map((entry) => entry.id)).size).toBe(expectedInventory.length);
  });

  it("splits Cipher Detail and Form into the exact 10 plus 8 partial rows", () => {
    const cipherEntries = popupParityManifest.filter((entry) => entry.id.startsWith("cipher."));
    const detailEntries = cipherEntries.filter((entry) => !entry.id.startsWith("cipher.form"));
    const formEntries = cipherEntries.filter((entry) => entry.id.startsWith("cipher.form"));

    expect(detailEntries).toHaveLength(10);
    expect(formEntries).toHaveLength(8);
    expect(cipherEntries.every((entry) => entry.status === "partial")).toBe(true);
    expect(popupParityManifest.some((entry) => entry.id === "vault.view")).toBe(false);
    expect(popupParityManifest.some((entry) => entry.id === "vault.add-edit-clone")).toBe(false);
    for (const id of [
      "cipher.view-card",
      "cipher.view-identity",
      "cipher.view-note",
      "cipher.form-card",
      "cipher.form-identity",
      "cipher.form-note",
    ]) {
      const gaps = popupParityManifest.find((entry) => entry.id === id)?.remainingGaps.join(" ") ?? "";
      expect(gaps).not.toContain("M9");
      expect(gaps).not.toContain("M10");
      expect(gaps).toContain("M14");
      expect(gaps).toContain("M15");
      expect(gaps).toContain("M16");
    }
  });

  it("preserves G2 history and appends current M9 evidence on every type-specific row", () => {
    const sharedEvidence = [
      ["visual", "docs/superpowers/screenshots/g2-personal-ciphers-2026-07-13"],
      ["audit", "docs/superpowers/screenshots/g2-personal-ciphers-2026-07-13/design-qa.md"],
      ["native", "docs/superpowers/screenshots/g2-personal-ciphers-2026-07-13/native/provenance.md"],
    ] as const;
    const typeEvidence = {
      card: "docs/superpowers/specs/2026-07-13-live-self-hosted-card-mutation-result.md",
      identity: "docs/superpowers/specs/2026-07-13-live-self-hosted-identity-mutation-result.md",
      note: "docs/superpowers/specs/2026-07-13-live-self-hosted-secure-note-mutation-result.md",
    } as const;

    for (const type of ["card", "identity", "note"] as const) {
      for (const surface of [`cipher.view-${type}`, `cipher.form-${type}`]) {
        const evidence = popupParityManifest.find((entry) => entry.id === surface)?.evidence;
        expect(evidence, surface).toEqual([
          ...sharedEvidence.map(([gate, path]) => ({ gate, path, surfaceIds: [surface] })),
          { gate: "audit", path: typeEvidence[type], surfaceIds: [surface] },
          {
            gate: "visual",
            path: "docs/superpowers/screenshots/m9-official-personal-ciphers-2026-07-17",
            surfaceIds: [surface],
          },
          {
            gate: "audit",
            path: "docs/superpowers/specs/2026-07-17-m9-official-personal-cipher-runtime-result.md",
            surfaceIds: [surface],
          },
          {
            gate: "visual",
            path: "docs/superpowers/screenshots/m10-recovery-2026-07-18",
            surfaceIds: [surface],
          },
          {
            gate: "audit",
            path: "docs/superpowers/specs/2026-07-18-m10-recovery-runtime-result.md",
            surfaceIds: [surface],
          },
        ]);
      }
    }
  });

  it("maps the six M9 rows to exact retained modules, pinned authorities, and focused tests", () => {
    const detailModules = [
      "apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.ts",
      "apps/menubar-tauri/src/app/vault/vault-detail-actions.adapter.ts",
      "apps/menubar-tauri/src/app/vault/personal-cipher-view.adapter.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-personal-cipher-detail.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-personal-detail.transform-manifest.json",
    ];
    const detailTests = [
      "apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.spec.ts",
      "apps/menubar-tauri/src/app/vault/vault-detail-actions.adapter.spec.ts",
      "apps/menubar-tauri/src/app/vault/personal-cipher-view.adapter.spec.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-personal-cipher-detail.component.spec.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/personal-cipher-detail-overlay.guard.spec.ts",
      "apps/menubar-tauri/e2e/vault-personal-cipher-workflows.spec.ts",
      "apps/menubar-tauri/e2e/official-personal-cipher-workflows.spec.ts",
      "apps/menubar-tauri/e2e/official-recovery-workflows.spec.ts",
    ];
    const formModules = [
      "apps/menubar-tauri/src/app/vault/vault-add-edit-page.component.ts",
      "apps/menubar-tauri/src/app/vault/personal-cipher-save-operation.ts",
      "apps/menubar-tauri/src/app/vault/retained-personal-cipher-form.adapter.ts",
      "apps/menubar-tauri/src/app/vault/vault-cipher-write.service.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-personal-cipher-form.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-personal-form.transform-manifest.json",
    ];
    const formTests = [
      "apps/menubar-tauri/src/app/vault/vault-add-edit-page.component.spec.ts",
      "apps/menubar-tauri/src/app/vault/personal-cipher-save-operation.spec.ts",
      "apps/menubar-tauri/src/app/vault/retained-personal-cipher-form.adapter.spec.ts",
      "apps/menubar-tauri/src/app/vault/vault-cipher-write.service.spec.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-personal-cipher-form.component.spec.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/cipher-form/personal-cipher-form-overlay.guard.spec.ts",
      "apps/menubar-tauri/e2e/vault-personal-cipher-workflows.spec.ts",
      "apps/menubar-tauri/e2e/official-personal-cipher-workflows.spec.ts",
      "apps/menubar-tauri/e2e/official-recovery-workflows.spec.ts",
    ];
    const pinnedByType = {
      card: [
        "vendor/bitwarden-clients/libs/vault/src/cipher-view/card-details/card-details-view.component.ts",
        "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/card-details-section/card-details-section.component.ts",
      ],
      identity: [
        "vendor/bitwarden-clients/libs/vault/src/cipher-view/view-identity-sections/view-identity-sections.component.ts",
        "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/identity/identity.component.ts",
      ],
      note: [
        "vendor/bitwarden-clients/libs/common/src/vault/models/view/secure-note.view.ts",
        "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/additional-options/additional-options-section.component.ts",
      ],
    } as const;

    for (const type of ["card", "identity", "note"] as const) {
      const detail = popupParityManifest.find((entry) => entry.id === `cipher.view-${type}`)!;
      const form = popupParityManifest.find((entry) => entry.id === `cipher.form-${type}`)!;
      expect(detail).toMatchObject({ status: "partial", localModules: detailModules, tests: detailTests });
      expect(form).toMatchObject({ status: "partial", localModules: formModules, tests: formTests });
      expect(detail.upstreamSources).toContain(pinnedByType[type][0]);
      expect(form.upstreamSources).toContain(pinnedByType[type][1]);
    }
  });

  it("does not claim any retained surface complete before direct source runtime proof", () => {
    expect(popupParitySummary()).toEqual(expectedSummary);
    expect(
      popupParityManifest
        .filter((entry) => entry.status === "complete")
        .map((entry) => entry.id),
    ).toEqual([]);
  });

  it("keeps the overall retained product partial while any retained surface is partial", () => {
    expect(popupParityCompletionStatus()).toBe("partial");
  });

  it("writes evidence to test output unless UPDATE_EVIDENCE=true", () => {
    const testInfo = {
      outputPath: (fileName: string) => `/test-output/${fileName}`,
      project: { name: "chromium" },
    };
    const authoritativePath = "/authoritative/evidence/surface-480x600.png";

    expect(evidenceCapturePath(testInfo, authoritativePath, {})).toBe(
      "/test-output/surface-480x600.png",
    );
    expect(evidenceCapturePath(testInfo, authoritativePath, { UPDATE_EVIDENCE: "true" })).toBe(
      authoritativePath,
    );
    expect(
      evidenceCapturePath(
        { ...testInfo, project: { name: "webkit" } },
        authoritativePath,
        { UPDATE_EVIDENCE: "true" },
      ),
    ).toBe("/test-output/surface-480x600.png");
  });

  it("removes excluded authentication surfaces from the manifest inventory", () => {
    expect(popupParityManifest.map((entry) => entry.id)).not.toEqual(
      expect.arrayContaining([
        "auth.signup",
        "auth.sso",
        "auth.device-approval",
        "auth.passkey-handoff",
        "handoff.premium",
        "handoff.admin",
        "handoff.products",
      ]),
    );
    expect(popupParitySummary()).toEqual({ missing: 0, partial: 68, complete: 0 });
  });

  it.skipIf(
    !existsSync(
      join(
        process.cwd(),
        "docs/superpowers/specs/2026-07-15-m5-m6-task-6-runtime-result.md",
      ),
    ),
  )("tracks the exact 12 Vault Main rows with current Task 6 evidence and open live/native gates", () => {
    const ids = [
      "vault.header",
      "vault.new-menu",
      "vault.search",
      "vault.filters",
      "vault.sections",
      "vault.row",
      "vault.row-copy",
      "vault.row-menu",
      "vault.loading",
      "vault.empty",
      "vault.no-results",
      "vault.offline-error",
    ];
    const entries = popupParityManifest.filter((entry) => ids.includes(entry.id));

    expect(entries.map(({ id }) => id)).toEqual(ids);
    for (const entry of entries) {
      expect(entry).toMatchObject({ status: "partial", localRoutes: ["/tabs/vault"] });
      expect(entry.tests).toContain("apps/menubar-tauri/e2e/official-vault-main.spec.ts");
      expect(entry.evidence).toEqual(expect.arrayContaining([
        {
          gate: "visual",
          path: "docs/superpowers/screenshots/m5-m6-official-vault-main-2026-07-13",
          surfaceIds: [entry.id],
        },
        {
          gate: "audit",
          path: "docs/superpowers/specs/2026-07-15-m5-m6-task-6-runtime-result.md",
          surfaceIds: [entry.id],
        },
      ]));
      expect(entry.remainingGaps.join(" ")).toMatch(/Chrome|native/i);
    }

    const auditPath = join(
      process.cwd(),
      "docs/superpowers/specs/2026-07-15-m5-m6-task-6-runtime-result.md",
    );
    expect(existsSync(auditPath)).toBe(true);
    expect(readFileSync(auditPath, "utf8")).toContain("## Verification");
  });

  it("tracks the exact 12 Authentication/Accounts rows with Task 8 evidence contracts", () => {
    const expectedIds = [
      "auth.startup",
      "auth.login-email",
      "auth.login-password",
      "auth.environment",
      "auth.password-hint",
      "auth.two-factor-select",
      "auth.two-factor-code",
      "auth.new-device",
      "auth.lock",
      "auth.account-menu",
      "auth.account-switch",
      "auth.offline-restore",
    ];
    const authEntries = popupParityManifest.filter((entry) => entry.id.startsWith("auth."));
    const task8VisualRows = expectedIds.filter(
      (id) => !["auth.startup", "auth.offline-restore"].includes(id),
    );
    const task8LiveRows = ["auth.login-email", "auth.login-password", "auth.environment"];
    const task8LiveResultPath =
      "docs/superpowers/specs/2026-07-14-m3-m4-task-8-self-hosted-live-result.md";

    expect(authEntries.map((entry) => entry.id)).toEqual(expectedIds);
    for (const entry of authEntries) {
      expect(entry.status).toBe("partial");
      expect(entry.remainingGaps.length).toBeGreaterThan(0);
    }
    for (const id of task8VisualRows) {
      const entry = authEntries.find((candidate) => candidate.id === id)!;
      expect(entry.tests).toContain("apps/menubar-tauri/e2e/official-auth-accounts.spec.ts");
      expect(entry.evidence).toEqual(expect.arrayContaining([
        {
          gate: "visual",
          path: "docs/superpowers/screenshots/m3-m4-official-auth-accounts-2026-07-14",
          surfaceIds: [id],
        },
        {
          gate: "audit",
          path: "docs/superpowers/specs/2026-07-14-m3-m4-task-8-self-hosted-live-result.md",
          surfaceIds: [id],
        },
      ]));
    }
    for (const id of ["auth.startup", "auth.offline-restore"]) {
      const entry = authEntries.find((candidate) => candidate.id === id)!;
      expect(entry.evidence.map(({ path }) => path)).not.toContain(
        "docs/superpowers/screenshots/m3-m4-official-auth-accounts-2026-07-14",
      );
      expect(entry.evidence.map(({ path }) => path)).not.toContain(
        "docs/superpowers/specs/2026-07-14-m3-m4-task-8-self-hosted-live-result.md",
      );
      expect(entry.remainingGaps.join(" ")).toMatch(/startup|relaunch|restore/i);
    }
    for (const entry of authEntries) {
      const assertion = expect(entry.tests);
      if (task8LiveRows.includes(entry.id)) {
        assertion.toContain("apps/menubar-tauri/e2e/live/official-auth-live.spec.ts");
        expect(entry.evidence.filter(({ path }) => path === task8LiveResultPath)).toEqual([
          { gate: "audit", path: task8LiveResultPath, surfaceIds: [entry.id] },
        ]);
        expect(entry.remainingGaps.join(" ")).toMatch(/native Tauri\/Keychain/i);
      } else {
        assertion.not.toContain("apps/menubar-tauri/e2e/live/official-auth-live.spec.ts");
      }
    }
  });

  it("keeps auth.startup partial until the remaining route-evidence gates close", () => {
    const entry = popupParityManifest.find((candidate) => candidate.id === "auth.startup");
    expect(entry).toMatchObject({
      classification: "required-native",
      status: "partial",
      localRoutes: ["/"],
      upstreamSources: expectedStartupUpstreamSources,
      remainingGaps: expectedStartupRemainingGaps,
    });
    expect(entry?.tests).toEqual(expect.arrayContaining(expectedStartupTests));
    expect(entry?.evidence).toEqual(expect.arrayContaining(expectedStartupEvidence));
  });

  it.each([
    "auth.login-email",
    "auth.login-password",
    "auth.environment",
    "auth.password-hint",
    "auth.two-factor-select",
    "auth.two-factor-code",
    "auth.new-device",
    "auth.lock",
    "auth.account-menu",
    "auth.account-switch",
    "auth.offline-restore",
  ])("keeps %s partial with direct sources, tests, and explicit remaining gaps", (id) => {
      const entry = popupParityManifest.find((candidate) => candidate.id === id);
      expect(entry).toMatchObject({
        classification: "required-native",
        status: "partial",
      });
      expect(entry?.localModules.length).toBeGreaterThan(0);
      expect(entry?.upstreamSources.length).toBeGreaterThan(0);
      expect(entry?.tests.length).toBeGreaterThan(0);
      expect(entry?.remainingGaps.length).toBeGreaterThan(0);
  });

  it("records the repaired missing-Keychain path without overstating unrun lifecycle gates", () => {
    const entry = popupParityManifest.find((candidate) => candidate.id === "native.keychain");
    expect(entry).toMatchObject({
      classification: "required-native",
      status: "partial",
      localModules: expectedKeychainLocalModules,
      tests: expectedKeychainTests,
      evidence: expectedKeychainEvidence,
      remainingGaps: expectedKeychainRemainingGaps,
    });
  });

  it("records the current M15 native result without completing unobserved host surfaces", () => {
    for (const id of [
      "native.tray-window",
      "native.keychain",
      "native.clipboard",
      "native.one-field-fill",
      "native.url-open",
      "native.permissions",
    ]) {
      const entry = popupParityManifest.find((candidate) => candidate.id === id);

      expect(entry).toMatchObject({
        classification: "required-native",
        status: "partial",
      });
      expect(entry?.evidence).toEqual(expect.arrayContaining([
        { gate: "audit", path: m15NativeRuntimeResultPath, surfaceIds: [id] },
      ]));
      expect(entry?.remainingGaps.length).toBeGreaterThan(0);
    }

    const tray = popupParityManifest.find((candidate) => candidate.id === "native.tray-window");
    expect(tray?.remainingGaps).toContain(
      "The immediately prior release launched hidden; the final rebuild has only an exact process-path launch observation, so hidden startup and all tray interactions remain unverified.",
    );
  });

  it("records local PIN and native Touch ID without claiming physical acceptance", () => {
    const lock = popupParityManifest.find((entry) => entry.id === "auth.lock")!;
    const settings = popupParityManifest.find(
      (entry) => entry.id === "settings.account-security",
    )!;

    expect(lock.localModules).toEqual(expect.arrayContaining([
      "apps/menubar-tauri/src/app/auth/runtime-pin-vault.ts",
      "apps/menubar-tauri/src/app/auth/unlock-methods.service.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/lock/official-pin-lock.component.ts",
      "apps/menubar-tauri/src/host/biometric-host.ts",
    ]));
    expect(settings.localModules).toEqual(expect.arrayContaining([
      "apps/menubar-tauri/src/app/settings/pin-setup-dialog.component.ts",
      "apps/menubar-tauri/src/app/auth/unlock-methods.service.ts",
    ]));
    for (const entry of [lock, settings]) {
      expect(entry.tests).toContain(alternativeUnlockRuntimeTest);
      expect(entry.evidence).toContainEqual({
        gate: "audit",
        path: m15NativeRuntimeResultPath,
        surfaceIds: [entry.id],
      });
      expect(entry.remainingGaps).toEqual(expect.arrayContaining([
        "Physical signed-build Touch ID acceptance remains pending.",
        "Stable signing, notarization, stapling, and Gatekeeper acceptance remain release blockers.",
      ]));
      expect(entry.remainingGaps.join(" ")).not.toMatch(/PIN persists|persistent PIN/i);
    }
  });

  it("attests current M11-M13 provenance and retires historical path hashes", () => {
    expectLocalEvidenceIsPrivate(m15CrossMilestoneAttestationPath);
    if (!existsSync(join(process.cwd(), m15CrossMilestoneAttestationPath))) {
      return;
    }

    const attestation = JSON.parse(
      readFileSync(join(process.cwd(), m15CrossMilestoneAttestationPath), "utf8"),
    ) as {
      schema: string;
      vendorRevision: string;
      evidence: Array<{
        milestone: string;
        provenancePath: string;
        provenanceSha256: string;
        historicalRuntimeReport: string;
        historicalMachineReport: string;
      }>;
    };

    expect(attestation.schema).toBe("m15-cross-milestone-evidence-attestation-v1");
    expect(attestation.vendorRevision).toBe("f47b6946e01aed474875789081966d311d5b8289");
    expect(attestation.evidence.map(({ milestone, provenancePath }) => ({ milestone, provenancePath })))
      .toEqual(canonicalM15Evidence);

    for (const entry of attestation.evidence) {
      expectLocalEvidenceIsPrivate(entry.provenancePath);
      if (!existsSync(join(process.cwd(), entry.provenancePath))) {
        continue;
      }
      const provenance = readFileSync(join(process.cwd(), entry.provenancePath));
      expect(createHash("sha256").update(provenance).digest("hex"), entry.milestone)
        .toBe(entry.provenanceSha256);

      const runtime = readFileSync(join(process.cwd(), entry.historicalRuntimeReport), "utf8");
      expect(runtime, `${entry.milestone} runtime retirement`).toContain(
        `Attestation status: \`historical-retired\`. Superseded by \`${m15CrossMilestoneAttestationPath}\`.`,
      );

      const machine = JSON.parse(
        readFileSync(join(process.cwd(), entry.historicalMachineReport), "utf8"),
      ) as { attestationStatus?: string; supersededBy?: string };
      expect(machine.attestationStatus, `${entry.milestone} machine retirement`)
        .toBe("historical-retired");
      expect(machine.supersededBy, `${entry.milestone} machine successor`)
        .toBe(m15CrossMilestoneAttestationPath);
    }
  });

  it("records the retained folder creation handoff while vault.new-item awaits bundle evidence", () => {
    const entry = popupParityManifest.find((candidate) => candidate.id === "vault.new-item");
    expect(entry).toMatchObject({
      classification: "required-native",
      status: "partial",
      localRoutes: ["/new-item"],
      localModules: [
        "apps/menubar-tauri/src/app/vault/new-item-page.component.ts",
        "apps/menubar-tauri/src/app/vault/vault-folder-dialog.component.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/recovery/folders/official-add-edit-folder-dialog.component.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/recovery/official-recovery.transform-manifest.json",
      ],
      upstreamSources: expectedNewItemUpstreamSources,
      tests: expectedNewItemTests,
      remainingGaps: expectedNewItemRemainingGaps,
    });
    expect(entry?.evidence).toEqual([]);
  });

  it("keeps vault.password-history partial after current guarded M10 evidence", () => {
    const entry = popupParityManifest.find((candidate) => candidate.id === "vault.password-history");
    expect(entry).toMatchObject({
      classification: "required-native",
      status: "partial",
      localRoutes: ["/cipher-password-history"],
      localModules: [
        "apps/menubar-tauri/src/app/vault/vault-password-history-page.component.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/recovery/password-history/official-password-history-view.component.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/recovery/official-recovery.transform-manifest.json",
      ],
      upstreamSources: expectedPasswordHistoryUpstreamSources,
      tests: expectedPasswordHistoryTests,
      remainingGaps: [
        "M14 credentialed recovery proof remains open.",
        "M15 native recovery evidence remains open.",
        "M16 release comparison and audit closure remain open.",
      ],
    });
    expect(entry?.evidence).toEqual([
      {
        gate: "visual",
        path: "docs/superpowers/screenshots/g2-organization-recovery-2026-07-13",
        surfaceIds: ["vault.password-history"],
      },
      {
        gate: "native",
        path: "docs/superpowers/screenshots/g2-organization-recovery-2026-07-13/native/provenance.md",
        surfaceIds: ["vault.password-history"],
      },
      {
        gate: "audit",
        path: "docs/superpowers/screenshots/g2-organization-recovery-2026-07-13/design-qa.md",
        surfaceIds: ["vault.password-history"],
      },
      {
        gate: "audit",
        path: "docs/superpowers/specs/2026-07-13-live-self-hosted-login-mutation-result.md",
        surfaceIds: ["vault.password-history"],
      },
      {
        gate: "visual",
        path: "docs/superpowers/screenshots/m10-recovery-2026-07-18",
        surfaceIds: ["vault.password-history"],
      },
      {
        gate: "audit",
        path: "docs/superpowers/specs/2026-07-18-m10-recovery-runtime-result.md",
        surfaceIds: ["vault.password-history"],
      },
    ]);
  });

  it.each(["vault.archive", "vault.trash"] as const)(
    "records guarded retained runtime while %s remains partial for M14-M16",
    (id) => {
      const entry = popupParityManifest.find((candidate) => candidate.id === id);

      expect(entry).toMatchObject({
        classification: "required-native",
        status: "partial",
        localModules: expect.arrayContaining([
          "apps/menubar-tauri/src/app/vault/recovery-page-actions.adapter.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/recovery/official-recovery.transform-manifest.json",
        ]),
        tests: expect.arrayContaining([
          "apps/menubar-tauri/src/app/vault/recovery-page-actions.adapter.spec.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/recovery/recovery-overlay.guard.spec.ts",
          "apps/menubar-tauri/e2e/official-recovery-workflows.spec.ts",
        ]),
        remainingGaps: [
          "M14 credentialed recovery proof remains open.",
          "M15 native recovery evidence remains open.",
          "M16 release comparison and audit closure remain open.",
        ],
      });
      expect(entry?.evidence.map(({ gate }) => gate)).toEqual(
        expect.arrayContaining(["visual", "native", "audit"]),
      );
      expect(entry?.evidence).toEqual(expect.arrayContaining([
        { gate: "visual", path: "docs/superpowers/screenshots/m10-recovery-2026-07-18", surfaceIds: [id] },
        { gate: "audit", path: "docs/superpowers/specs/2026-07-18-m10-recovery-runtime-result.md", surfaceIds: [id] },
      ]));
      expect(entry?.evidence.every(({ surfaceIds }) => surfaceIds.includes(id))).toBe(true);
    },
  );

  it("records the guarded Generator Task 2 provider-free username convergence", () => {
    const entry = popupParityManifest.find((candidate) => candidate.id === "generator.main");

    expect(entry).toMatchObject({
      classification: "required-native",
      status: "partial",
      localModules: expect.arrayContaining([
        "apps/menubar-tauri/src/app/generator/generator-page.component.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/generator/official-credential-generator.component.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-core.component.ts",
        "vendor/bitwarden-clients/libs/tools/generator/components/src/password-settings.component.ts",
        "vendor/bitwarden-clients/libs/tools/generator/components/src/passphrase-settings.component.ts",
        "vendor/bitwarden-clients/libs/tools/generator/components/src/username-settings.component.ts",
        "vendor/bitwarden-clients/libs/tools/generator/components/src/subaddress-settings.component.ts",
        "vendor/bitwarden-clients/libs/tools/generator/components/src/catchall-settings.component.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator.transform-manifest.json",
      ]),
      tests: expect.arrayContaining([
        "apps/menubar-tauri/src/app/upstream-overlays/generator/generator-overlay.guard.spec.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/generator/official-credential-generator.component.spec.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/generator/official-username-settings.component.spec.ts",
        "apps/menubar-tauri/src/app/vault/retained-login-form.adapter.spec.ts",
      ]),
      remainingGaps: [
        "M14 credentialed Generator proof remains open.",
        "M15 native Generator evidence remains open.",
        "M16 release comparison and audit closure remain open.",
      ],
    });

    const history = popupParityManifest.find((candidate) => candidate.id === "generator.history");
    expect(history).toMatchObject({
      status: "partial",
      localModules: expect.arrayContaining([
        "apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-history.component.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-history-rows.component.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/generator/official-empty-generator-history.component.ts",
      ]),
      remainingGaps: [
        "M14 credentialed Generator history proof remains open.",
        "M15 native Generator history evidence remains open.",
        "M16 release comparison and audit closure remain open.",
      ],
    });
  });

  it("records exactly five partial M12 Text Send rows with M14-M16 release gaps", () => {
    const ids = ["send.list", "send.view", "send.form", "send.created", "send.lifecycle"];
    const entries = popupParityManifest.filter(({ id }) => id.startsWith("send."));

    expect(entries.map(({ id }) => id)).toEqual(ids);
    expect(m12TextSendSourceRows.map(({ id }) => id)).toEqual(ids);
    for (const entry of entries) {
      expect(entry).toMatchObject({ classification: "required-native", status: "partial" });
      expect(entry.tests).toContain("apps/menubar-tauri/e2e/official-send-workflows.spec.ts");
      expect(entry.evidence).toEqual(expect.arrayContaining([
        {
          gate: "visual",
          path: "docs/superpowers/screenshots/m12-text-send-2026-07-19",
          surfaceIds: [entry.id],
        },
        {
          gate: "audit",
          path: "docs/superpowers/specs/2026-07-19-m12-text-send-runtime-result.md",
          surfaceIds: [entry.id],
        },
      ]));
      expect(entry.remainingGaps).toEqual([
        "M14.4 credentialed Bitwarden US, EU, and compatible self-hosted Text Send mutation and cleanup proof remains open.",
        "M15 current-head native clipboard ownership and built-app lifecycle evidence remains open.",
        "M16 release-candidate comparison, accessibility, security, packaging, and audit closure remains open.",
      ]);
      expect(m12TextSendSourceRows.find(({ id }) => id === entry.id)).toMatchObject({
        status: "partial",
        remainingGates: entry.remainingGaps,
      });
    }

    const expectedInventories = new Map([
      ["send.list", {
        localModules: [
          "apps/menubar-tauri/src/app/send/send-page.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list-items-container.component.ts",
        ],
        upstreamSources: [
          "vendor/bitwarden-clients/apps/browser/src/tools/popup/send-v2/send-v2.component.html",
          "vendor/bitwarden-clients/apps/browser/src/tools/popup/send-v2/send-v2.component.ts",
          "vendor/bitwarden-clients/libs/tools/send/send-ui/src/send-list/send-list.component.ts",
          "vendor/bitwarden-clients/libs/tools/send/send-ui/src/send-list-items-container/send-list-items-container.component.html",
          "vendor/bitwarden-clients/libs/tools/send/send-ui/src/send-list-items-container/send-list-items-container.component.ts",
        ],
      }],
      ["send.view", {
        localModules: [
          "apps/menubar-tauri/src/app/send/send-add-edit-page.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-add-edit.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-details.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-text-details.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-options.component.ts",
        ],
        upstreamSources: [
          "vendor/bitwarden-clients/apps/browser/src/tools/popup/send-v2/add-edit/send-add-edit.component.html",
          "vendor/bitwarden-clients/apps/browser/src/tools/popup/send-v2/add-edit/send-add-edit.component.ts",
          "vendor/bitwarden-clients/libs/tools/send/send-ui/src/send-form/components/send-details/send-details.component.html",
          "vendor/bitwarden-clients/libs/tools/send/send-ui/src/send-form/components/send-details/send-details.component.ts",
          "vendor/bitwarden-clients/libs/tools/send/send-ui/src/send-form/components/send-details/send-text-details.component.html",
          "vendor/bitwarden-clients/libs/tools/send/send-ui/src/send-form/components/send-details/send-text-details.component.ts",
          "vendor/bitwarden-clients/libs/tools/send/send-ui/src/send-form/components/options/send-options.component.html",
          "vendor/bitwarden-clients/libs/tools/send/send-ui/src/send-form/components/options/send-options.component.ts",
        ],
      }],
      ["send.form", {
        localModules: [
          "apps/menubar-tauri/src/app/send/send-add-edit-page.component.ts",
          "apps/menubar-tauri/src/app/send/retained-text-send-form.service.ts",
          "apps/menubar-tauri/src/app/send/send-actions.service.ts",
          "apps/menubar-tauri/src/app/send/send-request.service.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-add-edit.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-details.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-text-details.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-options.component.ts",
        ],
        upstreamSources: [
          "vendor/bitwarden-clients/apps/browser/src/tools/popup/send-v2/add-edit/send-add-edit.component.html",
          "vendor/bitwarden-clients/apps/browser/src/tools/popup/send-v2/add-edit/send-add-edit.component.ts",
          "vendor/bitwarden-clients/libs/tools/send/send-ui/src/send-form/abstractions/send-form.service.ts",
          "vendor/bitwarden-clients/libs/tools/send/send-ui/src/send-form/components/options/send-options.component.html",
          "vendor/bitwarden-clients/libs/tools/send/send-ui/src/send-form/components/options/send-options.component.ts",
          "vendor/bitwarden-clients/libs/tools/send/send-ui/src/send-form/components/send-details/send-details.component.html",
          "vendor/bitwarden-clients/libs/tools/send/send-ui/src/send-form/components/send-details/send-details.component.ts",
          "vendor/bitwarden-clients/libs/tools/send/send-ui/src/send-form/components/send-details/send-text-details.component.html",
          "vendor/bitwarden-clients/libs/tools/send/send-ui/src/send-form/components/send-details/send-text-details.component.ts",
        ],
      }],
      ["send.created", {
        localModules: [
          "apps/menubar-tauri/src/app/send/send-created-page.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-created.component.ts",
        ],
        upstreamSources: [
          "vendor/bitwarden-clients/apps/browser/src/tools/popup/send-v2/send-created/send-created.component.html",
          "vendor/bitwarden-clients/apps/browser/src/tools/popup/send-v2/send-created/send-created.component.ts",
        ],
      }],
      ["send.lifecycle", {
        localModules: [
          "apps/menubar-tauri/src/app/send/text-send-operation.ts",
          "apps/menubar-tauri/src/app/send/send-actions.service.ts",
          "apps/menubar-tauri/src/app/send/send-request.service.ts",
          "apps/menubar-tauri/src/app/send/send.facade.ts",
        ],
        upstreamSources: [
          "vendor/bitwarden-clients/libs/common/src/tools/send/services/send.service.ts",
          "vendor/bitwarden-clients/apps/browser/src/tools/popup/send-v2/send-v2.component.ts",
        ],
      }],
    ]);
    for (const entry of entries) {
      const expected = expectedInventories.get(entry.id);
      expect(expected, entry.id).toBeDefined();
      expect(entry.localModules, `${entry.id} localModules`).toEqual(expected?.localModules);
      expect(entry.upstreamSources, `${entry.id} upstreamSources`).toEqual(expected?.upstreamSources);
    }
  });

  it("records current M10 folder evidence while M14-M16 remain open", () => {
    const entry = popupParityManifest.find((candidate) => candidate.id === "vault.folders");
    expect(entry).toMatchObject({
      classification: "required-native",
      status: "partial",
      localModules: expect.arrayContaining([
        "apps/menubar-tauri/src/app/upstream-overlays/recovery/folders/official-folders.component.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/recovery/folders/official-add-edit-folder-dialog.component.ts",
      ]),
      tests: expect.arrayContaining(["apps/menubar-tauri/e2e/official-recovery-workflows.spec.ts"]),
      remainingGaps: [
        "M14 credentialed recovery proof remains open.",
        "M15 native recovery evidence remains open.",
        "M16 release comparison and audit closure remain open.",
      ],
    });
    expect(entry?.evidence).toEqual(expect.arrayContaining([
      { gate: "visual", path: "docs/superpowers/screenshots/m10-recovery-2026-07-18", surfaceIds: ["vault.folders"] },
      { gate: "audit", path: "docs/superpowers/specs/2026-07-18-m10-recovery-runtime-result.md", surfaceIds: ["vault.folders"] },
    ]));
  });

  it("keeps excluded browser surfaces out of completion and names their product boundaries", () => {
    for (const entry of popupParityManifest.filter((candidate) => candidate.classification === "excluded-browser")) {
      expect(entry.status).toBe("missing");
      expect(entry.localRoutes).toEqual([]);
      expect(entry.exclusionReason).toBe(expectedExcludedReasons.get(entry.id));
      expect(entry.remainingGaps).toEqual(["Excluded from the macOS menubar product boundary."]);
    }
  });

  it("requires completed surfaces to have empty gaps, route-specific visual/native/audit evidence, existing evidence paths, and local source mappings", () => {
    expect(validateCompletedPopupParityEntries(
      popupParityManifest,
      officialSourceMappings,
      (path) => existsSync(join(process.cwd(), path)),
    )).toEqual([]);
  });

  it("accepts a valid isolated completed surface", () => {
    expect(validateSyntheticCompleteEntry()).toEqual([]);
  });

  it("rejects a completed surface without route-specific audit evidence", () => {
    const entry = syntheticCompleteEntry({ evidence: syntheticCompleteEntry().evidence.filter((evidence) => evidence.gate !== "audit") });

    expect(validateSyntheticCompleteEntry(entry)).toEqual([
      "synthetic.complete: completed entries require audit evidence",
    ]);
  });

  it("rejects a completed surface with remaining gaps", () => {
    const entry = syntheticCompleteEntry({ remainingGaps: ["Outstanding proof."] });

    expect(validateSyntheticCompleteEntry(entry)).toEqual([
      "synthetic.complete: completed entries must not list remaining gaps",
    ]);
  });

  it("rejects a completed surface with an unrelated claimed source", () => {
    const entry = syntheticCompleteEntry({ upstreamSources: [...syntheticCompleteEntry().upstreamSources, "upstream/unrelated.ts"] });

    expect(validateSyntheticCompleteEntry(entry)).toEqual([
      "synthetic.complete: upstream source upstream/unrelated.ts is not mapped from a claimed local module",
    ]);
  });

  it("rejects a completed surface that omits a source mapped from its local modules", () => {
    const entry = syntheticCompleteEntry({ upstreamSources: ["upstream/one.ts", "upstream/shared.ts"] });

    expect(validateSyntheticCompleteEntry(entry)).toEqual([
      "synthetic.complete: mapped upstream source upstream/two.ts is omitted from the entry",
    ]);
  });

  it("rejects a completed surface with a nonexistent evidence path", () => {
    const entry = syntheticCompleteEntry({
      evidence: [
        ...syntheticCompleteEntry().evidence,
        { gate: "audit", path: "proof/missing-audit", surfaceIds: ["synthetic.complete"] },
      ],
    });

    expect(validateSyntheticCompleteEntry(entry)).toEqual([
      "synthetic.complete: evidence path proof/missing-audit does not exist",
    ]);
  });

  it("references only real local modules, tests, upstream sources, and evidence paths", () => {
    for (const entry of popupParityManifest) {
      for (const reference of [...entry.localModules, ...entry.tests, ...entry.upstreamSources, ...entry.evidence.map((evidence) => evidence.path)]) {
        if (reference.startsWith(localEvidenceRoot)) {
          expectLocalEvidenceIsPrivate(reference);
          continue;
        }
        expect(existsSync(join(process.cwd(), reference))).toBe(true);
      }
    }
  });

  it("reserves the absent M13 runtime result for transactional controller publication", () => {
    const controller = readFileSync(
      join(process.cwd(), "scripts/run-m13-verification.mjs"),
      "utf8",
    );

    expect(controller).toContain(m13SettingsRuntimeResultPath);
    expect(controller).toContain("docs/superpowers/specs/2026-07-20-m13-machine-verification.json");
    expect(controller).toContain("publishArtifacts");
    expect(controller).toContain("renameSync");
  });

  it("maps both Generator surfaces to current M11 authority and runtime evidence", () => {
    const generatorEntries = popupParityManifest.filter((entry) =>
      entry.id === "generator.main" || entry.id === "generator.history",
    );
    expect(generatorEntries).toHaveLength(2);
    for (const entry of generatorEntries) {
      expect(entry.status).toBe("partial");
      expect(entry.tests).toContain("apps/menubar-tauri/e2e/official-generator-workflows.spec.ts");
      expect(entry.evidence).toEqual(expect.arrayContaining([
        { gate: "visual", path: m11GeneratorEvidencePath, surfaceIds: [entry.id] },
        { gate: "audit", path: m11GeneratorRuntimeResultPath, surfaceIds: [entry.id] },
      ]));
      expect(entry.evidence.map((evidence) => evidence.path)).not.toContain(
        "docs/superpowers/screenshots/g3-generator-account-settings-2026-07-13",
      );
    }

    expect(m11GeneratorAuthorities).toHaveLength(9);
    expectLocalEvidenceIsPrivate(m11GeneratorEvidencePath);
  });

  it("pins auth partial entries to local source mappings for the retained auth routes", () => {
    expect(officialSourceMappings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        localModule: "apps/menubar-tauri/src/app/app.component.ts",
        upstreamSources: expectedStartupUpstreamSources,
      }),
      expect.objectContaining({
        localModule: "apps/menubar-tauri/src/app/auth/login-page.component.ts",
        upstreamSources: expectedLoginPageUpstreamSources,
      }),
      expect.objectContaining({
        localModule: "apps/menubar-tauri/src/app/upstream-overlays/auth/anonymous/official-anonymous-shell.component.ts",
        upstreamSources: [
          "vendor/bitwarden-clients/apps/browser/src/popup/components/extension-anon-layout-wrapper/extension-anon-layout-wrapper.component.ts",
          "vendor/bitwarden-clients/apps/browser/src/popup/components/extension-anon-layout-wrapper/extension-anon-layout-wrapper.component.html",
        ],
      }),
      expect.objectContaining({
        localModule: "apps/menubar-tauri/src/app/upstream-overlays/auth/environment/official-environment-selector.component.ts",
        upstreamSources: [
          "vendor/bitwarden-clients/libs/angular/src/auth/environment-selector/environment-selector.component.ts",
          "vendor/bitwarden-clients/libs/angular/src/auth/environment-selector/environment-selector.component.html",
        ],
      }),
      expect.objectContaining({
        localModule: "apps/menubar-tauri/src/app/upstream-overlays/auth/environment/official-self-hosted-dialog.component.ts",
        upstreamSources: [
          "vendor/bitwarden-clients/libs/angular/src/auth/self-hosted-env-config-dialog/self-hosted-env-config-dialog.component.ts",
          "vendor/bitwarden-clients/libs/angular/src/auth/self-hosted-env-config-dialog/self-hosted-env-config-dialog.component.html",
        ],
      }),
      expect.objectContaining({
        localModule: "apps/menubar-tauri/src/app/auth/lock-page.component.ts",
        upstreamSources: expectedLockUpstreamSources,
      }),
      expect.objectContaining({
        localModule: "apps/menubar-tauri/src/app/auth/two-factor-page.component.ts",
        upstreamSources: expectedTwoFactorUpstreamSources,
      }),
      expect.objectContaining({
        localModule: "apps/menubar-tauri/src/app/auth/new-device-verification-page.component.ts",
        upstreamSources: expectedNewDeviceUpstreamSources,
      }),
      expect.objectContaining({
        localModule: "apps/menubar-tauri/src/app/auth/password-hint-page.component.ts",
        upstreamSources: expectedPasswordHintUpstreamSources,
      }),
      expect.objectContaining({
        localModule: "apps/menubar-tauri/src/app/popup-header-actions.component.ts",
        upstreamSources: expectedAccountSwitcherUpstreamSources.slice(4, 6),
      }),
      expect.objectContaining({
        localModule: "apps/menubar-tauri/src/app/auth/official-account-switcher.adapter.ts",
        upstreamSources: expectedAccountSwitcherUpstreamSources.slice(6),
      }),
      expect.objectContaining({
        localModule: "apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/official-account-switcher.component.ts",
        upstreamSources: [
          ...expectedAccountSwitcherUpstreamSources.slice(4, 6),
          ...expectedAccountSwitcherUpstreamSources.slice(0, 2),
        ],
      }),
      expect.objectContaining({
        localModule: "apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/official-account.component.ts",
        upstreamSources: expectedAccountSwitcherUpstreamSources.slice(2, 4),
      }),
      expect.objectContaining({
        localModule: "apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/official-account-switcher.transform-manifest.json",
        upstreamSources: expectedAccountSwitcherUpstreamSources,
      }),
    ]));
  });

  it.skipIf(!existsSync(join(process.cwd(), expectedAuditEvidencePath)))(
    "pins the local audit marker to the exact manifest summary",
    () => {
    const audit = readFileSync(join(process.cwd(), expectedAuditEvidencePath), "utf8");
    const summary = popupParitySummary();
    expect(audit).toContain(
      `<!-- parity-summary missing=${summary.missing} partial=${summary.partial} complete=${summary.complete} -->`,
    );
    expect(audit).toContain(`<!-- parity-status ${popupParityCompletionStatus()} -->`);
    },
  );
});

const syntheticSourceMappings: readonly PopupParitySourceMapping[] = [
  { localModule: "local/one.ts", upstreamSources: ["upstream/one.ts", "upstream/shared.ts"] },
  { localModule: "local/two.ts", upstreamSources: ["upstream/two.ts", "upstream/shared.ts"] },
];

const syntheticEvidencePaths = new Set(["proof/visual", "proof/native", "proof/audit"]);

function syntheticCompleteEntry(overrides: Partial<PopupParityEntry> = {}): PopupParityEntry {
  return {
    id: "synthetic.complete",
    officialRoutes: ["/synthetic"],
    classification: "required-native",
    status: "complete",
    localRoutes: ["/synthetic"],
    localModules: ["local/one.ts", "local/two.ts"],
    upstreamSources: ["upstream/one.ts", "upstream/shared.ts", "upstream/two.ts"],
    tests: ["synthetic.complete.spec.ts"],
    evidence: [
      { gate: "visual", path: "proof/visual", surfaceIds: ["synthetic.complete"] },
      { gate: "native", path: "proof/native", surfaceIds: ["synthetic.complete"] },
      { gate: "audit", path: "proof/audit", surfaceIds: ["synthetic.complete"] },
    ],
    remainingGaps: [],
    ...overrides,
  };
}

function validateSyntheticCompleteEntry(entry = syntheticCompleteEntry()): string[] {
  return validateCompletedPopupParityEntries(
    [entry],
    syntheticSourceMappings,
    (path) => syntheticEvidencePaths.has(path),
  );
}
