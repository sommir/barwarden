export type UpstreamReuseMode = "direct" | "adapter" | "template" | "overlay" | "native" | "excluded" | "guard";

export interface UpstreamSourceMapping {
  localModule: string;
  upstreamSources: readonly string[];
  mode: UpstreamReuseMode;
  excludedDependencies: readonly string[];
  staticDependencyDecision?: readonly string[];
}

export interface M12TextSendSourceRow {
  readonly id: "send.list" | "send.view" | "send.form" | "send.created" | "send.lifecycle";
  readonly productionOwner: string;
  readonly status: "partial";
  readonly remainingGates: readonly [string, string, string];
}

export type M13SettingsOwnership = "direct" | "overlay" | "native" | "web-vault-handoff";

export interface M13SettingsSourceRow {
  readonly id:
    | "settings.main"
    | "settings.account-security"
    | "settings.vault"
    | "settings.autofill-replacement"
    | "settings.appearance"
    | "settings.about"
    | "handoff.change-password";
  readonly ownership: M13SettingsOwnership;
  readonly status: "partial";
  readonly pinnedAuthorities: readonly string[];
  readonly localModules: readonly string[];
  readonly tests: readonly string[];
  readonly evidencePath: "docs/superpowers/specs/2026-07-20-m13-settings-runtime-result.md";
  readonly remainingGaps: readonly string[];
}

export interface GlobalShortcutSettingsSourceRow {
  readonly id: "settings.global-shortcut";
  readonly ownership: "native";
  readonly status: "partial";
  readonly route: "/keyboard-shortcut";
  readonly pinnedAuthorities: readonly string[];
  readonly localModules: readonly string[];
  readonly tests: readonly string[];
  readonly evidencePath: "docs/superpowers/reports/2026-07-24-global-shortcut-settings.md";
  readonly remainingGaps: readonly string[];
}

const m12RemainingGates = [
  "M14.4 credentialed Bitwarden US, EU, and compatible self-hosted Text Send mutation and cleanup proof remains open.",
  "M15 current-head native clipboard ownership and built-app lifecycle evidence remains open.",
  "M16 release-candidate comparison, accessibility, security, packaging, and audit closure remains open.",
] as const;

export const m12TextSendSourceRows: readonly M12TextSendSourceRow[] = [
  { id: "send.list", productionOwner: "official direct/guarded list, search, filters, rows, and states", status: "partial", remainingGates: m12RemainingGates },
  { id: "send.view", productionOwner: "official direct/guarded Text Send details", status: "partial", remainingGates: m12RemainingGates },
  { id: "send.form", productionOwner: "official Text details and guarded options under a thin route host", status: "partial", remainingGates: m12RemainingGates },
  { id: "send.created", productionOwner: "guarded official created component under a thin route host", status: "partial", remainingGates: m12RemainingGates },
  { id: "send.lifecycle", productionOwner: "local account-scoped mutation coordinator and API/crypto ports", status: "partial", remainingGates: m12RemainingGates },
];

const m13SettingsEvidencePath =
  "docs/superpowers/specs/2026-07-20-m13-settings-runtime-result.md" as const;
const m13SettingsRuntimeTest =
  "apps/menubar-tauri/e2e/official-settings-workflows.spec.ts" as const;
const alternativeUnlockRuntimeTest =
  "apps/menubar-tauri/e2e/pin-biometric-unlock.spec.ts" as const;
const m13SettingsRemainingGaps = [
  "M15 built-app native proof remains open.",
  "M16 release-candidate comparison remains open.",
] as const;
const alternativeUnlockRemainingGaps = [
  ...m13SettingsRemainingGaps,
  "Physical signed-build Touch ID acceptance remains pending.",
  "Stable signing, notarization, stapling, and Gatekeeper acceptance remain release blockers.",
] as const;
const globalShortcutSettingsRemainingGaps = [
  "Built-app native shortcut registration and trigger proof remains open.",
  "Release-candidate accessibility, packaging, and audit closure remains open.",
] as const;

export const globalShortcutSettingsSourceRow: GlobalShortcutSettingsSourceRow = {
  id: "settings.global-shortcut",
  ownership: "native",
  status: "partial",
  route: "/keyboard-shortcut",
  pinnedAuthorities: [
    "vendor/bitwarden-clients/apps/browser/src/tools/popup/settings/settings-v2.component.ts",
    "vendor/bitwarden-clients/apps/browser/src/tools/popup/settings/settings-v2.component.html",
  ],
  localModules: [
    "apps/menubar-tauri/src/app/settings/global-shortcut-settings.service.ts",
    "apps/menubar-tauri/src/app/settings/keyboard-shortcut-page.component.ts",
  ],
  tests: [
    "apps/menubar-tauri/src/app/settings/global-shortcut-settings.service.spec.ts",
    "apps/menubar-tauri/src/app/settings/keyboard-shortcut-page.component.spec.ts",
  ],
  evidencePath: "docs/superpowers/reports/2026-07-24-global-shortcut-settings.md",
  remainingGaps: globalShortcutSettingsRemainingGaps,
};

export const m13SettingsSourceRows: readonly M13SettingsSourceRow[] = [
  {
    id: "settings.main",
    ownership: "overlay",
    status: "partial",
    pinnedAuthorities: [
      "vendor/bitwarden-clients/apps/browser/src/tools/popup/settings/settings-v2.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/tools/popup/settings/settings-v2.component.html",
    ],
    localModules: [
      "apps/menubar-tauri/src/app/settings/settings-page.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.component.ts",
    ],
    tests: [
      "apps/menubar-tauri/src/app/settings/settings-page.component.spec.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.component.spec.ts",
      "apps/menubar-tauri/src/app/settings/settings-production-boundary.spec.ts",
      "apps/menubar-tauri/e2e/generator-account-settings.spec.ts",
      m13SettingsRuntimeTest,
    ],
    evidencePath: m13SettingsEvidencePath,
    remainingGaps: m13SettingsRemainingGaps,
  },
  {
    id: "settings.account-security",
    ownership: "overlay",
    status: "partial",
    pinnedAuthorities: [
      "vendor/bitwarden-clients/apps/browser/src/auth/popup/settings/account-security.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/auth/popup/settings/account-security.component.html",
    ],
    localModules: [
      "apps/menubar-tauri/src/app/settings/account-security-page.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/settings/official-account-security.component.ts",
      "apps/menubar-tauri/src/app/settings/environment-handoff.service.ts",
      "apps/menubar-tauri/src/app/settings/pin-setup-dialog.component.ts",
      "apps/menubar-tauri/src/app/auth/unlock-methods.service.ts",
    ],
    tests: [
      "apps/menubar-tauri/src/app/settings/p1-pages.spec.ts",
      "apps/menubar-tauri/src/app/settings/environment-handoff.service.spec.ts",
      "apps/menubar-tauri/src/app/settings/settings-production-boundary.spec.ts",
      "apps/menubar-tauri/e2e/generator-account-settings.spec.ts",
      "apps/menubar-tauri/src/app/settings/pin-setup-dialog.component.spec.ts",
      "apps/menubar-tauri/src/app/settings/account-security-unlock-options.spec.ts",
      alternativeUnlockRuntimeTest,
      m13SettingsRuntimeTest,
    ],
    evidencePath: m13SettingsEvidencePath,
    remainingGaps: alternativeUnlockRemainingGaps,
  },
  {
    id: "settings.vault",
    ownership: "overlay",
    status: "partial",
    pinnedAuthorities: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/vault-settings.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/vault-settings.component.html",
    ],
    localModules: [
      "apps/menubar-tauri/src/app/settings/vault-settings-page.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/settings/official-vault-settings.component.ts",
    ],
    tests: [
      "apps/menubar-tauri/src/app/settings/vault-settings-page.component.spec.ts",
      "apps/menubar-tauri/src/app/settings/settings-production-boundary.spec.ts",
      "apps/menubar-tauri/e2e/generator-account-settings.spec.ts",
      m13SettingsRuntimeTest,
    ],
    evidencePath: m13SettingsEvidencePath,
    remainingGaps: m13SettingsRemainingGaps,
  },
  {
    id: "settings.autofill-replacement",
    ownership: "native",
    status: "partial",
    pinnedAuthorities: [
      "vendor/bitwarden-clients/apps/browser/src/tools/popup/settings/settings-v2.component.html",
    ],
    localModules: [
      "apps/menubar-tauri/src/app/settings/autofill-settings-page.component.ts",
      "apps/menubar-tauri/src/app/settings/settings.service.ts",
      "apps/menubar-tauri/src/app/settings/settings-options.ts",
    ],
    tests: [
      "apps/menubar-tauri/src/app/settings/p1-pages.spec.ts",
      "apps/menubar-tauri/src/app/settings/settings.service.spec.ts",
      "apps/menubar-tauri/src/app/settings/settings-production-boundary.spec.ts",
      m13SettingsRuntimeTest,
    ],
    evidencePath: m13SettingsEvidencePath,
    remainingGaps: m13SettingsRemainingGaps,
  },
  {
    id: "settings.appearance",
    ownership: "overlay",
    status: "partial",
    pinnedAuthorities: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/appearance.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/appearance.component.html",
    ],
    localModules: [
      "apps/menubar-tauri/src/app/settings/appearance-page.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/settings/official-appearance.component.ts",
    ],
    tests: [
      "apps/menubar-tauri/src/app/settings/p1-pages.spec.ts",
      "apps/menubar-tauri/src/app/settings/settings-production-boundary.spec.ts",
      "apps/menubar-tauri/e2e/generator-account-settings.spec.ts",
      m13SettingsRuntimeTest,
    ],
    evidencePath: m13SettingsEvidencePath,
    remainingGaps: m13SettingsRemainingGaps,
  },
  {
    id: "settings.about",
    ownership: "overlay",
    status: "partial",
    pinnedAuthorities: [
      "vendor/bitwarden-clients/apps/browser/src/tools/popup/settings/about-page/about-page-v2.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/tools/popup/settings/about-page/about-page-v2.component.html",
      "vendor/bitwarden-clients/apps/browser/src/tools/popup/settings/about-dialog/about-dialog.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/tools/popup/settings/about-dialog/about-dialog.component.html",
    ],
    localModules: [
      "apps/menubar-tauri/src/app/settings/about-page.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/settings/official-about.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/settings/official-about-dialog.component.ts",
    ],
    tests: [
      "apps/menubar-tauri/src/app/settings/p1-pages.spec.ts",
      "apps/menubar-tauri/src/app/settings/environment-handoff.service.spec.ts",
      "apps/menubar-tauri/src/app/settings/settings-production-boundary.spec.ts",
      m13SettingsRuntimeTest,
    ],
    evidencePath: m13SettingsEvidencePath,
    remainingGaps: m13SettingsRemainingGaps,
  },
  {
    id: "handoff.change-password",
    ownership: "web-vault-handoff",
    status: "partial",
    pinnedAuthorities: [
      "vendor/bitwarden-clients/apps/browser/src/auth/popup/settings/account-security.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/auth/popup/settings/account-security.component.html",
    ],
    localModules: [
      "apps/menubar-tauri/src/app/settings/settings-password-page.component.ts",
      "apps/menubar-tauri/src/app/settings/environment-handoff.service.ts",
    ],
    tests: [
      "apps/menubar-tauri/src/app/settings/environment-handoff.service.spec.ts",
      "apps/menubar-tauri/src/app/settings/settings-production-boundary.spec.ts",
      "apps/menubar-tauri/src/app/app.routes.spec.ts",
      m13SettingsRuntimeTest,
    ],
    evidencePath: m13SettingsEvidencePath,
    remainingGaps: m13SettingsRemainingGaps,
  },
];

export const officialAuthAuthoritySources = [
  "vendor/bitwarden-clients/apps/browser/src/popup/components/extension-anon-layout-wrapper/extension-anon-layout-wrapper.component.ts",
  "vendor/bitwarden-clients/apps/browser/src/popup/components/extension-anon-layout-wrapper/extension-anon-layout-wrapper.component.html",
  "vendor/bitwarden-clients/libs/angular/src/auth/environment-selector/environment-selector.component.ts",
  "vendor/bitwarden-clients/libs/angular/src/auth/environment-selector/environment-selector.component.html",
  "vendor/bitwarden-clients/libs/angular/src/auth/self-hosted-env-config-dialog/self-hosted-env-config-dialog.component.ts",
  "vendor/bitwarden-clients/libs/angular/src/auth/self-hosted-env-config-dialog/self-hosted-env-config-dialog.component.html",
  "vendor/bitwarden-clients/libs/auth/src/angular/login/login.component.ts",
  "vendor/bitwarden-clients/libs/auth/src/angular/login/login.component.html",
  "vendor/bitwarden-clients/libs/auth/src/angular/login/login-component.service.ts",
  "vendor/bitwarden-clients/libs/auth/src/angular/password-hint/password-hint.component.ts",
  "vendor/bitwarden-clients/libs/auth/src/angular/password-hint/password-hint.component.html",
  "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/two-factor-auth.component.ts",
  "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/two-factor-auth.component.html",
  "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/two-factor-options.component.ts",
  "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/two-factor-options.component.html",
  "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/child-components/two-factor-auth-email/two-factor-auth-email.component.ts",
  "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/child-components/two-factor-auth-email/two-factor-auth-email.component.html",
  "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/child-components/two-factor-auth-authenticator/two-factor-auth-authenticator.component.ts",
  "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/child-components/two-factor-auth-authenticator/two-factor-auth-authenticator.component.html",
  "vendor/bitwarden-clients/libs/auth/src/angular/new-device-verification/new-device-verification.component.ts",
  "vendor/bitwarden-clients/libs/auth/src/angular/new-device-verification/new-device-verification.component.html",
  "vendor/bitwarden-clients/libs/key-management-ui/src/lock/components/lock.component.ts",
  "vendor/bitwarden-clients/libs/key-management-ui/src/lock/components/lock.component.html",
  "vendor/bitwarden-clients/libs/key-management-ui/src/lock/components/master-password-lock/master-password-lock.component.ts",
  "vendor/bitwarden-clients/libs/key-management-ui/src/lock/components/master-password-lock/master-password-lock.component.html",
  "vendor/bitwarden-clients/libs/key-management-ui/src/lock/components/unlock-via-prf.component.ts",
  "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/current-account.component.ts",
  "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/current-account.component.html",
  "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/account-switcher.component.ts",
  "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/account-switcher.component.html",
  "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/account.component.ts",
  "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/account.component.html",
  "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/services/account-switcher.service.ts",
] as const;

export const officialSourceMappings = [
  {
    localModule: "apps/menubar-tauri/src/auth/installation-id.service.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/common/src/platform/services/app-id.service.ts",
    ],
    mode: "adapter",
    excludedDependencies: [
      "StateProvider and global application-id state definitions",
      "official logging and migration services",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/auth/auth-official-source.guard.spec.ts",
    upstreamSources: officialAuthAuthoritySources,
    mode: "guard",
    excludedDependencies: [],
    staticDependencyDecision: [
      "only CurrentAccountComponent is a direct production import; all other authentication authorities remain source-only until guarded overlays transform them",
      "raw login authorities retain SSO, passkey, and device-login transitive branches that guarded overlays must delete before production use",
      "raw lock authorities retain unlock-via-prf and PRF transitive branches that guarded overlays must delete before production use",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/auth/login-page.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/auth/src/angular/login/login.component.ts",
      "vendor/bitwarden-clients/libs/auth/src/angular/login/login.component.html",
      "vendor/bitwarden-clients/libs/auth/src/angular/login/login-component.service.ts",
    ],
    mode: "adapter",
    excludedDependencies: [
      "official Login runtime lives in the guarded overlay and delegates only to the retained password-auth adapter",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/app.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/popup/app-routing.module.ts",
      "vendor/bitwarden-clients/libs/angular/src/auth/guards/redirect/redirect.guard.ts",
      "vendor/bitwarden-clients/apps/browser/src/platform/popup/components/popup-focus-wrap.directive.ts",
    ],
    mode: "direct",
    excludedDependencies: [
      "SSO, passkey and hardware-key, device-login, approval, and FIDO2 popup routes",
      "domain-confirmation and browser popup pop-out routing",
      "redirect guard Device Trust Enrollment (TDE) branch is outside Plan A",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/auth/lock-page.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/key-management-ui/src/lock/components/lock.component.ts",
      "vendor/bitwarden-clients/libs/key-management-ui/src/lock/components/lock.component.html",
      "vendor/bitwarden-clients/libs/key-management-ui/src/lock/components/master-password-lock/master-password-lock.component.ts",
      "vendor/bitwarden-clients/libs/key-management-ui/src/lock/components/master-password-lock/master-password-lock.component.html",
    ],
    mode: "adapter",
    excludedDependencies: [
      "official runtime lives in the guarded lock overlays and delegates master-password, runtime PIN, and Touch ID operations to bounded local adapters",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/auth/official-master-password-unlock.adapter.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/key-management-ui/src/lock/components/master-password-lock/master-password-lock.component.ts",
    ],
    mode: "adapter",
    excludedDependencies: [
      "official UnlockService, KeyService, account service, toast, logging, and native message services replaced by AuthFacade and AccountSessionStore state",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/auth/lock/official-lock.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/key-management-ui/src/lock/components/lock.component.ts",
      "vendor/bitwarden-clients/libs/key-management-ui/src/lock/components/lock.component.html",
    ],
    mode: "adapter",
    excludedDependencies: [
      "PRF, device trust, shared unlock, desktop broadcaster, browser native messaging, and browser pop-out branches",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/auth/lock/official-master-password-lock.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/key-management-ui/src/lock/components/master-password-lock/master-password-lock.component.ts",
      "vendor/bitwarden-clients/libs/key-management-ui/src/lock/components/master-password-lock/master-password-lock.component.html",
    ],
    mode: "adapter",
    excludedDependencies: [
      "PRF, device trust, shared unlock, desktop broadcaster, browser native messaging, and browser pop-out branches",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/auth/lock/official-pin-lock.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/key-management-ui/src/lock/components/lock.component.ts",
      "vendor/bitwarden-clients/libs/key-management-ui/src/lock/components/lock.component.html",
    ],
    mode: "adapter",
    excludedDependencies: [
      "PRF, device trust, shared unlock, desktop broadcaster, browser native messaging, and browser pop-out branches",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/auth/lock/official-master-password-lock.transform-manifest.json",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/key-management-ui/src/lock/components/lock.component.ts",
      "vendor/bitwarden-clients/libs/key-management-ui/src/lock/components/lock.component.html",
      "vendor/bitwarden-clients/libs/key-management-ui/src/lock/components/master-password-lock/master-password-lock.component.ts",
      "vendor/bitwarden-clients/libs/key-management-ui/src/lock/components/master-password-lock/master-password-lock.component.html",
    ],
    mode: "guard",
    excludedDependencies: [
      "digest-pinned manifest records retained, adapted, and excluded official lock dependencies",
    ],
    staticDependencyDecision: [
      "official lock aliases resolve only the pinned source authorities and remain dormant in production",
      "production statically imports LockPageComponent -> OfficialLockComponent -> OfficialPinLockComponent or OfficialMasterPasswordLockComponent with local AuthFacade and UnlockMethodsPort adapters",
      "browser native messaging, PRF/hardware-key, shared unlock, device trust, broadcaster, and browser pop-out modules are deleted rather than resolved into production",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/auth/two-factor-page.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/auth/services/extension-two-factor-auth-component.service.ts",
      "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/two-factor-auth.component.ts",
      "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/two-factor-auth.component.html",
      "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/two-factor-options.component.ts",
      "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/two-factor-options.component.html",
    ],
    mode: "adapter",
    excludedDependencies: [
      "official two-factor runtime lives in guarded parent/options/child overlays",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/auth/official-challenge.adapter.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/two-factor-auth.component.ts",
      "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/child-components/two-factor-auth-email/two-factor-auth-email.component.ts",
    ],
    mode: "adapter",
    excludedDependencies: [
      "official login strategy, TwoFactorService, browser cache, and route services replaced by the bounded AuthFacade challenge pipeline",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/auth/two-factor/official-two-factor.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/two-factor-auth.component.ts",
      "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/two-factor-auth.component.html",
    ],
    mode: "adapter",
    excludedDependencies: [
      "excluded third-party and hardware providers, recovery-code and enterprise branches, browser pop-out/resize, and extension messaging",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/auth/two-factor/official-two-factor-options.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/two-factor-options.component.ts",
      "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/two-factor-options.component.html",
    ],
    mode: "adapter",
    excludedDependencies: [
      "excluded third-party and hardware provider options; official DialogRef lifecycle replaced by the retained native dialog adapter",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/auth/two-factor/official-two-factor-email.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/child-components/two-factor-auth-email/two-factor-auth-email.component.ts",
      "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/child-components/two-factor-auth-email/two-factor-auth-email.component.html",
    ],
    mode: "adapter",
    excludedDependencies: [
      "official LoginStrategyService, TwoFactorService, AppIdService, cache, toast, and logging dependencies replaced by OfficialChallengeAdapter",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/auth/two-factor/official-two-factor-authenticator.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/child-components/two-factor-auth-authenticator/two-factor-auth-authenticator.component.ts",
      "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/child-components/two-factor-auth-authenticator/two-factor-auth-authenticator.component.html",
    ],
    mode: "adapter",
    excludedDependencies: [
      "deprecated aggregate JslibModule replaced by the pinned I18nPipe and exact official form primitives",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/auth/two-factor/official-two-factor.transform-manifest.json",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/two-factor-auth.component.ts",
      "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/two-factor-options.component.ts",
      "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/child-components/two-factor-auth-email/two-factor-auth-email.component.ts",
      "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/child-components/two-factor-auth-authenticator/two-factor-auth-authenticator.component.ts",
    ],
    mode: "guard",
    excludedDependencies: [
      "digest-pinned manifest partitions every upstream and local class member, import module, and import binding exactly",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/auth/new-device-verification-page.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/auth/services/new-device-verification/extension-new-device-verification-component.service.ts",
      "vendor/bitwarden-clients/libs/auth/src/angular/new-device-verification/new-device-verification.component.ts",
      "vendor/bitwarden-clients/libs/auth/src/angular/new-device-verification/new-device-verification.component.html",
    ],
    mode: "adapter",
    excludedDependencies: [
      "official new-device runtime lives in the guarded overlay and delegates only to the bounded challenge adapter",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/auth/official-new-device.adapter.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/auth/src/angular/new-device-verification/new-device-verification.component.ts",
    ],
    mode: "adapter",
    excludedDependencies: [
      "official LoginStrategyService, ApiService, session services, and logging replaced by the retained AuthFacade and PasswordLoginService pipeline",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/auth/new-device/official-new-device-verification.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/auth/src/angular/new-device-verification/new-device-verification.component.ts",
      "vendor/bitwarden-clients/libs/auth/src/angular/new-device-verification/new-device-verification.component.html",
    ],
    mode: "adapter",
    excludedDependencies: [
      "official environment, account, session, master-password, logging, browser timeout, and post-login routing services",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/auth/new-device/official-new-device-verification.transform-manifest.json",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/auth/src/angular/new-device-verification/new-device-verification.component.ts",
      "vendor/bitwarden-clients/libs/auth/src/angular/new-device-verification/new-device-verification.component.html",
    ],
    mode: "guard",
    excludedDependencies: [
      "digest-pinned manifest partitions the official component runtime and template from retained adapter substitutions",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/auth/password-hint-page.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/auth/src/angular/password-hint/password-hint.component.ts",
      "vendor/bitwarden-clients/libs/auth/src/angular/password-hint/password-hint.component.html",
    ],
    mode: "adapter",
    excludedDependencies: ["official Password Hint runtime lives in the guarded overlay"],
  },
  {
    localModule: "apps/menubar-tauri/src/app/auth/official-password-auth.adapter.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/auth/src/angular/login/login.component.ts",
      "vendor/bitwarden-clients/libs/auth/src/angular/login/login-component.service.ts",
    ],
    mode: "adapter",
    excludedDependencies: [
      "official login strategies and browser/desktop component services replaced by the retained AuthFacade password pipeline",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/auth/official-password-hint-api.adapter.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/auth/src/angular/password-hint/password-hint.component.ts",
    ],
    mode: "adapter",
    excludedDependencies: [
      "official ApiService, ToastService, client-type branching, and browser/desktop platform services replaced by the retained API adapter",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/auth/login/official-password-login.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/auth/src/angular/login/login.component.ts",
      "vendor/bitwarden-clients/libs/auth/src/angular/login/login.component.html",
      "vendor/bitwarden-clients/libs/auth/src/angular/login/login-component.service.ts",
    ],
    mode: "adapter",
    excludedDependencies: [
      "passkey, SSO, device login, known-device probing, signup secondary content, browser/desktop broadcasters, and organization-policy redirects",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/auth/login/official-password-hint.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/auth/src/angular/password-hint/password-hint.component.ts",
      "vendor/bitwarden-clients/libs/auth/src/angular/password-hint/password-hint.component.html",
    ],
    mode: "adapter",
    excludedDependencies: [
      "official ApiService, ToastService, client-type branching, and browser/desktop platform services",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/auth/login/official-password-auth.transform-manifest.json",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/auth/src/angular/login/login.component.ts",
      "vendor/bitwarden-clients/libs/auth/src/angular/password-hint/password-hint.component.ts",
    ],
    mode: "guard",
    excludedDependencies: [
      "digest-pinned manifest partitions every pinned Login and Password Hint class member and import into retained, adapted, or explicitly allowed removal; overlay runtimes remain adapters rather than direct upstream imports",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/popup-header-actions.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/current-account.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/current-account.component.html",
    ],
    mode: "direct",
    excludedDependencies: [],
    staticDependencyDecision: [
      "CurrentAccountComponent retains its exact CommonModule, RouterModule, JslibModule, AvatarModule, account, avatar, auth, route, router, and Location graph",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/auth/official-account-switcher.adapter.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/services/account-switcher.service.ts",
    ],
    mode: "adapter",
    excludedDependencies: [
      "chrome runtime events, BrowserApi, fromChromeEvent, Safari flags, feature flags, extension messages, and browser-account timeouts",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/official-account-switcher.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/current-account.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/current-account.component.html",
      "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/account-switcher.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/account-switcher.component.html",
    ],
    mode: "adapter",
    excludedDependencies: [
      "official lock, logout, account, auth, and vault-timeout services replaced by OfficialAccountSwitcherAdapter and retained AuthFacade lifecycle state",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/official-account.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/account.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/account.component.html",
    ],
    mode: "adapter",
    excludedDependencies: [
      "biometrics autoprompt, local logging, and browser-account selection services",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/official-account-switcher.transform-manifest.json",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/account-switcher.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/account-switcher.component.html",
      "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/account.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/account.component.html",
      "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/current-account.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/current-account.component.html",
      "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/services/account-switcher.service.ts",
    ],
    mode: "guard",
    excludedDependencies: [
      "digest-pinned manifest records direct, retained, adapted, and deleted account-hierarchy bindings and templates",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/auth/official-environment.adapter.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/angular/src/auth/environment-selector/environment-selector.component.ts",
      "vendor/bitwarden-clients/libs/angular/src/auth/self-hosted-env-config-dialog/self-hosted-env-config-dialog.component.ts",
    ],
    mode: "adapter",
    excludedDependencies: [
      "official environment service replaced by PopupStateStore and existing Bitwarden environment builders",
      "official dialog service and toast service",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/auth/anonymous/official-anonymous-shell.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/popup/components/extension-anon-layout-wrapper/extension-anon-layout-wrapper.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/popup/components/extension-anon-layout-wrapper/extension-anon-layout-wrapper.component.html",
    ],
    mode: "adapter",
    excludedDependencies: [
      "browser route-data, router outlets, navigation listener, and account switcher removed; projected local login content replaces outlets",
      "official AnonLayout retained with only local PopupPage, PopupHeader, PopOut, i18n, environment, and platform adapters",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/auth/environment/official-environment-selector.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/angular/src/auth/environment-selector/environment-selector.component.ts",
      "vendor/bitwarden-clients/libs/angular/src/auth/environment-selector/environment-selector.component.html",
    ],
    mode: "adapter",
    excludedDependencies: [
      "official menu template retained; only US/EU regions survive and self-hosted opens the local native-dialog adapter",
      "official environment, dialog, and toast services replaced by OfficialEnvironmentAdapter and projected local dialog result",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/auth/environment/official-self-hosted-dialog.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/angular/src/auth/self-hosted-env-config-dialog/self-hosted-env-config-dialog.component.ts",
      "vendor/bitwarden-clients/libs/angular/src/auth/self-hosted-env-config-dialog/self-hosted-env-config-dialog.component.html",
    ],
    mode: "adapter",
    excludedDependencies: [
      "custom-environment expansion and every endpoint-specific field deleted; exactly baseUrl remains",
      "official DialogService/DialogRef, development HTTP exception, and browser autofocus directives replaced by NativeDialogLifecycleAdapter",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/auth/environment/native-dialog-lifecycle.adapter.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/angular/src/auth/self-hosted-env-config-dialog/self-hosted-env-config-dialog.component.ts",
      "vendor/bitwarden-clients/libs/angular/src/auth/self-hosted-env-config-dialog/self-hosted-env-config-dialog.component.html",
    ],
    mode: "adapter",
    excludedDependencies: [
      "CDK DialogService/DialogRef lifecycle replaced by native dialog showModal/close, focus trap boundary, Escape, autofocus, and focus restoration",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/auth/auth.facade.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/account-switcher.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/popup/app-routing.module.ts",
    ],
    mode: "adapter",
    excludedDependencies: [
      "Angular router guards and navigation redirects",
      "Bitwarden AccountSwitcherService, AuthService, LockService, and LogoutService",
      "browser popup route components",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/popup-shell/popup-shell.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/platform/popup/layout/popup-tab-navigation.component.html",
      "vendor/bitwarden-clients/apps/browser/src/platform/popup/layout/popup-tab-navigation.component.ts",
    ],
    mode: "adapter",
    excludedDependencies: [
      "BrowserRouterService",
      "PopupRouterCacheService",
      "PopupTabNavigationComponent icon navigation and full-width footer surface replaced by the Barwarden floating text switcher",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/layout/popup-footer.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/platform/popup/layout/popup-footer.component.html",
      "vendor/bitwarden-clients/apps/browser/src/platform/popup/layout/popup-footer.component.ts",
    ],
    mode: "direct",
    excludedDependencies: [],
  },
  {
    localModule: "apps/menubar-tauri/src/app/layout/popup-page.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/platform/popup/layout/popup-page.component.html",
      "vendor/bitwarden-clients/apps/browser/src/platform/popup/layout/popup-page.component.ts",
    ],
    mode: "direct",
    excludedDependencies: [],
  },
  {
    localModule:
      "apps/menubar-tauri/src/app/upstream-overlays/popup-header/jslib.module.adapter.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/angular/src/jslib.module.ts",
      "vendor/bitwarden-clients/libs/angular/src/directives/input-verbatim.directive.ts",
      "vendor/bitwarden-clients/libs/angular/src/directives/stop-click.directive.ts",
      "vendor/bitwarden-clients/libs/common/src/platform/abstractions/i18n.service.ts",
      "vendor/bitwarden-clients/libs/components/src/input/autofocus.directive.ts",
      "vendor/bitwarden-clients/libs/ui/common/src/i18n.pipe.ts",
    ],
    mode: "adapter",
    excludedDependencies: [
      "deprecated full JslibModule reduced to pinned I18nPipe, AutofocusDirective, InputVerbatimDirective, StopClickDirective, and retained OfficialI18nService",
    ],
  },
  {
    localModule:
      "apps/menubar-tauri/src/app/upstream-overlays/popup-header/popup-header.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/platform/popup/layout/popup-header.component.html",
      "vendor/bitwarden-clients/apps/browser/src/platform/popup/layout/popup-header.component.ts",
    ],
    mode: "adapter",
    excludedDependencies: [
      "browser PopupRouterCacheService replaced by popup-router-cache.adapter.ts",
      "deprecated full JslibModule replaced by an I18nPipe and retained OfficialI18nService adapter",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/pop-out/pop-out.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/platform/popup/components/pop-out.component.html",
      "vendor/bitwarden-clients/apps/browser/src/platform/popup/components/pop-out.component.ts",
    ],
    mode: "adapter",
    excludedDependencies: [
      "BrowserPopupUtils replaced only by browser-popup-utils.adapter.ts",
      "browser tabs, current-tab URL state, background messaging, and browser window APIs",
    ],
  },
  {
    localModule:
      "apps/menubar-tauri/src/app/upstream-overlays/pop-out/browser-popup-utils.adapter.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/platform/browser/browser-popup-utils.ts",
    ],
    mode: "adapter",
    excludedDependencies: [
      "browser current-tab URL state and browser window APIs replaced by the retained local hash-route matcher and Tauri pop_out command",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/official-ui/official-ui-common.ts",
    upstreamSources: ["vendor/bitwarden-clients/libs/ui/common/src/i18n.pipe.ts"],
    mode: "direct",
    excludedDependencies: [],
  },
  {
    localModule: "apps/menubar-tauri/src/app/official-ui/official-i18n.service.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/common/src/platform/abstractions/i18n.service.ts",
      "vendor/bitwarden-clients/libs/ui/common/src/i18n.pipe.ts",
    ],
    mode: "adapter",
    excludedDependencies: [
      "full Bitwarden localization catalog and locale persistence replaced by deterministic retained translations",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/styles/official-theme.css",
    upstreamSources: ["vendor/bitwarden-clients/libs/components/src/tw-theme.css"],
    mode: "direct",
    excludedDependencies: [],
  },
  {
    localModule:
      "apps/menubar-tauri/official-components-overlay/async-actions/bit-action.directive.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/components/src/async-actions/bit-action.directive.ts",
    ],
    mode: "adapter",
    excludedDependencies: [
      "DestroyRef lifecycle guard prevents a destroyed button loading signal write during async teardown",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/generator/official-credential-generator.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/tools/popup/generator/credential-generator.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/tools/popup/generator/credential-generator.component.html",
      "vendor/bitwarden-clients/libs/tools/generator/components/src/credential-generator.component.ts",
      "vendor/bitwarden-clients/libs/tools/generator/components/src/credential-generator.component.html",
    ],
    mode: "overlay",
    excludedDependencies: [
      "browser account, pop-out, copy directive, website/current-tab context, spotlight, policy, forwarder, and messaging providers",
      "upstream reactive providers replaced by GeneratorService, ClipboardPolicyService, and retained popup header actions",
    ],
  },
  {
    localModule: "vendor/bitwarden-clients/libs/tools/generator/components/src/password-settings.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/tools/generator/components/src/password-settings.component.ts",
      "vendor/bitwarden-clients/libs/tools/generator/components/src/password-settings.component.html",
    ],
    mode: "direct",
    excludedDependencies: [],
  },
  {
    localModule: "vendor/bitwarden-clients/libs/tools/generator/components/src/passphrase-settings.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/tools/generator/components/src/passphrase-settings.component.ts",
      "vendor/bitwarden-clients/libs/tools/generator/components/src/passphrase-settings.component.html",
    ],
    mode: "direct",
    excludedDependencies: [],
  },
  {
    localModule: "vendor/bitwarden-clients/libs/tools/generator/components/src/username-settings.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/tools/generator/components/src/username-settings.component.ts",
      "vendor/bitwarden-clients/libs/tools/generator/components/src/username-settings.component.html",
    ],
    mode: "direct",
    excludedDependencies: [],
  },
  {
    localModule: "vendor/bitwarden-clients/libs/tools/generator/components/src/subaddress-settings.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/tools/generator/components/src/subaddress-settings.component.ts",
      "vendor/bitwarden-clients/libs/tools/generator/components/src/subaddress-settings.component.html",
    ],
    mode: "direct",
    excludedDependencies: [],
  },
  {
    localModule: "vendor/bitwarden-clients/libs/tools/generator/components/src/catchall-settings.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/tools/generator/components/src/catchall-settings.component.ts",
      "vendor/bitwarden-clients/libs/tools/generator/components/src/catchall-settings.component.html",
      "vendor/bitwarden-clients/apps/browser/src/tools/popup/generator/credential-generator-history.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/tools/popup/generator/credential-generator-history.component.html",
      "vendor/bitwarden-clients/libs/tools/generator/components/src/credential-generator-history.component.ts",
      "vendor/bitwarden-clients/libs/tools/generator/components/src/credential-generator-history.component.html",
      "vendor/bitwarden-clients/libs/tools/generator/components/src/empty-credential-history.component.ts",
      "vendor/bitwarden-clients/libs/tools/generator/components/src/empty-credential-history.component.html",
    ],
    mode: "direct",
    excludedDependencies: [],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator.transform-manifest.json",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/tools/popup/generator/credential-generator.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/tools/popup/generator/credential-generator.component.html",
      "vendor/bitwarden-clients/libs/tools/generator/components/src/credential-generator.component.ts",
      "vendor/bitwarden-clients/libs/tools/generator/components/src/credential-generator.component.html",
      "vendor/bitwarden-clients/libs/tools/generator/components/src/password-settings.component.ts",
      "vendor/bitwarden-clients/libs/tools/generator/components/src/password-settings.component.html",
      "vendor/bitwarden-clients/libs/tools/generator/components/src/passphrase-settings.component.ts",
      "vendor/bitwarden-clients/libs/tools/generator/components/src/passphrase-settings.component.html",
      "vendor/bitwarden-clients/libs/tools/generator/components/src/username-settings.component.ts",
      "vendor/bitwarden-clients/libs/tools/generator/components/src/username-settings.component.html",
      "vendor/bitwarden-clients/libs/tools/generator/components/src/subaddress-settings.component.ts",
      "vendor/bitwarden-clients/libs/tools/generator/components/src/subaddress-settings.component.html",
      "vendor/bitwarden-clients/libs/tools/generator/components/src/catchall-settings.component.ts",
      "vendor/bitwarden-clients/libs/tools/generator/components/src/catchall-settings.component.html",
    ],
    mode: "guard",
    excludedDependencies: [
      "digest-pinned manifest records exact aliases, source members, substitutions, removed integrations, and local runtime hashes",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/generator/generator-history-page.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/tools/popup/generator/credential-generator-history.component.html",
      "vendor/bitwarden-clients/apps/browser/src/tools/popup/generator/credential-generator-history.component.ts",
      "vendor/bitwarden-clients/libs/tools/generator/components/src/credential-generator-history.component.html",
      "vendor/bitwarden-clients/libs/tools/generator/components/src/credential-generator-history.component.ts",
      "vendor/bitwarden-clients/libs/tools/generator/components/src/empty-credential-history.component.html",
      "vendor/bitwarden-clients/libs/tools/generator/components/src/empty-credential-history.component.ts",
    ],
    mode: "overlay",
    excludedDependencies: [
      "browser DialogService replaced by an accessible native dialog transform",
      "browser appCopyClick replaced by native clipboard policy",
      "browser pop-out implementation replaced by the existing Tauri pop-out adapter",
      "semantic logger/debug and official StateProvider/SecretState storage excluded",
    ],
  },
  {
    localModule:
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/components/vault/vault-header/vault-header.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/vault-header/vault-header.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/vault-header/vault-header.component.html",
    ],
    mode: "direct",
    excludedDependencies: [],
  },
  {
    localModule:
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/components/vault/vault-search/vault-search.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/vault-search/vault-search.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/vault-search/vault-search.component.html",
    ],
    mode: "direct",
    excludedDependencies: [],
  },
  {
    localModule:
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/components/vault/vault-list-filters/vault-list-filters.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/vault-list-filters/vault-list-filters.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/vault-list-filters/vault-list-filters.component.html",
    ],
    mode: "direct",
    excludedDependencies: [],
  },
  {
    localModule:
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/platform/browser/run-inside-angular.operator.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/platform/browser/run-inside-angular.operator.ts",
    ],
    mode: "direct",
    excludedDependencies: [],
  },
  {
    localModule:
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/components/vault/new-item-dropdown/new-item-dropdown.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/new-item-dropdown/new-item-dropdown.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/new-item-dropdown/new-item-dropdown.component.html",
    ],
    mode: "direct",
    excludedDependencies: [],
  },
  {
    localModule:
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/platform/browser/browser-api.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/platform/browser/browser-api.ts",
    ],
    mode: "adapter",
    excludedDependencies: [
      "WebExtension tabs and current-window state replaced by a fail-closed undefined result",
    ],
  },
  {
    localModule:
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/platform/browser/browser-popup-utils.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/platform/browser/browser-popup-utils.ts",
    ],
    mode: "adapter",
    excludedDependencies: [
      "browser popup geometry and window detection replaced by an always-popout no-prefill boundary",
    ],
  },
  {
    localModule:
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/components/vault/add-edit/add-edit.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/add-edit/add-edit.component.ts",
    ],
    mode: "adapter",
    excludedDependencies: [
      "the full add/edit component graph is replaced by the query-parameter type boundary",
    ],
  },
  {
    localModule:
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/services/vault-popup-items.service.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/services/vault-popup-items.service.ts",
    ],
    mode: "adapter",
    excludedDependencies: [
      "upstream account, cipher, autofill, and browser state replaced by PopupStateStore.state$ and VaultFacade",
    ],
  },
  {
    localModule:
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/services/vault-popup-list-filters.service.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/services/vault-popup-list-filters.service.ts",
    ],
    mode: "adapter",
    excludedDependencies: [
      "StateProvider, ViewCacheService, policy, organization, collection, account, cipher, folder, restricted-item, and feature-flag services replaced by PopupStateStore and VaultFacade",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/vault/retained-restricted-item-types.service.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/common/src/vault/services/restricted-item-types.service.ts",
    ],
    mode: "adapter",
    excludedDependencies: [
      "organization and policy services replaced by a narrow restricted-type observable token",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/vault/retained-item-types.provider.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/new-item-dropdown/new-item-dropdown.component.ts",
    ],
    mode: "adapter",
    excludedDependencies: [
      "SSH and non-personal item types are statically restricted; the new-item dialog feature flag is disabled",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/vault/official-vault-boundary.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/vault/src/components/add-edit-folder-dialog/add-edit-folder-dialog.component.ts",
    ],
    mode: "adapter",
    excludedDependencies: [
      "the upstream folder service graph is replaced by the retained local folder dialog host",
    ],
  },
  {
    localModule:
      "apps/menubar-tauri/src/app/vault/retained-new-item-dropdown.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/new-item-dropdown/new-item-dropdown.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/new-item-dropdown/new-item-dropdown.component.html",
    ],
    mode: "direct",
    excludedDependencies: [
      "the official component owns the rendered menu while the host binds only retained providers and folder dialog behavior",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/vault/vault-list-page.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/vault.component.html",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/vault-list-items-container/vault-list-items-container.component.html",
    ],
    mode: "direct",
    excludedDependencies: [
      "top-level VaultComponent is excluded; the local route retains official list rows inside the six-node native hierarchy",
      "official VaultHeaderComponent replaced by the in-flow VaultRootHeaderComponent",
      "BrowserApi",
      "VaultPopupAutofillService",
      "current-tab URL matching",
      "content-script autofill",
    ],
    staticDependencyDecision: [
      "the pinned VaultOpen/NoResults empty-state composition is retained directly from the official Vault template; only stale and unavailable cache messaging remains local because native retry has no browser-popup authority",
      "the official empty-state current-tab prefill is excluded with BrowserApi/current-tab branches; the retained native New Login action supplies only the supported type=1 query",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/vault/vault-row-actions.adapter.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/item-copy-action/item-copy-actions.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/item-more-options/item-more-options.component.ts",
    ],
    mode: "adapter",
    excludedDependencies: [
      "official browser clipboard, paste, TOTP, sync, and mutation services remain behind retained local service boundaries",
      "browser navigation, autofill, organization, collection, premium, passkey, and SSH branches",
    ],
  },
  {
    localModule:
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/vault-list-items-container.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/vault-list-items-container/vault-list-items-container.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/vault-list-items-container/vault-list-items-container.component.html",
    ],
    mode: "adapter",
    excludedDependencies: [
      "BrowserApi and BrowserPopupUtils",
      "VaultPopupAutofillService and current-tab state",
      "organization, collection, attachment, premium, passkey, and SSH branches",
    ],
  },
  {
    localModule:
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/vault-list-items-container/vault-list-items-container.component.html",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/item-copy-action/item-copy-actions.component.html",
    ],
    mode: "adapter",
    excludedDependencies: [
      "autofill and fill actions",
      "organization and attachment indicators",
      "SSH copy actions",
    ],
  },
  {
    localModule:
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/item-more-options.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/item-more-options/item-more-options.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/item-more-options/item-more-options.component.html",
    ],
    mode: "adapter",
    excludedDependencies: [
      "autofill, domain matching, and browser tab state",
      "organization and collection assignment",
      "premium upgrade, passkey, and SSH branches",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/vault/popup-cipher-view.adapter.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/views/popup-cipher.view.ts",
    ],
    mode: "adapter",
    excludedDependencies: [
      "official organization, collection, attachment, and decryption-failure view fields",
      "SSH cipher type",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/vault/login-cipher-view.adapter.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/common/src/vault/models/view/cipher.view.ts",
      "vendor/bitwarden-clients/libs/common/src/vault/models/view/login.view.ts",
      "vendor/bitwarden-clients/libs/common/src/vault/models/view/login-uri.view.ts",
      "vendor/bitwarden-clients/libs/common/src/vault/models/view/field.view.ts",
      "vendor/bitwarden-clients/libs/common/src/vault/models/view/folder.view.ts",
      "vendor/bitwarden-clients/libs/common/src/vault/models/view/password-history.view.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/item-details/item-details-v2.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/item-details/item-details-v2.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/login-credentials/login-credentials-view.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/login-credentials/login-credentials-view.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/autofill-options/autofill-options-view.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/autofill-options/autofill-options-view.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/additional-options/additional-options.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/additional-options/additional-options.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/custom-fields/custom-fields-v2.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/custom-fields/custom-fields-v2.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/item-history/item-history-v2.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/item-history/item-history-v2.component.html",
    ],
    mode: "adapter",
    excludedDependencies: [
      "autofill/content and autofill/background",
      "BrowserApi and chrome runtime",
      "attachment, FIDO2, SSH, premium, organization, and collection UI branches",
    ],
    staticDependencyDecision: [
      "raw official Login detail component aliases remain exact and dormant while guarded Login-only transforms run in production",
      "the runtime projection uses only pinned CipherView, LoginView, LoginUriView, FieldView, and FolderView classes",
      "storage-core, guid, and user-core are restored byte-for-byte; the key-management adapter satisfies one upstream type-only symbol emitted as a runtime import",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/vault/personal-cipher-view.adapter.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/common/src/vault/models/view/cipher.view.ts",
      "vendor/bitwarden-clients/libs/common/src/vault/models/view/card.view.ts",
      "vendor/bitwarden-clients/libs/common/src/vault/models/view/identity.view.ts",
      "vendor/bitwarden-clients/libs/common/src/vault/models/view/secure-note.view.ts",
      "vendor/bitwarden-clients/libs/common/src/vault/models/view/field.view.ts",
      "vendor/bitwarden-clients/libs/common/src/vault/models/view/folder.view.ts",
      "vendor/bitwarden-clients/libs/common/src/vault/enums/index.ts",
      "vendor/bitwarden-clients/libs/common/src/vault/enums/linked-id-type.enum.ts",
      "vendor/bitwarden-clients/libs/common/src/vault/types/union-of-values.ts",
    ],
    mode: "adapter",
    excludedDependencies: [
      "opaque server payloads, encrypted keys, attachments, organization ownership, and collections",
      "Login, SSH Key, Bank Account, Driver License, and Passport projections",
    ],
    staticDependencyDecision: [
      "the adapter creates fresh official Card, Identity, SecureNote, Field, Cipher, and Folder views",
      "action fields retain exact VaultField object identity while opaque payloads never enter official views",
      "Secure Note linked fields fail closed because the pinned source exposes no linked options",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-personal-detail.transform-manifest.json",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/view/view.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/view/view.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/cipher-view.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/cipher-view.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/item-details/item-details-v2.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/item-details/item-details-v2.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/card-details/card-details-view.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/card-details/card-details-view.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/view-identity-sections/view-identity-sections.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/view-identity-sections/view-identity-sections.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/read-only-cipher-card/read-only-cipher-card.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/read-only-cipher-card/read-only-cipher-card.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/additional-options/additional-options.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/additional-options/additional-options.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/custom-fields/custom-fields-v2.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/custom-fields/custom-fields-v2.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/item-history/item-history-v2.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/item-history/item-history-v2.component.html",
      "vendor/bitwarden-clients/libs/vault/src/pipes/credit-card-number.pipe.ts",
      "vendor/bitwarden-clients/libs/common/src/autofill/utils/index.ts",
      "vendor/bitwarden-clients/libs/common/src/vault/models/view/card.view.ts",
      "vendor/bitwarden-clients/libs/common/src/vault/models/view/identity.view.ts",
      "vendor/bitwarden-clients/libs/common/src/vault/models/view/secure-note.view.ts",
      "vendor/bitwarden-clients/libs/common/src/vault/models/view/cipher.view.ts",
      "vendor/bitwarden-clients/libs/common/src/vault/models/view/field.view.ts",
      "vendor/bitwarden-clients/libs/common/src/vault/models/view/folder.view.ts",
      "vendor/bitwarden-clients/libs/common/src/vault/enums/index.ts",
      "vendor/bitwarden-clients/libs/common/src/vault/enums/linked-id-type.enum.ts",
      "vendor/bitwarden-clients/libs/common/src/vault/types/union-of-values.ts",
    ],
    mode: "guard",
    excludedDependencies: [
      "unsupported raw personal-detail aliases remain dormant; the guarded retained runtimes and projection adapter own the supported personal hierarchy",
      "browser, attachments, unsupported cipher types, billing, event, policy, and collection services",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-personal-form.transform-manifest.json",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/add-edit/add-edit.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/add-edit/add-edit.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/cipher-form.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/cipher-form.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/cipher-form-container.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/abstractions/cipher-form-config.service.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/abstractions/cipher-form.service.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/item-details/item-details-section.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/item-details/item-details-section.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/card-details-section/card-details-section.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/card-details-section/card-details-section.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/identity/identity.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/identity/identity.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/additional-options/additional-options-section.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/additional-options/additional-options-section.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/custom-fields/custom-fields.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/custom-fields/custom-fields.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/custom-fields/add-edit-custom-field-dialog/add-edit-custom-field-dialog.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/custom-fields/add-edit-custom-field-dialog/add-edit-custom-field-dialog.component.html",
    ],
    mode: "guard",
    excludedDependencies: [
      "unsupported raw personal-form aliases remain dormant; guarded retained form runtimes own the supported personal hierarchy",
      "browser autofill, attachments, unsupported cipher types, ownership, billing, events, and policy branches",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-color-password.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/components/src/color-password/color-password.component.ts",
    ],
    mode: "template",
    excludedDependencies: ["PlatformUtilsService clipboard writes; selection copy is blocked so typed native detail actions remain the sole clipboard owner"],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-item-details.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/item-details/item-details-v2.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/item-details/item-details-v2.component.html",
    ],
    mode: "template",
    excludedDependencies: ["organization and collection presentation", "responsive owner-list state", "configuration-backed favicon services"],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-credentials.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/login-credentials/login-credentials-view.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/login-credentials/login-credentials-view.component.html",
    ],
    mode: "template",
    excludedDependencies: ["premium, billing, passkey, change-password, and event-log branches", "browser copy directives replaced by typed native outputs"],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-totp-countdown.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/vault/src/components/totp-countdown/totp-countdown.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/components/totp-countdown/totp-countdown.component.html",
    ],
    mode: "adapter",
    excludedDependencies: ["broad @bitwarden/components barrel replaced only by the exact TypographyDirective import"],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-uri-options.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/autofill-options/autofill-options-view.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/autofill-options/autofill-options-view.component.html",
    ],
    mode: "template",
    excludedDependencies: ["account, CipherService, PlatformUtilsService, and current-browser launch state"],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-additional-options.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/additional-options/additional-options.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/additional-options/additional-options.component.html",
    ],
    mode: "template",
    excludedDependencies: ["browser clipboard directive replaced by typed notes copy output"],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-custom-fields.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/custom-fields/custom-fields-v2.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/custom-fields/custom-fields-v2.component.html",
    ],
    mode: "template",
    excludedDependencies: ["Card and Identity linked-field breadth", "event logging and browser copy/text-drag directives"],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-item-history.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/item-history/item-history-v2.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/item-history/item-history-v2.component.html",
    ],
    mode: "template",
    excludedDependencies: ["aggregate Storybook-reachable components barrel", "ViewPasswordHistoryService replaced by typed navigation output"],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-detail.transform-manifest.json",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/common/src/vault/models/view/cipher.view.ts",
      "vendor/bitwarden-clients/libs/common/src/vault/models/view/login.view.ts",
      "vendor/bitwarden-clients/libs/common/src/vault/models/view/login-uri.view.ts",
      "vendor/bitwarden-clients/libs/common/src/vault/models/view/field.view.ts",
      "vendor/bitwarden-clients/libs/common/src/vault/models/view/folder.view.ts",
      "vendor/bitwarden-clients/libs/common/src/vault/models/view/password-history.view.ts",
      "vendor/bitwarden-clients/libs/common/src/vault/abstractions/totp.service.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/item-details/item-details-v2.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/item-details/item-details-v2.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/login-credentials/login-credentials-view.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/login-credentials/login-credentials-view.component.html",
      "vendor/bitwarden-clients/libs/vault/src/components/totp-countdown/totp-countdown.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/components/totp-countdown/totp-countdown.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/autofill-options/autofill-options-view.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/autofill-options/autofill-options-view.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/additional-options/additional-options.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/additional-options/additional-options.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/custom-fields/custom-fields-v2.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/custom-fields/custom-fields-v2.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/item-history/item-history-v2.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/item-history/item-history-v2.component.html",
      "vendor/bitwarden-clients/libs/storage-core/src/index.ts",
      "vendor/bitwarden-clients/libs/guid/src/index.ts",
      "vendor/bitwarden-clients/libs/user-core/src/index.ts",
    ],
    mode: "guard",
    excludedDependencies: [
      "raw aliases remain source-only; eight guarded Login transforms retain only the supported detail surface",
    ],
  },
  {
    localModule:
      "apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-login-form.transform-manifest.json",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/cipher-form.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/cipher-form.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/cipher-form-container.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/item-details/item-details-section.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/item-details/item-details-section.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/login-details-section/login-details-section.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/login-details-section/login-details-section.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/autofill-options/autofill-options.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/autofill-options/autofill-options.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/autofill-options/uri-option.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/autofill-options/uri-option.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/autofill-options/advanced-uri-option-dialog.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/autofill-options/advanced-uri-option-dialog.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/additional-options/additional-options-section.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/additional-options/additional-options-section.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/custom-fields/custom-fields.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/custom-fields/custom-fields.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/custom-fields/add-edit-custom-field-dialog/add-edit-custom-field-dialog.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/custom-fields/add-edit-custom-field-dialog/add-edit-custom-field-dialog.component.html",
    ],
    mode: "guard",
    excludedDependencies: [
      "non-Login cipher sections, organization and collection ownership, attachments, archive, passkeys, TOTP capture, linked fields, Windows app URI, and browser autofill settings",
    ],
    staticDependencyDecision: [
      "all ten raw official aliases remain dormant while exact named AST and byte-level template transforms produce the Login-only runtime hierarchy",
      "the retained adapter supplies CipherFormService, generation, cache, toast, dialog, i18n, and canViewSecrets without adapting browser, ownership, archive, audit, event, platform, FIDO, or TOTP-capture services",
      "the manifest pins the sorted resolved production value-import closure, including exact dependency aliases, extensions, symlinks, and realpaths",
    ],
  },
  {
    localModule:
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/vault-loading-skeleton/vault-loading-skeleton.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault-loading-skeleton/vault-loading-skeleton.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault-loading-skeleton/vault-loading-skeleton.component.html",
    ],
    mode: "direct",
    excludedDependencies: [],
  },
  {
    localModule:
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/vault-fade-in-out/vault-fade-in-out.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault-fade-in-out/vault-fade-in-out.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault-fade-in-out/vault-fade-in-out.component.html",
    ],
    mode: "direct",
    excludedDependencies: [],
  },
  {
    localModule:
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/vault-fade-in-out-skeleton/vault-fade-in-out-skeleton.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault-fade-in-out-skeleton/vault-fade-in-out-skeleton.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault-fade-in-out-skeleton/vault-fade-in-out-skeleton.component.html",
    ],
    mode: "direct",
    excludedDependencies: [],
  },
  {
    localModule: "apps/menubar-tauri/src/app/vault/vault-filter-chip.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/vault-list-filters/vault-list-filters.component.html",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/vault-list-filters/vault-list-filters.component.ts",
    ],
    mode: "template",
    excludedDependencies: ["@bitwarden/components ChipFilterComponent"],
  },
  {
    localModule: "apps/menubar-tauri/src/app/vault/vault-item-icon.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/angular/src/vault/components/icon.component.ts",
      "vendor/bitwarden-clients/libs/angular/src/vault/components/icon.component.html",
      "vendor/bitwarden-clients/libs/common/src/vault/icon/build-cipher-icon.ts",
    ],
    mode: "adapter",
    excludedDependencies: [
      "@bitwarden/common cipher models and icon builder",
      "EnvironmentService and DomainSettingsService observables",
      "ConfigService feature flags",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/vault/vault-detail-section.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/read-only-cipher-card/read-only-cipher-card.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/login-credentials/login-credentials-view.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/item-history/item-history-v2.component.html",
    ],
    mode: "template",
    excludedDependencies: ["@bitwarden/components CardComponent", "SectionHeaderComponent"],
  },
  {
    localModule: "apps/menubar-tauri/src/app/vault/vault-detail-field.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/login-credentials/login-credentials-view.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/autofill-options/autofill-options-view.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/custom-fields/custom-fields-v2.component.html",
    ],
    mode: "template",
    excludedDependencies: [
      "@bitwarden/components FormFieldComponent",
      "CopyCipherFieldService",
      "PasswordRepromptService",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/vault/official-totp.service.adapter.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/common/src/vault/abstractions/totp.service.ts",
      "vendor/bitwarden-clients/libs/common/src/vault/services/totp.service.ts",
    ],
    mode: "adapter",
    excludedDependencies: [
      "SdkService and the WebAssembly SDK client observable",
      "premium entitlement service",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/view/view.component.html",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/view/view.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/cipher-view.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/item-details/item-details-v2.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/card-details/card-details-view.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/card-details/card-details-view.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/view-identity-sections/view-identity-sections.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/view-identity-sections/view-identity-sections.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/login-credentials/login-credentials-view.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/autofill-options/autofill-options-view.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/additional-options/additional-options.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/item-history/item-history-v2.component.html",
    ],
    mode: "template",
    excludedDependencies: [
      "BrowserApi",
      "VaultPopupAutofillService",
      "current-tab URL matching",
      "content-script autofill",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/vault/new-item-page.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/popup/app-routing.module.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/new-item-page/new-item-page.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/new-item-page/new-item-page.component.html",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/new-item-dropdown/new-item-dropdown.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/new-item-dropdown/new-item-dropdown.component.html",
      "vendor/bitwarden-clients/libs/vault/src/components/add-item-grid/add-item-grid.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/components/add-item-grid/add-item-grid.component.html",
      "vendor/bitwarden-clients/libs/vault/src/components/add-edit-folder-dialog/add-edit-folder-dialog.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/components/add-edit-folder-dialog/add-edit-folder-dialog.component.html",
    ],
    mode: "template",
    excludedDependencies: [
      "BrowserApi current-tab prefill and pop-out detection",
      "@bitwarden/vault AddItemGridComponent",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/vault/vault-add-edit-page.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/cipher-form.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/item-details/item-details-section.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/login-details-section/login-details-section.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/autofill-options/autofill-options.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/card-details-section/card-details-section.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/card-details-section/card-details-section.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/identity/identity.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/identity/identity.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/sshkey-section/sshkey-section.component.html",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/additional-options/additional-options-section.component.html",
    ],
    mode: "template",
    excludedDependencies: [
      "BrowserApi",
      "VaultPopupAutofillService",
      "current-tab URL matching",
      "content-script autofill",
      "organization/collection write APIs",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/vault/vault-reprompt-dialog.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/vault/src/components/password-reprompt.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/components/password-reprompt.component.html",
      "vendor/bitwarden-clients/libs/vault/src/services/password-reprompt.service.ts",
      "vendor/bitwarden-clients/libs/common/src/auth/services/user-verification/user-verification-api.service.ts",
      "vendor/bitwarden-clients/libs/components/src/dialog/dialog/dialog.component.ts",
      "vendor/bitwarden-clients/libs/components/src/dialog/dialog/dialog.component.html",
    ],
    mode: "adapter",
    excludedDependencies: [
      "browser MasterPasswordUnlockService state graph",
      "browser DialogService",
      "upstream i18n and toast services",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/vault/vault-password-history-page.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/vault-password-history/vault-password-history.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/vault-password-history/vault-password-history.component.html",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/services/browser-view-password-history.service.ts",
      "vendor/bitwarden-clients/libs/vault/src/components/password-history-view/password-history-view.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/components/password-history-view/password-history-view.component.html",
    ],
    mode: "overlay",
    excludedDependencies: [
      "browser popup router cache service",
      "browser clipboard directives replaced by the typed native copy output",
      "BrowserApi/current-tab/current-URL, autofill/content/background, organization/collection, attachments, SSH, FIDO/passkeys, premium, import/export, and native messaging branches",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/recovery/password-history/official-password-history-view.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/vault/src/components/password-history-view/password-history-view.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/components/password-history-view/password-history-view.component.html",
    ],
    mode: "overlay",
    excludedDependencies: ["browser clipboard directive replaced by a typed output to the route-owned native clipboard policy"],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/recovery/official-recovery.transform-manifest.json",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/vault-password-history/vault-password-history.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/vault-password-history/vault-password-history.component.html",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/services/browser-view-password-history.service.ts",
      "vendor/bitwarden-clients/libs/vault/src/components/password-history-view/password-history-view.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/components/password-history-view/password-history-view.component.html",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/folders.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/folders.component.html",
      "vendor/bitwarden-clients/libs/vault/src/components/add-edit-folder-dialog/add-edit-folder-dialog.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/components/add-edit-folder-dialog/add-edit-folder-dialog.component.html",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/archive.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/archive.component.html",
      "vendor/bitwarden-clients/libs/vault/src/services/archive-cipher-utilities.service.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/trash.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/trash.component.html",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/trash-list-items-container/trash-list-items-container.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/trash-list-items-container/trash-list-items-container.component.html",
      "vendor/bitwarden-clients/apps/browser/src/_locales/zh_CN/messages.json",
    ],
    mode: "guard",
    excludedDependencies: ["digest-pinned recovery transform authority, import closure, aliases, and product-boundary exclusions"],
    staticDependencyDecision: [
      "password history, folders, Archive, and Trash production routes resolve only guarded recovery overlays at the pinned vendor revision",
      "M10 synthetic recovery ports and fixtures are compile-time evidence only; the production evidence alias terminates at an empty shim",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/vault/vault-sync.service.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/common/src/platform/sync/sync.response.ts",
      "vendor/bitwarden-clients/libs/common/src/admin-console/models/domain/encrypted-organization-key.ts",
      "vendor/bitwarden-clients/libs/common/src/admin-console/models/collections/collection.response.ts",
      "vendor/bitwarden-clients/libs/common/src/vault/models/domain/cipher.ts",
    ],
    mode: "adapter",
    excludedDependencies: ["provider organization keys", "v2 account cryptographic state"],
  },
  {
    localModule: "apps/menubar-tauri/src/app/vault/folders-page.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/folders.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/folders.component.html",
      "vendor/bitwarden-clients/libs/vault/src/components/add-edit-folder-dialog/add-edit-folder-dialog.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/components/add-edit-folder-dialog/add-edit-folder-dialog.component.html",
    ],
    mode: "overlay",
    excludedDependencies: ["official list/form DOM lives in guarded recovery overlays; native host owns navigation and operation lifecycle"],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/recovery/folders/official-folders.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/folders.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/folders.component.html",
    ],
    mode: "overlay",
    excludedDependencies: ["FolderService observable, AccountService, DialogService, and browser pop-out are replaced by typed inputs and outputs"],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/recovery/folders/official-add-edit-folder-dialog.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/vault/src/components/add-edit-folder-dialog/add-edit-folder-dialog.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/components/add-edit-folder-dialog/add-edit-folder-dialog.component.html",
    ],
    mode: "overlay",
    excludedDependencies: ["Folder API, account/key, toast/log, config, and browser DialogService are replaced by typed inputs and outputs"],
  },
  {
    localModule: "apps/menubar-tauri/src/app/vault/vault-folder.service.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/common/src/vault/services/folder/folder-api.service.ts",
      "vendor/bitwarden-clients/libs/common/src/vault/services/folder/folder.service.ts",
      "vendor/bitwarden-clients/libs/common/src/vault/models/request/folder.request.ts",
    ],
    mode: "adapter",
    excludedDependencies: ["upstream observable state provider", "multi-account user state"],
  },
  {
    localModule: "apps/menubar-tauri/src/app/vault/archive-page.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/archive.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/archive.component.html",
      "vendor/bitwarden-clients/libs/vault/src/services/archive-cipher-utilities.service.ts",
    ],
    mode: "overlay",
    excludedDependencies: [
      "official list/menu/empty DOM lives in the guarded recovery overlay",
      "browser popup pop-out and observable state providers",
      "premium, organization/collection, attachments, passkeys, SSH, and decryption-failure branches",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/recovery/archive/official-archive.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/archive.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/archive.component.html",
      "vendor/bitwarden-clients/libs/vault/src/services/archive-cipher-utilities.service.ts",
    ],
    mode: "overlay",
    excludedDependencies: ["premium and ownership branches replaced by immutable personal projections and typed commands"],
  },
  {
    localModule: "apps/menubar-tauri/src/app/vault/trash-page.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/trash.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/trash.component.html",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/trash-list-items-container/trash-list-items-container.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/trash-list-items-container/trash-list-items-container.component.html",
      "vendor/bitwarden-clients/apps/browser/src/_locales/zh_CN/messages.json",
    ],
    mode: "overlay",
    excludedDependencies: [
      "official warning/list/menu/empty DOM lives in guarded recovery overlays",
      "browser popup pop-out and observable state providers",
      "organization/collection, attachments, passkeys, SSH, and decryption-failure branches",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/recovery/trash/official-trash.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/trash.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/trash.component.html",
      "vendor/bitwarden-clients/apps/browser/src/_locales/zh_CN/messages.json",
    ],
    mode: "overlay",
    excludedDependencies: ["observable state and browser pop-out replaced by immutable inputs and typed outputs"],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/recovery/trash/official-trash-list-items-container.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/trash-list-items-container/trash-list-items-container.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/trash-list-items-container/trash-list-items-container.component.html",
    ],
    mode: "overlay",
    excludedDependencies: ["server restore permission and ownership branches replaced by local personal projection validation"],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-add-edit.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/tools/popup/send-v2/add-edit/send-add-edit.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/tools/popup/send-v2/add-edit/send-add-edit.component.html",
    ],
    mode: "overlay",
    excludedDependencies: ["File headers, make-copy policy, browser dialogs, toasts, and broad Send form API replaced by typed inputs and outputs"],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-details.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/tools/send/send-ui/src/send-form/components/send-details/send-details.component.ts",
      "vendor/bitwarden-clients/libs/tools/send/send-ui/src/send-form/components/send-details/send-details.component.html",
      "vendor/bitwarden-clients/libs/tools/send/send-ui/src/send-form/components/send-details/send-text-details.component.ts",
      "vendor/bitwarden-clients/libs/tools/send/send-ui/src/send-form/components/send-details/send-text-details.component.html",
      "vendor/bitwarden-clients/libs/tools/send/send-ui/src/send-form/components/options/send-options.component.ts",
      "vendor/bitwarden-clients/libs/tools/send/send-ui/src/send-form/components/options/send-options.component.html",
    ],
    mode: "overlay",
    excludedDependencies: ["File Send, Email auth, billing, organization policy, browser copy directive, and upstream SendFormService; exact continuous template and AST/import contracts retain the official Text form/card structure"],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-text-details.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/tools/send/send-ui/src/send-form/components/send-details/send-text-details.component.ts",
      "vendor/bitwarden-clients/libs/tools/send/send-ui/src/send-form/components/send-details/send-text-details.component.html",
    ],
    mode: "overlay",
    excludedDependencies: ["official reactive form service replaced by the retained Text Send value input/output contract"],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-options.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/tools/send/send-ui/src/send-form/components/options/send-options.component.ts",
      "vendor/bitwarden-clients/libs/tools/send/send-ui/src/send-form/components/options/send-options.component.html",
    ],
    mode: "overlay",
    excludedDependencies: ["official reactive form service and policy streams replaced by retained Text Send value inputs; no premium or organization branches"],
  },
  {
    localModule: "apps/menubar-tauri/src/app/send/retained-text-send-form.service.ts",
    upstreamSources: ["vendor/bitwarden-clients/libs/tools/send/send-ui/src/send-form/abstractions/send-form.service.ts"],
    mode: "adapter",
    excludedDependencies: ["all non-Text Send field groups and transport ownership"],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/tools/popup/send-v2/send-v2.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/tools/popup/send-v2/send-v2.component.html",
      "vendor/bitwarden-clients/libs/tools/send/send-ui/src/send-list/send-list.component.ts",
    ],
    mode: "overlay",
    excludedDependencies: [
      "File Send creation and presentation",
      "browser account, pop-out, observable Send state, and browser skeleton providers",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list-items-container.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/tools/send/send-ui/src/send-list-items-container/send-list-items-container.component.ts",
      "vendor/bitwarden-clients/libs/tools/send/send-ui/src/send-list-items-container/send-list-items-container.component.html",
    ],
    mode: "overlay",
    excludedDependencies: [
      "File Send icon branch",
      "router, dialog, environment, API, clipboard, logger, and toast services replaced by typed outputs",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-created.component.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/tools/popup/send-v2/send-created/send-created.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/tools/popup/send-v2/send-created/send-created.component.html",
    ],
    mode: "overlay",
    excludedDependencies: [
      "Email-recipient authentication description",
      "browser state, router, environment, clipboard, toast, and PopOutComponent replaced by typed inputs and outputs",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/app/upstream-overlays/send/official-send.transform-manifest.json",
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/tools/popup/send-v2/send-v2.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/tools/popup/send-v2/send-v2.component.html",
      "vendor/bitwarden-clients/libs/tools/send/send-ui/src/send-list-items-container/send-list-items-container.component.ts",
      "vendor/bitwarden-clients/libs/tools/send/send-ui/src/send-list-items-container/send-list-items-container.component.html",
      "vendor/bitwarden-clients/apps/browser/src/tools/popup/send-v2/send-created/send-created.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/tools/popup/send-v2/send-created/send-created.component.html",
    ],
    mode: "guard",
    excludedDependencies: [
      "digest-pinned manifest records sorted authorities, runtimes, aliases, exact continuous template transforms, AST/import contracts, production roots, and forbidden closure rules",
    ],
  },
  {
    localModule: "apps/menubar-tauri/src/sdk/bitwarden-sdk-core.service.ts",
    upstreamSources: [
      "vendor/bitwarden-clients/libs/common/src/platform/services/sdk/default-sdk-load.service.ts",
      "vendor/bitwarden-clients/libs/common/src/key-management/crypto/services/encrypt.service.implementation.ts",
      "vendor/bitwarden-clients/libs/common/src/tools/send/services/send.service.ts",
      "vendor/bitwarden-clients/libs/common/src/vault/services/cipher.service.ts",
    ],
    mode: "adapter",
    excludedDependencies: [
      "SDK generated UI components",
      "browser content-script runtime",
      "filesystem paths",
    ],
  },
] as const satisfies readonly UpstreamSourceMapping[];
