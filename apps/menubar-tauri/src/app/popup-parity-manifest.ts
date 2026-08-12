export type PopupParityClassification =
  | "required-native"
  | "web-vault-handoff"
  | "excluded-browser";
export type PopupParityStatus = "missing" | "partial" | "complete";
export type PopupParityEvidenceGate = "visual" | "native" | "audit";
export type PopupParityProductionOwner = "direct" | "overlay" | "native" | "web-vault-handoff";

export interface PopupParityEvidence {
  readonly gate: PopupParityEvidenceGate;
  readonly path: string;
  readonly surfaceIds: readonly string[];
}

export interface PopupParityEntry {
  readonly id: string;
  readonly officialRoutes: readonly string[];
  readonly classification: PopupParityClassification;
  readonly status: PopupParityStatus;
  readonly localRoutes: readonly string[];
  readonly localModules: readonly string[];
  readonly upstreamSources: readonly string[];
  readonly tests: readonly string[];
  readonly evidence: readonly PopupParityEvidence[];
  readonly remainingGaps: readonly string[];
  readonly productionOwner?: PopupParityProductionOwner;
  readonly exclusionReason?: string;
}

type IncompletePopupParityStatus = Exclude<PopupParityStatus, "complete">;

type LocalParityEvidence = Pick<
  PopupParityEntry,
  "localRoutes" | "localModules" | "upstreamSources" | "tests" | "evidence" | "productionOwner"
>;

export interface PopupParitySourceMapping {
  readonly localModule: string;
  readonly upstreamSources: readonly string[];
}

const partialCompletionGaps = [
  "Official hierarchy and behavior completion gates.",
  "State, security, accessibility, visual, and audit evidence completion gates.",
] as const;

const missingCompletionGaps = [
  "Source mapping, hierarchy, and behavior completion gates.",
  "State, security, accessibility, visual, and audit evidence completion gates.",
] as const;

const browserNavigationSurfaces = ["web" + "Request", "web" + "Navigation"] as const;
const g3VisualEvidencePath = "docs/superpowers/screenshots/g3-generator-account-settings-2026-07-13";
const g3AuditEvidencePath = "docs/superpowers/specs/2026-07-12-official-popup-scope-ui-audit.md";
const g2LoginLiveEvidencePath = "docs/superpowers/specs/2026-07-13-live-self-hosted-login-mutation-result.md";
const g2PersonalVisualEvidencePath = "docs/superpowers/screenshots/g2-personal-ciphers-2026-07-13";
const g2PersonalAuditEvidencePath = "docs/superpowers/screenshots/g2-personal-ciphers-2026-07-13/design-qa.md";
const g2PersonalNativeEvidencePath = "docs/superpowers/screenshots/g2-personal-ciphers-2026-07-13/native/provenance.md";
const g2CardLiveEvidencePath = "docs/superpowers/specs/2026-07-13-live-self-hosted-card-mutation-result.md";
const g2IdentityLiveEvidencePath = "docs/superpowers/specs/2026-07-13-live-self-hosted-identity-mutation-result.md";
const g2SecureNoteLiveEvidencePath = "docs/superpowers/specs/2026-07-13-live-self-hosted-secure-note-mutation-result.md";
const g2OrganizationVisualEvidencePath = "docs/superpowers/screenshots/g2-organization-recovery-2026-07-13";
const g2OrganizationAuditEvidencePath = "docs/superpowers/screenshots/g2-organization-recovery-2026-07-13/design-qa.md";
const g2OrganizationNativeEvidencePath = "docs/superpowers/screenshots/g2-organization-recovery-2026-07-13/native/provenance.md";
const g2FolderLiveEvidencePath = "docs/superpowers/specs/2026-07-13-live-self-hosted-folder-recovery-result.md";
const m34AuthVisualEvidencePath = "docs/superpowers/screenshots/m3-m4-official-auth-accounts-2026-07-14";
const m34AuthAuditEvidencePath = "docs/superpowers/specs/2026-07-14-m3-m4-task-8-self-hosted-live-result.md";
const m34SelfHostedLiveEvidencePath = "docs/superpowers/specs/2026-07-14-m3-m4-task-8-self-hosted-live-result.md";
const m34AuthTests = ["apps/menubar-tauri/e2e/official-auth-accounts.spec.ts"] as const;
const m34AuthLiveTest = "apps/menubar-tauri/e2e/live/official-auth-live.spec.ts";
const excludedDomAutofillReason = "DOM or multi-field autofill. Content scripts and page-detail parsing.";
const excludedBrowserBackgroundReason = "Browser background/service-worker messaging.";
const excludedBrowserNavigationReason =
  `\`${browserNavigationSurfaces[0]}\`, \`${browserNavigationSurfaces[1]}\`, badge, and page-action behavior.`;
const excludedNativeMessagingReason = "Native messaging to the official desktop application.";
const excludedFido2Reason = "Browser FIDO2/passkey interception.";
const excludedBrowserPromptsReason =
  "Browser default-password-manager prompts, autofill triage, phishing interstitial injection, and install/intro marketing surfaces.";

function entry<const T extends PopupParityEntry>(value: T): T {
  return value;
}

function incompleteEntry(
  id: string,
  officialRoutes: readonly string[],
  classification: PopupParityClassification,
  status: IncompletePopupParityStatus,
  localEvidence: Partial<LocalParityEvidence> = {},
  exclusionReason?: string,
  remainingGaps?: readonly string[],
): PopupParityEntry {
  return entry({
    id,
    officialRoutes,
    classification,
    status,
    localRoutes: localEvidence.localRoutes ?? [],
    localModules: localEvidence.localModules ?? [],
    upstreamSources: localEvidence.upstreamSources ?? [],
    tests: localEvidence.tests ?? [],
    evidence: localEvidence.evidence ?? [],
    ...(localEvidence.productionOwner === undefined
      ? {}
      : { productionOwner: localEvidence.productionOwner }),
    remainingGaps:
      remainingGaps ??
      (classification === "excluded-browser"
        ? ["Excluded from the macOS menubar product boundary."]
        : status === "missing"
          ? missingCompletionGaps
          : partialCompletionGaps),
    ...(exclusionReason === undefined ? {} : { exclusionReason }),
  });
}

function m34AuthEvidence(id: string): readonly PopupParityEvidence[] {
  return [
    { gate: "visual", path: m34AuthVisualEvidencePath, surfaceIds: [id] },
    { gate: "audit", path: m34AuthAuditEvidencePath, surfaceIds: [id] },
  ];
}

function m15NativeAuditEvidence(id: string): readonly PopupParityEvidence[] {
  return [{ gate: "audit", path: m15NativeAuditEvidencePath, surfaceIds: [id] }];
}

const m56VaultVisualEvidencePath =
  "docs/superpowers/screenshots/m5-m6-official-vault-main-2026-07-13";
const m56VaultAuditEvidencePath =
  "docs/superpowers/specs/2026-07-15-m5-m6-task-6-runtime-result.md";
const m56VaultRuntimeTest = "apps/menubar-tauri/e2e/official-vault-main.spec.ts";
const m78LoginVisualEvidencePath =
  "docs/superpowers/screenshots/m7-m8-official-login-workflow-2026-07-15";
const m78LoginAuditEvidencePath =
  "docs/superpowers/specs/2026-07-15-m7-m8-runtime-result.md";
const m78LoginRuntimeTest =
  "apps/menubar-tauri/e2e/official-login-workflow.spec.ts";
const m10RecoveryVisualEvidencePath =
  "docs/superpowers/screenshots/m10-recovery-2026-07-18";
const m10RecoveryAuditEvidencePath =
  "docs/superpowers/specs/2026-07-18-m10-recovery-runtime-result.md";
const m10RecoveryRuntimeTest =
  "apps/menubar-tauri/e2e/official-recovery-workflows.spec.ts";
const m11GeneratorVisualEvidencePath =
  "docs/superpowers/screenshots/m11-generator-2026-07-19";
const m11GeneratorAuditEvidencePath =
  "docs/superpowers/specs/2026-07-19-m11-generator-runtime-result.md";
const m11GeneratorRuntimeTest =
  "apps/menubar-tauri/e2e/official-generator-workflows.spec.ts";
const m12SendVisualEvidencePath =
  "docs/superpowers/screenshots/m12-text-send-2026-07-19";
const m12SendAuditEvidencePath =
  "docs/superpowers/specs/2026-07-19-m12-text-send-runtime-result.md";
const m12SendRuntimeTest = "apps/menubar-tauri/e2e/official-send-workflows.spec.ts";
const m13SettingsVisualEvidencePath =
  "docs/superpowers/screenshots/m13-settings-2026-07-20";
const m13SettingsAuditEvidencePath =
  "docs/superpowers/specs/2026-07-20-m13-settings-runtime-result.md";
const m13SettingsRuntimeTest =
  "apps/menubar-tauri/e2e/official-settings-workflows.spec.ts";
const m15NativeAuditEvidencePath =
  "docs/superpowers/specs/2026-07-13-macos-runtime-result.md";
const alternativeUnlockRuntimeTest =
  "apps/menubar-tauri/e2e/pin-biometric-unlock.spec.ts";
const alternativeUnlockRemainingGaps = [
  "Physical signed-build Touch ID acceptance remains pending.",
  "Stable signing, notarization, stapling, and Gatekeeper acceptance remain release blockers.",
] as const;
const m13SettingsRemainingGaps = [
  "M15 built-app native proof remains open.",
  "M16 release-candidate comparison remains open.",
] as const;
const globalShortcutSettingsRemainingGaps = [
  "Built-app native shortcut registration and trigger proof remains open.",
  "Release-candidate accessibility, packaging, and audit closure remains open.",
] as const;
const m12SendRemainingGaps = [
  "M14.4 credentialed Bitwarden US, EU, and compatible self-hosted Text Send mutation and cleanup proof remains open.",
  "M15 current-head native clipboard ownership and built-app lifecycle evidence remains open.",
  "M16 release-candidate comparison, accessibility, security, packaging, and audit closure remains open.",
] as const;
const m56VaultRemainingGaps = [
  "The Chrome extension popup was not live-observed and no real official Chrome pixel baseline exists.",
  "Current-head native clipboard, one-field paste, URL-open, and broader product lifecycle evidence remains open where applicable.",
] as const;

function m56VaultEntry(
  id: string,
  localModules: readonly string[],
  upstreamSources: readonly string[],
  tests: readonly string[],
): PopupParityEntry {
  return incompleteEntry(
    id,
    ["/tabs/vault"],
    "required-native",
    "partial",
    {
      localRoutes: ["/tabs/vault"],
      localModules,
      upstreamSources,
      tests: [...tests, m56VaultRuntimeTest],
      evidence: [
        { gate: "visual", path: m56VaultVisualEvidencePath, surfaceIds: [id] },
        { gate: "audit", path: m56VaultAuditEvidencePath, surfaceIds: [id] },
      ],
    },
    undefined,
    m56VaultRemainingGaps,
  );
}

function m78LoginEntry(
  id: string,
  officialRoutes: readonly string[],
  localModules: readonly string[],
  upstreamSources: readonly string[],
  tests: readonly string[],
  remainingGaps: readonly string[],
): PopupParityEntry {
  return incompleteEntry(
    id,
    officialRoutes,
    "required-native",
    "partial",
    {
      localRoutes: officialRoutes.map((route) => route === "/view-cipher" ? "/view-cipher/:id" : route),
      localModules,
      upstreamSources,
      tests: [...tests, m78LoginRuntimeTest],
      evidence: [
        { gate: "visual", path: m78LoginVisualEvidencePath, surfaceIds: [id] },
        { gate: "audit", path: m78LoginAuditEvidencePath, surfaceIds: [id] },
      ],
    },
    undefined,
    remainingGaps,
  );
}

function appendM10RecoveryEvidence(entry: PopupParityEntry): PopupParityEntry {
  return {
    ...entry,
    tests: [...entry.tests, m10RecoveryRuntimeTest],
    evidence: [
      ...entry.evidence,
      { gate: "visual", path: m10RecoveryVisualEvidencePath, surfaceIds: [entry.id] },
      { gate: "audit", path: m10RecoveryAuditEvidencePath, surfaceIds: [entry.id] },
    ],
  };
}

function g2PersonalCipherEvidence(
  id: string,
  liveEvidencePath: string,
): readonly PopupParityEvidence[] {
  return [
    { gate: "visual", path: g2PersonalVisualEvidencePath, surfaceIds: [id] },
    { gate: "audit", path: g2PersonalAuditEvidencePath, surfaceIds: [id] },
    { gate: "native", path: g2PersonalNativeEvidencePath, surfaceIds: [id] },
    { gate: "audit", path: liveEvidencePath, surfaceIds: [id] },
  ];
}

const m78DetailModules = [
  "apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-detail.component.ts",
] as const;
const m78DetailSources = [
  "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/view/view.component.ts",
  "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/view/view.component.html",
  "vendor/bitwarden-clients/libs/vault/src/cipher-view/cipher-view.component.html",
  "vendor/bitwarden-clients/libs/vault/src/cipher-view/login-credentials/login-credentials-view.component.html",
] as const;
const m78DetailTests = [
  "apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.spec.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/cipher-detail-overlay.guard.spec.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-detail.component.spec.ts",
] as const;
const m78FormRoutes = ["/add-cipher", "/edit-cipher", "/clone-cipher"] as const;
const m78FormModules = [
  "apps/menubar-tauri/src/app/vault/vault-add-edit-page.component.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-login-cipher-form.component.ts",
] as const;
const m78FormSources = [
  "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/add-edit/add-edit.component.ts",
  "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/add-edit/add-edit.component.html",
  "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/cipher-form.component.ts",
  "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/cipher-form.component.html",
] as const;
const m78FormTests = [
  "apps/menubar-tauri/src/app/vault/vault-add-edit-page.component.spec.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-form/cipher-form-overlay.guard.spec.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-login-cipher-form.component.spec.ts",
] as const;
const m78LoginReleaseGaps = [
  "A live-observed official Chrome baseline and credentialed cloud/self-hosted mutation proof remain M14/M16 gates.",
  "Applicable current-head native clipboard, paste, URL-open, lifecycle, and release evidence remains M15/M16 work.",
] as const;

const m9PersonalVisualEvidencePath =
  "docs/superpowers/screenshots/m9-official-personal-ciphers-2026-07-17";
const m9PersonalAuditEvidencePath =
  "docs/superpowers/specs/2026-07-17-m9-official-personal-cipher-runtime-result.md";
const m9PersonalRuntimeTest =
  "apps/menubar-tauri/e2e/official-personal-cipher-workflows.spec.ts";
const m9PersonalRemainingGaps = [
  "M14 must supply live-observed official Chrome and credentialed cloud/self-hosted mutation proof.",
  "M15 must supply applicable current-head native clipboard, paste, lifecycle, and recovery evidence.",
  "M16 must complete release packaging and release-grade evidence closure.",
] as const;
const m9PersonalDetailModules = [
  "apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.ts",
  "apps/menubar-tauri/src/app/vault/vault-detail-actions.adapter.ts",
  "apps/menubar-tauri/src/app/vault/personal-cipher-view.adapter.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-personal-cipher-detail.component.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-personal-detail.transform-manifest.json",
] as const;
const m9PersonalDetailTests = [
  "apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.spec.ts",
  "apps/menubar-tauri/src/app/vault/vault-detail-actions.adapter.spec.ts",
  "apps/menubar-tauri/src/app/vault/personal-cipher-view.adapter.spec.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-personal-cipher-detail.component.spec.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/personal-cipher-detail-overlay.guard.spec.ts",
  "apps/menubar-tauri/e2e/vault-personal-cipher-workflows.spec.ts",
  m9PersonalRuntimeTest,
] as const;
const m9PersonalDetailSources = [
  "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/view/view.component.ts",
  "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/view/view.component.html",
  "vendor/bitwarden-clients/libs/vault/src/cipher-view/cipher-view.component.ts",
  "vendor/bitwarden-clients/libs/vault/src/cipher-view/cipher-view.component.html",
  "vendor/bitwarden-clients/libs/vault/src/cipher-view/item-details/item-details-v2.component.ts",
  "vendor/bitwarden-clients/libs/vault/src/cipher-view/item-details/item-details-v2.component.html",
  "vendor/bitwarden-clients/libs/vault/src/cipher-view/additional-options/additional-options.component.ts",
  "vendor/bitwarden-clients/libs/vault/src/cipher-view/additional-options/additional-options.component.html",
  "vendor/bitwarden-clients/libs/vault/src/cipher-view/custom-fields/custom-fields-v2.component.ts",
  "vendor/bitwarden-clients/libs/vault/src/cipher-view/custom-fields/custom-fields-v2.component.html",
  "vendor/bitwarden-clients/libs/vault/src/cipher-view/item-history/item-history-v2.component.ts",
  "vendor/bitwarden-clients/libs/vault/src/cipher-view/item-history/item-history-v2.component.html",
  "vendor/bitwarden-clients/libs/vault/src/cipher-view/read-only-cipher-card/read-only-cipher-card.component.ts",
  "vendor/bitwarden-clients/libs/vault/src/cipher-view/read-only-cipher-card/read-only-cipher-card.component.html",
] as const;
const m9PersonalFormModules = [
  "apps/menubar-tauri/src/app/vault/vault-add-edit-page.component.ts",
  "apps/menubar-tauri/src/app/vault/personal-cipher-save-operation.ts",
  "apps/menubar-tauri/src/app/vault/retained-personal-cipher-form.adapter.ts",
  "apps/menubar-tauri/src/app/vault/vault-cipher-write.service.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-personal-cipher-form.component.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-personal-form.transform-manifest.json",
] as const;
const m9PersonalFormTests = [
  "apps/menubar-tauri/src/app/vault/vault-add-edit-page.component.spec.ts",
  "apps/menubar-tauri/src/app/vault/personal-cipher-save-operation.spec.ts",
  "apps/menubar-tauri/src/app/vault/retained-personal-cipher-form.adapter.spec.ts",
  "apps/menubar-tauri/src/app/vault/vault-cipher-write.service.spec.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-personal-cipher-form.component.spec.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/cipher-form/personal-cipher-form-overlay.guard.spec.ts",
  "apps/menubar-tauri/e2e/vault-personal-cipher-workflows.spec.ts",
  m9PersonalRuntimeTest,
] as const;
const m9PersonalFormSources = [
  "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/add-edit/add-edit.component.ts",
  "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/add-edit/add-edit.component.html",
  "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/cipher-form.component.ts",
  "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/cipher-form.component.html",
  "vendor/bitwarden-clients/libs/vault/src/cipher-form/cipher-form-container.ts",
  "vendor/bitwarden-clients/libs/vault/src/cipher-form/abstractions/cipher-form-config.service.ts",
  "vendor/bitwarden-clients/libs/vault/src/cipher-form/abstractions/cipher-form.service.ts",
  "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/item-details/item-details-section.component.ts",
  "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/item-details/item-details-section.component.html",
  "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/additional-options/additional-options-section.component.ts",
  "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/additional-options/additional-options-section.component.html",
  "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/custom-fields/custom-fields.component.ts",
  "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/custom-fields/custom-fields.component.html",
  "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/custom-fields/add-edit-custom-field-dialog/add-edit-custom-field-dialog.component.ts",
  "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/custom-fields/add-edit-custom-field-dialog/add-edit-custom-field-dialog.component.html",
] as const;
const m9PersonalTypeSources = {
  card: {
    detail: [
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/card-details/card-details-view.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/card-details/card-details-view.component.html",
      "vendor/bitwarden-clients/libs/common/src/vault/models/view/card.view.ts",
    ],
    form: [
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/card-details-section/card-details-section.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/card-details-section/card-details-section.component.html",
    ],
  },
  identity: {
    detail: [
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/view-identity-sections/view-identity-sections.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/view-identity-sections/view-identity-sections.component.html",
      "vendor/bitwarden-clients/libs/common/src/vault/models/view/identity.view.ts",
    ],
    form: [
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/identity/identity.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/identity/identity.component.html",
    ],
  },
  note: {
    detail: ["vendor/bitwarden-clients/libs/common/src/vault/models/view/secure-note.view.ts"],
    form: [
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/additional-options/additional-options-section.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/additional-options/additional-options-section.component.html",
      "vendor/bitwarden-clients/libs/common/src/vault/models/view/secure-note.view.ts",
    ],
  },
} as const;

function m9PersonalCipherEntry(
  id: string,
  type: "card" | "identity" | "note",
  kind: "detail" | "form",
  liveEvidencePath: string,
): PopupParityEntry {
  const routes = kind === "detail" ? ["/view-cipher"] : m78FormRoutes;
  return incompleteEntry(
    id,
    routes,
    "required-native",
    "partial",
    {
      localRoutes: kind === "detail" ? ["/view-cipher/:id"] : m78FormRoutes,
      localModules: kind === "detail" ? m9PersonalDetailModules : m9PersonalFormModules,
      upstreamSources: [
        ...(kind === "detail" ? m9PersonalDetailSources : m9PersonalFormSources),
        ...m9PersonalTypeSources[type][kind],
      ],
      tests: [...(kind === "detail" ? m9PersonalDetailTests : m9PersonalFormTests), m10RecoveryRuntimeTest],
      evidence: [
        ...g2PersonalCipherEvidence(id, liveEvidencePath),
        { gate: "visual", path: m9PersonalVisualEvidencePath, surfaceIds: [id] },
        { gate: "audit", path: m9PersonalAuditEvidencePath, surfaceIds: [id] },
        { gate: "visual", path: m10RecoveryVisualEvidencePath, surfaceIds: [id] },
        { gate: "audit", path: m10RecoveryAuditEvidencePath, surfaceIds: [id] },
      ],
    },
    undefined,
    m9PersonalRemainingGaps,
  );
}

const m78CipherEntries = [
  ...[
    "cipher.view-shell",
    "cipher.view-login",
  ].map((id) => m78LoginEntry(
    id,
    ["/view-cipher"],
    m78DetailModules,
    m78DetailSources,
    m78DetailTests,
    m78LoginReleaseGaps,
  )),
  ...([
    ["cipher.view-card", "Card", g2CardLiveEvidencePath],
    ["cipher.view-identity", "Identity", g2IdentityLiveEvidencePath],
    ["cipher.view-note", "Secure Note", g2SecureNoteLiveEvidencePath],
  ] as const).map(([id, type, liveEvidencePath]) => m9PersonalCipherEntry(
    id,
    type === "Secure Note" ? "note" : type.toLowerCase() as "card" | "identity",
    "detail",
    liveEvidencePath,
  )),
  ...[
    "cipher.reveal-copy",
    "cipher.one-field",
    "cipher.uri",
    "cipher.totp",
  ].map((id) => m78LoginEntry(
    id,
    ["/view-cipher"],
    m78DetailModules,
    m78DetailSources,
    m78DetailTests,
    m78LoginReleaseGaps,
  )),
  appendM10RecoveryEvidence(m78LoginEntry(
    "cipher.lifecycle",
    ["/view-cipher"],
    m78DetailModules,
    m78DetailSources,
    m78DetailTests,
    m78LoginReleaseGaps,
  )),
  ...["cipher.form-shell", "cipher.form-login"].map(
    (id) => m78LoginEntry(
      id,
      m78FormRoutes,
      m78FormModules,
      m78FormSources,
      m78FormTests,
      m78LoginReleaseGaps,
    ),
  ),
  ...([
    ["cipher.form-card", "Card", g2CardLiveEvidencePath],
    ["cipher.form-identity", "Identity", g2IdentityLiveEvidencePath],
    ["cipher.form-note", "Secure Note", g2SecureNoteLiveEvidencePath],
  ] as const).map(([id, type, liveEvidencePath]) => m9PersonalCipherEntry(
    id,
    type === "Secure Note" ? "note" : type.toLowerCase() as "card" | "identity",
    "form",
    liveEvidencePath,
  )),
  ...["cipher.form-validation", "cipher.form-preservation", "cipher.form-races"].map(
    (id) => m78LoginEntry(
      id,
      m78FormRoutes,
      m78FormModules,
      m78FormSources,
      m78FormTests,
      m78LoginReleaseGaps,
    ),
  ),
] as const;

const m56VaultMainEntries = [
  m56VaultEntry(
    "vault.header",
    [
      "apps/menubar-tauri/src/app/vault/vault-list-page.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/services/vault-popup-items.service.ts",
    ],
    [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/vault-header/vault-header.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/vault-header/vault-header.component.html",
    ],
    [
      "apps/menubar-tauri/src/app/vault/vault-list-page.component.spec.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/vault-main-overlay.guard.spec.ts",
    ],
  ),
  m56VaultEntry(
    "vault.new-menu",
    [
      "apps/menubar-tauri/src/app/popup-header-actions.component.ts",
      "apps/menubar-tauri/src/app/vault/retained-new-item-dropdown.component.ts",
      "apps/menubar-tauri/src/app/vault/retained-restricted-item-types.service.ts",
    ],
    [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/new-item-dropdown/new-item-dropdown.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/new-item-dropdown/new-item-dropdown.component.html",
    ],
    [
      "apps/menubar-tauri/src/app/popup-header-actions.component.spec.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/new-item-dropdown-overlay.guard.spec.ts",
    ],
  ),
  m56VaultEntry(
    "vault.search",
    [
      "apps/menubar-tauri/src/app/vault/vault-list-page.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/services/vault-popup-items.service.ts",
    ],
    [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/vault-search/vault-search.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/vault-search/vault-search.component.html",
    ],
    ["apps/menubar-tauri/src/app/vault/vault-list-page.component.spec.ts"],
  ),
  m56VaultEntry(
    "vault.filters",
    [
      "apps/menubar-tauri/src/app/vault/vault-list-page.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/services/vault-popup-list-filters.service.ts",
    ],
    [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/vault-list-filters/vault-list-filters.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/vault-list-filters/vault-list-filters.component.html",
    ],
    ["apps/menubar-tauri/src/app/vault/vault-list-page.component.spec.ts"],
  ),
  m56VaultEntry(
    "vault.sections",
    [
      "apps/menubar-tauri/src/app/vault/vault-list-page.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/vault-list-items-container.component.ts",
    ],
    [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/vault-list-items-container/vault-list-items-container.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/vault-list-items-container/vault-list-items-container.component.html",
    ],
    [
      "apps/menubar-tauri/src/app/vault/vault-list-page.component.spec.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-overlay.guard.spec.ts",
    ],
  ),
  m56VaultEntry(
    "vault.row",
    [
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.ts",
      "apps/menubar-tauri/src/app/vault/popup-cipher-view.adapter.ts",
      "apps/menubar-tauri/src/app/vault/vault-item-icon.component.ts",
    ],
    [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/vault-list-items-container/vault-list-items-container.component.html",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/views/popup-cipher.view.ts",
      "vendor/bitwarden-clients/libs/angular/src/vault/components/icon.component.ts",
      "vendor/bitwarden-clients/libs/angular/src/vault/components/icon.component.html",
    ],
    [
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.spec.ts",
      "apps/menubar-tauri/src/app/vault/popup-cipher-view.adapter.spec.ts",
    ],
  ),
  m56VaultEntry(
    "vault.row-copy",
    [
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.ts",
      "apps/menubar-tauri/src/app/vault/vault-row-actions.adapter.ts",
    ],
    [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/item-copy-action/item-copy-actions.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/item-copy-action/item-copy-actions.component.html",
      "vendor/bitwarden-clients/libs/vault/src/components/item-copy-actions/item-copy-actions.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/components/item-copy-actions/item-copy-actions.component.html",
    ],
    [
      "apps/menubar-tauri/src/app/vault/vault-row-actions.adapter.spec.ts",
      "apps/menubar-tauri/src/app/vault/vault-actions.service.spec.ts",
    ],
  ),
  m56VaultEntry(
    "vault.row-menu",
    [
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/item-more-options.component.ts",
      "apps/menubar-tauri/src/app/vault/vault-row-actions.adapter.ts",
    ],
    [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/item-more-options/item-more-options.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/item-more-options/item-more-options.component.html",
    ],
    [
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.spec.ts",
      "apps/menubar-tauri/src/app/vault/vault-row-actions.adapter.spec.ts",
    ],
  ),
  m56VaultEntry(
    "vault.loading",
    [
      "apps/menubar-tauri/src/app/vault/vault-list-page.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/vault-loading-skeleton/vault-loading-skeleton.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/vault-fade-in-out-skeleton/vault-fade-in-out-skeleton.component.ts",
    ],
    [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault-loading-skeleton/vault-loading-skeleton.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault-loading-skeleton/vault-loading-skeleton.component.html",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault-fade-in-out-skeleton/vault-fade-in-out-skeleton.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault-fade-in-out-skeleton/vault-fade-in-out-skeleton.component.html",
    ],
    ["apps/menubar-tauri/src/app/vault/vault-list-page.component.spec.ts"],
  ),
  m56VaultEntry(
    "vault.empty",
    ["apps/menubar-tauri/src/app/vault/vault-list-page.component.ts"],
    [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/vault.component.html",
      "vendor/bitwarden-clients/libs/components/src/no-items/no-items.component.ts",
    ],
    ["apps/menubar-tauri/src/app/vault/vault-list-page.component.spec.ts"],
  ),
  m56VaultEntry(
    "vault.no-results",
    ["apps/menubar-tauri/src/app/vault/vault-list-page.component.ts"],
    [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/vault.component.html",
      "vendor/bitwarden-clients/libs/components/src/no-items/no-items.component.ts",
    ],
    ["apps/menubar-tauri/src/app/vault/vault-list-page.component.spec.ts"],
  ),
  m56VaultEntry(
    "vault.offline-error",
    [
      "apps/menubar-tauri/src/app/vault/vault-list-page.component.ts",
      "apps/menubar-tauri/src/app/vault/vault-row-actions.adapter.ts",
      "apps/menubar-tauri/src/app/popup-state.ts",
    ],
    [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/services/vault-popup-loading.service.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/vault.component.html",
    ],
    [
      "apps/menubar-tauri/src/app/vault/vault-list-page.component.spec.ts",
      "apps/menubar-tauri/src/app/vault/vault-row-actions.adapter.spec.ts",
    ],
  ),
] as const;

const popupParityEntries = [
  incompleteEntry(
    "auth.startup",
    ["root redirect"],
    "required-native",
    "partial",
    {
      localRoutes: ["/"],
      localModules: [
        "apps/menubar-tauri/src/app/auth/auth.facade.ts",
        "apps/menubar-tauri/src/app/app.component.ts",
        "apps/menubar-tauri/src/app/app.routes.ts",
      ],
      upstreamSources: [
        "vendor/bitwarden-clients/apps/browser/src/popup/app-routing.module.ts",
        "vendor/bitwarden-clients/libs/angular/src/auth/guards/redirect/redirect.guard.ts",
        "vendor/bitwarden-clients/apps/browser/src/platform/popup/components/popup-focus-wrap.directive.ts",
      ],
      tests: [
        "apps/menubar-tauri/src/app/auth/auth.facade.spec.ts",
        "apps/menubar-tauri/src/app/app.component.spec.ts",
      ],
      evidence: [
        {
          gate: "visual",
          path: "docs/superpowers/screenshots/standard-auth-server-matrix-2026-07-11",
          surfaceIds: ["auth.startup"],
        },
        {
          gate: "audit",
          path: "docs/superpowers/specs/2026-07-10-popup-completeness-audit.md",
          surfaceIds: ["auth.startup"],
        },
      ],
    },
    undefined,
    [
      "Credentialed startup-restore results for Bitwarden US and EU remain open because cloud credentials were not supplied.",
      "Cross-account active-account restoration remains unrun because second-account credentials were not supplied.",
      "Task 8 did not exercise deterministic or credentialed startup restore or relaunch behavior.",
      "Current-head native startup and Keychain lifecycle evidence is not available.",
    ],
  ),
  incompleteEntry(
    "auth.login-email",
    ["/login"],
    "required-native",
    "partial",
    {
      localRoutes: ["/login"],
      localModules: [
        "apps/menubar-tauri/src/app/auth/login-page.component.ts",
        "apps/menubar-tauri/src/app/auth/official-password-auth.adapter.ts",
        "apps/menubar-tauri/src/app/auth/official-environment.adapter.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/auth/anonymous/official-anonymous-shell.component.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/auth/environment/official-environment-selector.component.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/auth/environment/official-self-hosted-dialog.component.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/auth/login/official-password-login.component.ts",
      ],
      upstreamSources: [
        "vendor/bitwarden-clients/libs/auth/src/angular/login/login.component.ts",
        "vendor/bitwarden-clients/libs/auth/src/angular/login/login.component.html",
        "vendor/bitwarden-clients/libs/auth/src/angular/login/login-component.service.ts",
        "vendor/bitwarden-clients/apps/browser/src/popup/components/extension-anon-layout-wrapper/extension-anon-layout-wrapper.component.ts",
        "vendor/bitwarden-clients/apps/browser/src/popup/components/extension-anon-layout-wrapper/extension-anon-layout-wrapper.component.html",
        "vendor/bitwarden-clients/libs/angular/src/auth/environment-selector/environment-selector.component.ts",
        "vendor/bitwarden-clients/libs/angular/src/auth/environment-selector/environment-selector.component.html",
        "vendor/bitwarden-clients/libs/angular/src/auth/self-hosted-env-config-dialog/self-hosted-env-config-dialog.component.ts",
        "vendor/bitwarden-clients/libs/angular/src/auth/self-hosted-env-config-dialog/self-hosted-env-config-dialog.component.html",
      ],
      tests: [
        "apps/menubar-tauri/src/app/auth/login-page.component.spec.ts",
        "apps/menubar-tauri/src/app/auth/official-password-auth.adapter.spec.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/auth/login/auth-login-overlay.guard.spec.ts",
        "apps/menubar-tauri/src/app/auth/login-environment-selector.component.spec.ts",
        "apps/menubar-tauri/src/app/auth/official-environment.adapter.spec.ts",
        "apps/menubar-tauri/src/app/auth/auth.facade.spec.ts",
        "apps/menubar-tauri/src/app/auth/standard-server-matrix.spec.ts",
        "apps/menubar-tauri/src/auth/live-standard-password-login.spec.ts",
        m34AuthLiveTest,
        ...m34AuthTests,
      ],
      evidence: [
        {
          gate: "visual",
          path: "docs/superpowers/screenshots/standard-auth-server-matrix-2026-07-11",
          surfaceIds: ["auth.login-email"],
        },
        {
          gate: "audit",
          path: "docs/superpowers/specs/2026-07-10-popup-completeness-audit.md",
          surfaceIds: ["auth.login-email"],
        },
        ...m34AuthEvidence("auth.login-email"),
      ],
    },
    undefined,
    [
      "Credentialed Bitwarden US and EU password login/sync remains open because cloud credentials were not supplied.",
      "Credentialed Argon2id cloud and self-hosted password login/sync remains open because explicit Argon2id account credentials were not supplied.",
      "Credentialed password-auth failure and failed-initial-sync cleanup outcomes remain unrun.",
      "Native Tauri/Keychain login and session lifecycle evidence remains unproved by the Node/Playwright live result.",
    ],
  ),
  incompleteEntry(
    "auth.login-password",
    ["/login"],
    "required-native",
    "partial",
    {
      localRoutes: ["/login"],
      localModules: [
        "apps/menubar-tauri/src/app/auth/official-password-auth.adapter.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/auth/login/official-password-login.component.ts",
      ],
      upstreamSources: [
        "vendor/bitwarden-clients/libs/auth/src/angular/login/login.component.ts",
        "vendor/bitwarden-clients/libs/auth/src/angular/login/login.component.html",
        "vendor/bitwarden-clients/libs/auth/src/angular/login/login-component.service.ts",
      ],
      tests: [
        "apps/menubar-tauri/src/app/auth/official-password-auth.adapter.spec.ts",
        "apps/menubar-tauri/src/app/auth/auth.facade.spec.ts",
        "apps/menubar-tauri/src/auth/live-standard-password-login.spec.ts",
        m34AuthLiveTest,
        ...m34AuthTests,
      ],
      evidence: [
        ...m34AuthEvidence("auth.login-password"),
      ],
    },
    undefined,
    [
      "Credentialed Bitwarden US and EU password login/sync was not run because cloud credentials were not supplied.",
      "Explicit Argon2id credentialed coverage remains open because no such account was supplied.",
      "Native Tauri/Keychain login and session lifecycle evidence remains unproved by the Node/Playwright live result.",
    ],
  ),
  incompleteEntry(
    "auth.environment",
    ["/login"],
    "required-native",
    "partial",
    {
      localRoutes: ["/login"],
      localModules: [
        "apps/menubar-tauri/src/app/auth/official-environment.adapter.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/auth/environment/official-environment-selector.component.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/auth/environment/official-self-hosted-dialog.component.ts",
      ],
      upstreamSources: [
        "vendor/bitwarden-clients/libs/angular/src/auth/environment-selector/environment-selector.component.ts",
        "vendor/bitwarden-clients/libs/angular/src/auth/environment-selector/environment-selector.component.html",
        "vendor/bitwarden-clients/libs/angular/src/auth/self-hosted-env-config-dialog/self-hosted-env-config-dialog.component.ts",
        "vendor/bitwarden-clients/libs/angular/src/auth/self-hosted-env-config-dialog/self-hosted-env-config-dialog.component.html",
      ],
      tests: [
        "apps/menubar-tauri/src/app/auth/login-environment-selector.component.spec.ts",
        "apps/menubar-tauri/src/app/auth/official-environment.adapter.spec.ts",
        "apps/menubar-tauri/src/app/auth/standard-server-matrix.spec.ts",
        m34AuthLiveTest,
        ...m34AuthTests,
      ],
      evidence: [
        ...m34AuthEvidence("auth.environment"),
      ],
    },
    undefined,
    [
      "US and EU endpoint construction passed deterministically, but credentialed cloud login was not run.",
      "Custom self-hosted rejection and alternate-path credentialed coverage remain limited to deterministic contracts.",
      "Native Tauri/Keychain login and session lifecycle evidence remains unproved by the Node/Playwright live result.",
    ],
  ),
  incompleteEntry(
    "auth.lock",
    ["/lock"],
    "required-native",
    "partial",
    {
      localRoutes: ["/lock"],
      localModules: [
        "apps/menubar-tauri/src/app/auth/lock-page.component.ts",
        "apps/menubar-tauri/src/app/auth/official-master-password-unlock.adapter.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/auth/lock/official-lock.component.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/auth/lock/official-master-password-lock.component.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/auth/lock/official-master-password-lock.transform-manifest.json",
        "apps/menubar-tauri/src/app/auth/runtime-pin-vault.ts",
        "apps/menubar-tauri/src/app/auth/unlock-methods.service.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/auth/lock/official-pin-lock.component.ts",
        "apps/menubar-tauri/src/host/biometric-host.ts",
      ],
      upstreamSources: [
        "vendor/bitwarden-clients/libs/key-management-ui/src/lock/components/lock.component.ts",
        "vendor/bitwarden-clients/libs/key-management-ui/src/lock/components/lock.component.html",
        "vendor/bitwarden-clients/libs/key-management-ui/src/lock/components/master-password-lock/master-password-lock.component.ts",
        "vendor/bitwarden-clients/libs/key-management-ui/src/lock/components/master-password-lock/master-password-lock.component.html",
      ],
      tests: [
        "apps/menubar-tauri/src/app/auth/lock-page.component.spec.ts",
        "apps/menubar-tauri/src/app/auth/official-master-password-unlock.adapter.spec.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/auth/lock/auth-lock-overlay.guard.spec.ts",
        "apps/menubar-tauri/src/app/auth/auth.facade.spec.ts",
        "apps/menubar-tauri/src/app/app.component.spec.ts",
        "apps/menubar-tauri/src/app/auth/runtime-pin-vault.spec.ts",
        "apps/menubar-tauri/src/app/auth/unlock-methods.service.spec.ts",
        alternativeUnlockRuntimeTest,
        ...m34AuthTests,
      ],
      evidence: [
        {
          gate: "visual",
          path: "docs/superpowers/screenshots/standard-auth-server-matrix-2026-07-11",
          surfaceIds: ["auth.lock"],
        },
        {
          gate: "audit",
          path: "docs/superpowers/specs/2026-07-10-popup-completeness-audit.md",
          surfaceIds: ["auth.lock"],
        },
        ...m34AuthEvidence("auth.lock"),
        ...m15NativeAuditEvidence("auth.lock"),
      ],
    },
    undefined,
    [
      "Credentialed locked-session unlock outcomes for Bitwarden US and EU remain open because cloud credentials were not supplied.",
      "Current-bundle logout remains unrun pending action-time confirmation because it deletes the local Keychain account.",
      "Current-head native locked-session unlock and Keychain lifecycle evidence is not available.",
      ...alternativeUnlockRemainingGaps,
    ],
  ),
  incompleteEntry(
    "auth.two-factor-select",
    ["/2fa"],
    "required-native",
    "partial",
    {
      localRoutes: ["/2fa"],
      localModules: ["apps/menubar-tauri/src/app/auth/two-factor-page.component.ts"],
      upstreamSources: [
        "vendor/bitwarden-clients/apps/browser/src/auth/services/extension-two-factor-auth-component.service.ts",
        "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/two-factor-auth.component.ts",
        "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/two-factor-auth.component.html",
        "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/two-factor-options.component.ts",
        "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/two-factor-options.component.html",
      ],
      tests: [
        "apps/menubar-tauri/src/app/auth/auth.facade.spec.ts",
        "apps/menubar-tauri/src/app/auth/auth-challenge-pages.spec.ts",
        "apps/menubar-tauri/src/app/auth/standard-server-matrix.spec.ts",
        ...m34AuthTests,
      ],
      evidence: [
        {
          gate: "visual",
          path: "docs/superpowers/screenshots/standard-auth-server-matrix-2026-07-11",
          surfaceIds: ["auth.two-factor-select"],
        },
        {
          gate: "audit",
          path: "docs/superpowers/specs/2026-07-10-popup-completeness-audit.md",
          surfaceIds: ["auth.two-factor-select"],
        },
        ...m34AuthEvidence("auth.two-factor-select"),
      ],
    },
    undefined,
    [
      "Live provider-0 and provider-1 challenge success, failure, and cancel/back flows remain unrun because challenge credentials were not supplied.",
      "Current-bundle Keychain behavior for incomplete two-factor challenges remains unverified.",
    ],
  ),
  incompleteEntry(
    "auth.two-factor-code",
    ["/2fa"],
    "required-native",
    "partial",
    {
      localRoutes: ["/2fa"],
      localModules: [
        "apps/menubar-tauri/src/app/auth/two-factor-page.component.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/auth/two-factor/official-two-factor.component.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/auth/two-factor/official-two-factor-authenticator.component.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/auth/two-factor/official-two-factor-email.component.ts",
      ],
      upstreamSources: [
        "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/two-factor-auth.component.ts",
        "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/two-factor-auth.component.html",
        "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/child-components/two-factor-auth-authenticator/two-factor-auth-authenticator.component.ts",
        "vendor/bitwarden-clients/libs/auth/src/angular/two-factor-auth/child-components/two-factor-auth-email/two-factor-auth-email.component.ts",
      ],
      tests: [
        "apps/menubar-tauri/src/app/auth/auth.facade.spec.ts",
        "apps/menubar-tauri/src/app/auth/auth-challenge-pages.spec.ts",
        ...m34AuthTests,
      ],
      evidence: m34AuthEvidence("auth.two-factor-code"),
    },
    undefined,
    [
      "Credentialed provider-0 and provider-1 success, resend, failure, timeout, and cancel flows were not run because challenge credentials were not supplied.",
      "Incomplete-challenge Keychain behavior remains unverified in a credentialed native run.",
    ],
  ),
  incompleteEntry(
    "auth.new-device",
    ["/new-device-verification"],
    "required-native",
    "partial",
    {
      localRoutes: ["/new-device-verification"],
      localModules: [
        "apps/menubar-tauri/src/app/auth/new-device-verification-page.component.ts",
        "apps/menubar-tauri/src/app/auth/official-new-device.adapter.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/auth/new-device/official-new-device-verification.component.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/auth/new-device/official-new-device-verification.transform-manifest.json",
      ],
      upstreamSources: [
        "vendor/bitwarden-clients/apps/browser/src/auth/services/new-device-verification/extension-new-device-verification-component.service.ts",
        "vendor/bitwarden-clients/libs/auth/src/angular/new-device-verification/new-device-verification.component.ts",
        "vendor/bitwarden-clients/libs/auth/src/angular/new-device-verification/new-device-verification.component.html",
      ],
      tests: [
        "apps/menubar-tauri/src/app/auth/auth.facade.spec.ts",
        "apps/menubar-tauri/src/app/auth/auth-challenge-pages.spec.ts",
        "apps/menubar-tauri/src/app/auth/official-new-device.adapter.spec.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/auth/new-device/auth-new-device-overlay.guard.spec.ts",
        ...m34AuthTests,
      ],
      evidence: [
        {
          gate: "visual",
          path: "docs/superpowers/screenshots/standard-auth-server-matrix-2026-07-11",
          surfaceIds: ["auth.new-device"],
        },
        {
          gate: "audit",
          path: "docs/superpowers/specs/2026-07-10-popup-completeness-audit.md",
          surfaceIds: ["auth.new-device"],
        },
        ...m34AuthEvidence("auth.new-device"),
      ],
    },
    undefined,
    [
      "Live new-device email-OTP success, failure, and cancel/back flows remain unrun because challenge credentials were not supplied.",
      "Current-bundle Keychain behavior for incomplete new-device verification remains unverified.",
    ],
  ),
  incompleteEntry(
    "auth.password-hint",
    ["/hint"],
    "required-native",
    "partial",
    {
      localRoutes: ["/hint"],
      localModules: [
        "apps/menubar-tauri/src/app/auth/password-hint-page.component.ts",
        "apps/menubar-tauri/src/app/auth/official-password-hint-api.adapter.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/auth/login/official-password-hint.component.ts",
      ],
      upstreamSources: [
        "vendor/bitwarden-clients/libs/auth/src/angular/password-hint/password-hint.component.ts",
        "vendor/bitwarden-clients/libs/auth/src/angular/password-hint/password-hint.component.html",
      ],
      tests: [
        "apps/menubar-tauri/src/app/auth/password-hint-page.component.spec.ts",
        "apps/menubar-tauri/src/app/auth/official-password-hint-api.adapter.spec.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/auth/login/auth-login-overlay.guard.spec.ts",
        "apps/menubar-tauri/src/app/auth/auth-challenge-pages.spec.ts",
        "apps/menubar-tauri/src/app/auth/standard-server-matrix.spec.ts",
        ...m34AuthTests,
      ],
      evidence: m34AuthEvidence("auth.password-hint"),
    },
    undefined,
    [
      "Current-bundle 480x600 source comparison for the password-hint request flow remains unrun.",
      "Credentialed password-hint delivery remains unrun for Bitwarden US, EU, and self-hosted accounts.",
      "Current-bundle Keychain behavior for password-hint requests remains unverified.",
    ],
  ),
  incompleteEntry(
    "auth.account-menu",
    ["current route header"],
    "required-native",
    "partial",
    {
      localRoutes: ["/tabs/vault", "/account-switcher"],
      localModules: [
        "apps/menubar-tauri/src/app/popup-header-actions.component.ts",
        "apps/menubar-tauri/src/app/auth/official-account-switcher.adapter.ts",
      ],
      upstreamSources: [
        "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/current-account.component.ts",
        "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/current-account.component.html",
      ],
      tests: [
        "apps/menubar-tauri/src/app/popup-header-actions.component.spec.ts",
        "apps/menubar-tauri/src/app/auth/official-account-switcher.adapter.spec.ts",
        "apps/menubar-tauri/src/app/app.component.spec.ts",
        ...m34AuthTests,
      ],
      evidence: m34AuthEvidence("auth.account-menu"),
    },
    undefined,
    [
      "A credentialed second-account native run was not available to prove current-account changes across routes.",
      "Destructive current-account logout remains unrun.",
    ],
  ),
  incompleteEntry(
    "auth.account-switch",
    ["/account-switcher"],
    "required-native",
    "partial",
    {
      localRoutes: ["/account-switcher"],
      localModules: [
        "apps/menubar-tauri/src/app/auth/official-account-switcher.adapter.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/official-account-switcher.component.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/official-account.component.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/official-account-switcher.transform-manifest.json",
        "apps/menubar-tauri/src/app/popup-header-actions.component.ts",
      ],
      upstreamSources: [
        "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/account-switcher.component.ts",
        "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/account-switcher.component.html",
        "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/account.component.ts",
        "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/account.component.html",
        "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/current-account.component.ts",
        "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/current-account.component.html",
        "vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/services/account-switcher.service.ts",
      ],
      tests: [
        "apps/menubar-tauri/src/app/auth/auth.facade.spec.ts",
        "apps/menubar-tauri/src/app/auth/official-account-switcher.adapter.spec.ts",
        "apps/menubar-tauri/src/app/settings/account-actions-page.component.spec.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/auth-account-switching-overlay.guard.spec.ts",
        "apps/menubar-tauri/src/app/app.component.spec.ts",
        "apps/menubar-tauri/e2e/generator-account-settings.spec.ts",
        ...m34AuthTests,
      ],
      evidence: [
        { gate: "visual", path: g3VisualEvidencePath, surfaceIds: ["auth.account-switch"] },
        { gate: "audit", path: g3AuditEvidencePath, surfaceIds: ["auth.account-switch"] },
        ...m34AuthEvidence("auth.account-switch"),
      ],
    },
    undefined,
    [
      "Cross-account switching and restore remain unrun because second-account credentials were not supplied.",
      "Current-bundle logout remains unrun pending action-time confirmation because it deletes the local Keychain account.",
    ],
  ),
  incompleteEntry(
    "auth.offline-restore",
    ["startup restore", "/lock", "/tabs/vault"],
    "required-native",
    "partial",
    {
      localRoutes: ["/", "/lock", "/tabs/vault"],
      localModules: [
        "apps/menubar-tauri/src/app/auth/auth.facade.ts",
        "apps/menubar-tauri/src/auth/account-session-store.ts",
        "apps/menubar-tauri/src/app/app.component.ts",
      ],
      upstreamSources: [
        "vendor/bitwarden-clients/apps/browser/src/popup/app-routing.module.ts",
        "vendor/bitwarden-clients/libs/angular/src/auth/guards/redirect/redirect.guard.ts",
      ],
      tests: [
        "apps/menubar-tauri/src/app/auth/auth.facade.spec.ts",
        "apps/menubar-tauri/src/auth/account-session-store.spec.ts",
        "apps/menubar-tauri/src/app/app.component.spec.ts",
      ],
      evidence: [],
    },
    undefined,
    [
      "Credentialed US/EU locked and unlocked relaunch was not run because cloud credentials were not supplied.",
      "Cross-account restore remains unrun because second-account credentials were not supplied.",
      "Credentialed self-hosted login/sync passed, but self-hosted locked and unlocked relaunch was not run.",
      "Task 8's deterministic offline state is a two-factor transport error and is not offline-restore evidence.",
    ],
  ),

  ...m56VaultMainEntries,
  ...m78CipherEntries.slice(0, 10),
  incompleteEntry("vault.new-item", ["/new-item"], "required-native", "partial", {
    localRoutes: ["/new-item"],
    localModules: [
      "apps/menubar-tauri/src/app/vault/new-item-page.component.ts",
      "apps/menubar-tauri/src/app/vault/vault-folder-dialog.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/recovery/folders/official-add-edit-folder-dialog.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/recovery/official-recovery.transform-manifest.json",
    ],
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
    tests: [
      "apps/menubar-tauri/src/app/app.routes.spec.ts",
      "apps/menubar-tauri/src/app/vault/new-item-page.component.spec.ts",
    ],
  }, undefined, [
    "Route-specific visual/native/audit evidence for the current Tauri new-item bundle is still missing.",
  ]),
  ...m78CipherEntries.slice(10),
  entry({
    id: "vault.password-history",
    officialRoutes: ["/cipher-password-history"],
    classification: "required-native",
    status: "partial",
    localRoutes: ["/cipher-password-history"],
    localModules: [
      "apps/menubar-tauri/src/app/vault/vault-password-history-page.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/recovery/password-history/official-password-history-view.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/recovery/official-recovery.transform-manifest.json",
    ],
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/vault-password-history/vault-password-history.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/components/vault/vault-password-history/vault-password-history.component.html",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/services/browser-view-password-history.service.ts",
      "vendor/bitwarden-clients/libs/vault/src/components/password-history-view/password-history-view.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/components/password-history-view/password-history-view.component.html",
    ],
    tests: [
      "apps/menubar-tauri/src/app/app.routes.spec.ts",
      "apps/menubar-tauri/src/app/vault/vault-password-history-page.component.spec.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/recovery/password-history/official-password-history-view.component.spec.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/recovery/recovery-overlay.guard.spec.ts",
      "apps/menubar-tauri/e2e/vault-login-workflow.spec.ts",
      m10RecoveryRuntimeTest,
    ],
    evidence: [
      { gate: "visual", path: g2OrganizationVisualEvidencePath, surfaceIds: ["vault.password-history"] },
      { gate: "native", path: g2OrganizationNativeEvidencePath, surfaceIds: ["vault.password-history"] },
      { gate: "audit", path: g2OrganizationAuditEvidencePath, surfaceIds: ["vault.password-history"] },
      { gate: "audit", path: g2LoginLiveEvidencePath, surfaceIds: ["vault.password-history"] },
      { gate: "visual", path: m10RecoveryVisualEvidencePath, surfaceIds: ["vault.password-history"] },
      { gate: "audit", path: m10RecoveryAuditEvidencePath, surfaceIds: ["vault.password-history"] },
    ],
    remainingGaps: [
      "M14 credentialed recovery proof remains open.",
      "M15 native recovery evidence remains open.",
      "M16 release comparison and audit closure remain open.",
    ],
  }),
  entry({
    id: "vault.folders",
    officialRoutes: ["/folders"],
    classification: "required-native",
    status: "partial",
    localRoutes: ["/folders"],
    localModules: [
      "apps/menubar-tauri/src/app/vault/folders-page.component.ts",
      "apps/menubar-tauri/src/app/vault/vault-folder-dialog.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/recovery/folders/official-folders.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/recovery/folders/official-add-edit-folder-dialog.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/recovery/official-recovery.transform-manifest.json",
    ],
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/folders.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/folders.component.html",
      "vendor/bitwarden-clients/libs/vault/src/components/add-edit-folder-dialog/add-edit-folder-dialog.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/components/add-edit-folder-dialog/add-edit-folder-dialog.component.html",
    ],
    tests: [
      "apps/menubar-tauri/src/app/vault/folders-page.component.spec.ts",
      "apps/menubar-tauri/src/app/vault/vault-folder-dialog.component.spec.ts",
      "apps/menubar-tauri/src/app/vault/vault-folder.service.spec.ts",
      "apps/menubar-tauri/src/app/vault/new-item-page.component.spec.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/recovery/folders/official-folders.component.spec.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/recovery/folders/official-add-edit-folder-dialog.component.spec.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/recovery/recovery-overlay.guard.spec.ts",
      "apps/menubar-tauri/src/auth/live-standard-password-login.spec.ts",
      "apps/menubar-tauri/e2e/vault-folders.spec.ts",
      m10RecoveryRuntimeTest,
    ],
    evidence: [
      { gate: "visual", path: g2OrganizationVisualEvidencePath, surfaceIds: ["vault.folders"] },
      { gate: "native", path: g2OrganizationNativeEvidencePath, surfaceIds: ["vault.folders"] },
      { gate: "audit", path: g2OrganizationAuditEvidencePath, surfaceIds: ["vault.folders"] },
      { gate: "audit", path: g2FolderLiveEvidencePath, surfaceIds: ["vault.folders"] },
      { gate: "visual", path: m10RecoveryVisualEvidencePath, surfaceIds: ["vault.folders"] },
      { gate: "audit", path: m10RecoveryAuditEvidencePath, surfaceIds: ["vault.folders"] },
    ],
    remainingGaps: [
      "M14 credentialed recovery proof remains open.",
      "M15 native recovery evidence remains open.",
      "M16 release comparison and audit closure remain open.",
    ],
  }),
  entry({
    id: "vault.archive",
    officialRoutes: ["/archive"],
    classification: "required-native",
    status: "partial",
    localRoutes: ["/archive"],
    localModules: [
      "apps/menubar-tauri/src/app/vault/archive-page.component.ts",
      "apps/menubar-tauri/src/app/vault/recovery-page-actions.adapter.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/recovery/archive/official-archive.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/recovery/official-recovery.transform-manifest.json",
    ],
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/archive.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/archive.component.html",
      "vendor/bitwarden-clients/libs/vault/src/services/archive-cipher-utilities.service.ts",
    ],
    tests: [
      "apps/menubar-tauri/src/app/vault/archive-trash-page.component.spec.ts",
      "apps/menubar-tauri/src/app/vault/recovery-page-actions.adapter.spec.ts",
      "apps/menubar-tauri/src/app/vault/vault-actions.service.spec.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/recovery/archive/official-archive.component.spec.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/recovery/recovery-overlay.guard.spec.ts",
      "apps/menubar-tauri/src/auth/live-standard-password-login.spec.ts",
      "apps/menubar-tauri/e2e/vault-login-workflow.spec.ts",
      "apps/menubar-tauri/e2e/vault-personal-cipher-workflows.spec.ts",
      m10RecoveryRuntimeTest,
    ],
    evidence: [
      { gate: "visual", path: g2OrganizationVisualEvidencePath, surfaceIds: ["vault.archive"] },
      { gate: "native", path: g2OrganizationNativeEvidencePath, surfaceIds: ["vault.archive"] },
      { gate: "audit", path: g2OrganizationAuditEvidencePath, surfaceIds: ["vault.archive"] },
      { gate: "audit", path: g2LoginLiveEvidencePath, surfaceIds: ["vault.archive"] },
      { gate: "audit", path: g2CardLiveEvidencePath, surfaceIds: ["vault.archive"] },
      { gate: "audit", path: g2IdentityLiveEvidencePath, surfaceIds: ["vault.archive"] },
      { gate: "audit", path: g2SecureNoteLiveEvidencePath, surfaceIds: ["vault.archive"] },
      { gate: "visual", path: m10RecoveryVisualEvidencePath, surfaceIds: ["vault.archive"] },
      { gate: "audit", path: m10RecoveryAuditEvidencePath, surfaceIds: ["vault.archive"] },
    ],
    remainingGaps: [
      "M14 credentialed recovery proof remains open.",
      "M15 native recovery evidence remains open.",
      "M16 release comparison and audit closure remain open.",
    ],
  }),
  entry({
    id: "vault.trash",
    officialRoutes: ["/trash"],
    classification: "required-native",
    status: "partial",
    localRoutes: ["/trash"],
    localModules: [
      "apps/menubar-tauri/src/app/vault/trash-page.component.ts",
      "apps/menubar-tauri/src/app/vault/recovery-page-actions.adapter.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/recovery/trash/official-trash.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/recovery/trash/official-trash-list-items-container.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/recovery/official-recovery.transform-manifest.json",
    ],
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/trash.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/trash.component.html",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/trash-list-items-container/trash-list-items-container.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/trash-list-items-container/trash-list-items-container.component.html",
    ],
    tests: [
      "apps/menubar-tauri/src/app/vault/archive-trash-page.component.spec.ts",
      "apps/menubar-tauri/src/app/vault/recovery-page-actions.adapter.spec.ts",
      "apps/menubar-tauri/src/app/vault/vault-actions.service.spec.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/recovery/trash/official-trash.component.spec.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/recovery/trash/official-trash-list-items-container.component.spec.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/recovery/recovery-overlay.guard.spec.ts",
      "apps/menubar-tauri/src/auth/live-standard-password-login.spec.ts",
      "apps/menubar-tauri/e2e/vault-login-workflow.spec.ts",
      "apps/menubar-tauri/e2e/vault-personal-cipher-workflows.spec.ts",
      m10RecoveryRuntimeTest,
    ],
    evidence: [
      { gate: "visual", path: g2OrganizationVisualEvidencePath, surfaceIds: ["vault.trash"] },
      { gate: "native", path: g2OrganizationNativeEvidencePath, surfaceIds: ["vault.trash"] },
      { gate: "audit", path: g2OrganizationAuditEvidencePath, surfaceIds: ["vault.trash"] },
      { gate: "audit", path: g2LoginLiveEvidencePath, surfaceIds: ["vault.trash"] },
      { gate: "audit", path: g2CardLiveEvidencePath, surfaceIds: ["vault.trash"] },
      { gate: "audit", path: g2IdentityLiveEvidencePath, surfaceIds: ["vault.trash"] },
      { gate: "audit", path: g2SecureNoteLiveEvidencePath, surfaceIds: ["vault.trash"] },
      { gate: "visual", path: m10RecoveryVisualEvidencePath, surfaceIds: ["vault.trash"] },
      { gate: "audit", path: m10RecoveryAuditEvidencePath, surfaceIds: ["vault.trash"] },
    ],
    remainingGaps: [
      "M14 credentialed recovery proof remains open.",
      "M15 native recovery evidence remains open.",
      "M16 release comparison and audit closure remain open.",
    ],
  }),

  incompleteEntry(
    "generator.main",
    ["/tabs/generator", "/generator"],
    "required-native",
    "partial",
    {
      localRoutes: ["/tabs/generator"],
      localModules: [
        "apps/menubar-tauri/src/app/generator/generator-page.component.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/generator/official-credential-generator.component.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-core.component.ts",
        "vendor/bitwarden-clients/libs/tools/generator/components/src/password-settings.component.ts",
        "vendor/bitwarden-clients/libs/tools/generator/components/src/passphrase-settings.component.ts",
        "vendor/bitwarden-clients/libs/tools/generator/components/src/username-settings.component.ts",
        "vendor/bitwarden-clients/libs/tools/generator/components/src/subaddress-settings.component.ts",
        "vendor/bitwarden-clients/libs/tools/generator/components/src/catchall-settings.component.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator.transform-manifest.json",
      ],
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
      tests: [
        "apps/menubar-tauri/src/app/generator/generator-page.component.spec.ts",
        "apps/menubar-tauri/src/app/generator/generator.service.spec.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/generator/generator-overlay.guard.spec.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/generator/official-credential-generator.component.spec.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/generator/official-password-settings.component.spec.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/generator/official-passphrase-settings.component.spec.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/generator/official-username-settings.component.spec.ts",
        "apps/menubar-tauri/src/app/vault/retained-login-form.adapter.spec.ts",
        m11GeneratorRuntimeTest,
      ],
      evidence: [
        { gate: "visual", path: m11GeneratorVisualEvidencePath, surfaceIds: ["generator.main"] },
        { gate: "audit", path: m11GeneratorAuditEvidencePath, surfaceIds: ["generator.main"] },
      ],
    },
    undefined,
    [
      "M14 credentialed Generator proof remains open.",
      "M15 native Generator evidence remains open.",
      "M16 release comparison and audit closure remain open.",
    ],
  ),
  incompleteEntry(
    "generator.history",
    ["/generator-history"],
    "required-native",
    "partial",
    {
      localRoutes: ["/generator-history"],
      localModules: [
        "apps/menubar-tauri/src/app/generator/generator-history-page.component.ts",
        "apps/menubar-tauri/src/app/generator/generator-history-route.owner.ts",
        "apps/menubar-tauri/src/app/generator/official-generator-history-view.adapter.ts",
        "apps/menubar-tauri/src/app/generator/generator-history.store.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-history.component.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-history-rows.component.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/generator/official-empty-generator-history.component.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator.transform-manifest.json",
      ],
      upstreamSources: [
        "vendor/bitwarden-clients/apps/browser/src/tools/popup/generator/credential-generator-history.component.ts",
        "vendor/bitwarden-clients/apps/browser/src/tools/popup/generator/credential-generator-history.component.html",
        "vendor/bitwarden-clients/libs/tools/generator/components/src/credential-generator-history.component.ts",
        "vendor/bitwarden-clients/libs/tools/generator/components/src/credential-generator-history.component.html",
        "vendor/bitwarden-clients/libs/tools/generator/components/src/empty-credential-history.component.ts",
        "vendor/bitwarden-clients/libs/tools/generator/components/src/empty-credential-history.component.html",
      ],
      tests: [
        "apps/menubar-tauri/src/app/generator/generator-history-page.component.spec.ts",
        "apps/menubar-tauri/src/app/generator/generator-history.store.spec.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-history.component.spec.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/generator/generator-overlay.guard.spec.ts",
        m11GeneratorRuntimeTest,
      ],
      evidence: [
        { gate: "visual", path: m11GeneratorVisualEvidencePath, surfaceIds: ["generator.history"] },
        { gate: "audit", path: m11GeneratorAuditEvidencePath, surfaceIds: ["generator.history"] },
      ],
    },
    undefined,
    [
      "M14 credentialed Generator history proof remains open.",
      "M15 native Generator history evidence remains open.",
      "M16 release comparison and audit closure remain open.",
    ],
  ),

  incompleteEntry("send.list", ["/tabs/send"], "required-native", "partial", {
    localRoutes: ["/tabs/send"],
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
    tests: [
      "apps/menubar-tauri/src/app/send/send-page.component.spec.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/send/send-overlay.guard.spec.ts",
      m12SendRuntimeTest,
    ],
    evidence: [
      { gate: "visual", path: m12SendVisualEvidencePath, surfaceIds: ["send.list"] },
      { gate: "audit", path: m12SendAuditEvidencePath, surfaceIds: ["send.list"] },
    ],
  }, undefined, m12SendRemainingGaps),
  incompleteEntry("send.view", ["/edit-send"], "required-native", "partial", {
    localRoutes: ["/edit-send"],
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
    tests: ["apps/menubar-tauri/src/app/send/send-page.component.spec.ts", m12SendRuntimeTest],
    evidence: [
      { gate: "visual", path: m12SendVisualEvidencePath, surfaceIds: ["send.view"] },
      { gate: "audit", path: m12SendAuditEvidencePath, surfaceIds: ["send.view"] },
    ],
  }, undefined, m12SendRemainingGaps),
  incompleteEntry("send.form", ["/add-send", "/edit-send"], "required-native", "partial", {
    localRoutes: ["/add-send", "/edit-send"],
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
    tests: [
      "apps/menubar-tauri/src/app/send/send-page.component.spec.ts",
      "apps/menubar-tauri/src/app/send/send-request.service.spec.ts",
      "apps/menubar-tauri/src/app/send/retained-text-send-form.service.spec.ts",
      m12SendRuntimeTest,
    ],
    evidence: [
      { gate: "visual", path: m12SendVisualEvidencePath, surfaceIds: ["send.form"] },
      { gate: "audit", path: m12SendAuditEvidencePath, surfaceIds: ["send.form"] },
    ],
  }, undefined, m12SendRemainingGaps),
  incompleteEntry("send.created", ["/send-created"], "required-native", "partial", {
    localRoutes: ["/send-created"],
    localModules: [
      "apps/menubar-tauri/src/app/send/send-created-page.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-created.component.ts",
    ],
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/tools/popup/send-v2/send-created/send-created.component.html",
      "vendor/bitwarden-clients/apps/browser/src/tools/popup/send-v2/send-created/send-created.component.ts",
    ],
    tests: [
      "apps/menubar-tauri/src/app/send/send-page.component.spec.ts",
      m12SendRuntimeTest,
    ],
    evidence: [
      { gate: "visual", path: m12SendVisualEvidencePath, surfaceIds: ["send.created"] },
      { gate: "audit", path: m12SendAuditEvidencePath, surfaceIds: ["send.created"] },
    ],
  }, undefined, m12SendRemainingGaps),
  incompleteEntry("send.lifecycle", ["/tabs/send", "/add-send", "/edit-send", "/send-created"], "required-native", "partial", {
    localRoutes: ["/tabs/send", "/add-send", "/edit-send", "/send-created"],
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
    tests: [
      "apps/menubar-tauri/src/app/send/text-send-operation.spec.ts",
      "apps/menubar-tauri/src/app/send/send-actions.service.spec.ts",
      "apps/menubar-tauri/src/app/send/send-request.service.spec.ts",
      m12SendRuntimeTest,
    ],
    evidence: [
      { gate: "visual", path: m12SendVisualEvidencePath, surfaceIds: ["send.lifecycle"] },
      { gate: "audit", path: m12SendAuditEvidencePath, surfaceIds: ["send.lifecycle"] },
    ],
  }, undefined, m12SendRemainingGaps),

  incompleteEntry("settings.main", ["/tabs/settings"], "required-native", "partial", {
    productionOwner: "overlay",
    localRoutes: ["/tabs/settings"],
    localModules: [
      "apps/menubar-tauri/src/app/settings/settings-page.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.component.ts",
    ],
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/tools/popup/settings/settings-v2.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/tools/popup/settings/settings-v2.component.html",
    ],
    tests: [
      "apps/menubar-tauri/src/app/settings/settings-page.component.spec.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.component.spec.ts",
      "apps/menubar-tauri/src/app/settings/settings-production-boundary.spec.ts",
      "apps/menubar-tauri/e2e/generator-account-settings.spec.ts",
      m13SettingsRuntimeTest,
    ],
    evidence: [
      { gate: "visual", path: g3VisualEvidencePath, surfaceIds: ["settings.main"] },
      { gate: "audit", path: g3AuditEvidencePath, surfaceIds: ["settings.main"] },
      { gate: "visual", path: m13SettingsVisualEvidencePath, surfaceIds: ["settings.main"] },
      { gate: "audit", path: m13SettingsAuditEvidencePath, surfaceIds: ["settings.main"] },
    ],
  }, undefined, m13SettingsRemainingGaps),
  incompleteEntry(
    "settings.global-shortcut",
    ["/keyboard-shortcut"],
    "required-native",
    "partial",
    {
      productionOwner: "native",
      localRoutes: ["/keyboard-shortcut"],
      localModules: [
        "apps/menubar-tauri/src/app/settings/global-shortcut-settings.service.ts",
        "apps/menubar-tauri/src/app/settings/keyboard-shortcut-page.component.ts",
      ],
      upstreamSources: [
        "vendor/bitwarden-clients/apps/browser/src/tools/popup/settings/settings-v2.component.ts",
        "vendor/bitwarden-clients/apps/browser/src/tools/popup/settings/settings-v2.component.html",
      ],
      tests: [
        "apps/menubar-tauri/src/app/settings/global-shortcut-settings.service.spec.ts",
        "apps/menubar-tauri/src/app/settings/keyboard-shortcut-page.component.spec.ts",
      ],
      evidence: [
        {
          gate: "audit",
          path: "docs/superpowers/reports/2026-07-24-global-shortcut-settings.md",
          surfaceIds: ["settings.global-shortcut"],
        },
      ],
    },
    undefined,
    globalShortcutSettingsRemainingGaps,
  ),
  incompleteEntry(
    "settings.account-security",
    ["/account-security"],
    "required-native",
    "partial",
    {
      productionOwner: "overlay",
      localRoutes: ["/account-security"],
      localModules: [
        "apps/menubar-tauri/src/app/settings/account-security-page.component.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/settings/official-account-security.component.ts",
        "apps/menubar-tauri/src/app/settings/environment-handoff.service.ts",
        "apps/menubar-tauri/src/app/settings/pin-setup-dialog.component.ts",
        "apps/menubar-tauri/src/app/auth/unlock-methods.service.ts",
      ],
      upstreamSources: [
        "vendor/bitwarden-clients/apps/browser/src/auth/popup/settings/account-security.component.ts",
        "vendor/bitwarden-clients/apps/browser/src/auth/popup/settings/account-security.component.html",
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
      evidence: [
        { gate: "visual", path: g3VisualEvidencePath, surfaceIds: ["settings.account-security"] },
        { gate: "audit", path: g3AuditEvidencePath, surfaceIds: ["settings.account-security"] },
        { gate: "visual", path: m13SettingsVisualEvidencePath, surfaceIds: ["settings.account-security"] },
        { gate: "audit", path: m13SettingsAuditEvidencePath, surfaceIds: ["settings.account-security"] },
        ...m15NativeAuditEvidence("settings.account-security"),
      ],
    },
    undefined,
    [...m13SettingsRemainingGaps, ...alternativeUnlockRemainingGaps],
  ),
  incompleteEntry("settings.vault", ["/vault-settings"], "required-native", "partial", {
    productionOwner: "overlay",
    localRoutes: ["/vault-settings"],
    localModules: [
      "apps/menubar-tauri/src/app/settings/vault-settings-page.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/settings/official-vault-settings.component.ts",
    ],
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/vault-settings.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/vault-settings.component.html",
    ],
    tests: [
      "apps/menubar-tauri/src/app/settings/vault-settings-page.component.spec.ts",
      "apps/menubar-tauri/src/app/settings/settings-production-boundary.spec.ts",
      "apps/menubar-tauri/e2e/generator-account-settings.spec.ts",
      m13SettingsRuntimeTest,
    ],
    evidence: [
      { gate: "visual", path: g3VisualEvidencePath, surfaceIds: ["settings.vault"] },
      { gate: "audit", path: g3AuditEvidencePath, surfaceIds: ["settings.vault"] },
      { gate: "visual", path: m13SettingsVisualEvidencePath, surfaceIds: ["settings.vault"] },
      { gate: "audit", path: m13SettingsAuditEvidencePath, surfaceIds: ["settings.vault"] },
    ],
  }, undefined, m13SettingsRemainingGaps),
  incompleteEntry(
    "settings.autofill-replacement",
    ["/autofill"],
    "required-native",
    "partial",
    {
      productionOwner: "native",
      localRoutes: ["/autofill"],
      localModules: [
        "apps/menubar-tauri/src/app/settings/autofill-settings-page.component.ts",
        "apps/menubar-tauri/src/app/settings/settings.service.ts",
        "apps/menubar-tauri/src/app/settings/settings-options.ts",
      ],
      upstreamSources: [
        "vendor/bitwarden-clients/apps/browser/src/tools/popup/settings/settings-v2.component.html",
      ],
      tests: [
        "apps/menubar-tauri/src/app/settings/p1-pages.spec.ts",
        "apps/menubar-tauri/src/app/settings/settings.service.spec.ts",
        "apps/menubar-tauri/src/app/settings/settings-production-boundary.spec.ts",
        m13SettingsRuntimeTest,
      ],
      evidence: [
        { gate: "visual", path: m13SettingsVisualEvidencePath, surfaceIds: ["settings.autofill-replacement"] },
        { gate: "audit", path: m13SettingsAuditEvidencePath, surfaceIds: ["settings.autofill-replacement"] },
      ],
    },
    undefined,
    m13SettingsRemainingGaps,
  ),
  incompleteEntry("settings.appearance", ["/appearance"], "required-native", "partial", {
    productionOwner: "overlay",
    localRoutes: ["/appearance"],
    localModules: [
      "apps/menubar-tauri/src/app/settings/appearance-page.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/settings/official-appearance.component.ts",
    ],
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/appearance.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/vault/popup/settings/appearance.component.html",
    ],
    tests: [
      "apps/menubar-tauri/src/app/settings/p1-pages.spec.ts",
      "apps/menubar-tauri/src/app/settings/settings-production-boundary.spec.ts",
      "apps/menubar-tauri/e2e/generator-account-settings.spec.ts",
      m13SettingsRuntimeTest,
    ],
    evidence: [
      { gate: "visual", path: g3VisualEvidencePath, surfaceIds: ["settings.appearance"] },
      { gate: "visual", path: m13SettingsVisualEvidencePath, surfaceIds: ["settings.appearance"] },
      { gate: "audit", path: m13SettingsAuditEvidencePath, surfaceIds: ["settings.appearance"] },
    ],
  }, undefined, m13SettingsRemainingGaps),
  incompleteEntry("settings.about", ["/about"], "required-native", "partial", {
    productionOwner: "overlay",
    localRoutes: ["/about"],
    localModules: [
      "apps/menubar-tauri/src/app/settings/about-page.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/settings/official-about.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/settings/official-about-dialog.component.ts",
    ],
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/tools/popup/settings/about-page/about-page-v2.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/tools/popup/settings/about-page/about-page-v2.component.html",
      "vendor/bitwarden-clients/apps/browser/src/tools/popup/settings/about-dialog/about-dialog.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/tools/popup/settings/about-dialog/about-dialog.component.html",
    ],
    tests: [
      "apps/menubar-tauri/src/app/settings/p1-pages.spec.ts",
      "apps/menubar-tauri/src/app/settings/environment-handoff.service.spec.ts",
      "apps/menubar-tauri/src/app/settings/settings-production-boundary.spec.ts",
      m13SettingsRuntimeTest,
    ],
    evidence: [
      { gate: "visual", path: m13SettingsVisualEvidencePath, surfaceIds: ["settings.about"] },
      { gate: "audit", path: m13SettingsAuditEvidencePath, surfaceIds: ["settings.about"] },
    ],
  }, undefined, m13SettingsRemainingGaps),

  incompleteEntry("handoff.change-password", ["/settings-password"], "web-vault-handoff", "partial", {
    productionOwner: "web-vault-handoff",
    localRoutes: ["/settings-password"],
    localModules: [
      "apps/menubar-tauri/src/app/settings/settings-password-page.component.ts",
      "apps/menubar-tauri/src/app/settings/environment-handoff.service.ts",
    ],
    upstreamSources: [
      "vendor/bitwarden-clients/apps/browser/src/auth/popup/settings/account-security.component.ts",
      "vendor/bitwarden-clients/apps/browser/src/auth/popup/settings/account-security.component.html",
    ],
    tests: [
      "apps/menubar-tauri/src/app/settings/environment-handoff.service.spec.ts",
      "apps/menubar-tauri/src/app/settings/settings-production-boundary.spec.ts",
      "apps/menubar-tauri/src/app/app.routes.spec.ts",
      m13SettingsRuntimeTest,
    ],
    evidence: [
      { gate: "visual", path: m13SettingsVisualEvidencePath, surfaceIds: ["handoff.change-password"] },
      { gate: "audit", path: m13SettingsAuditEvidencePath, surfaceIds: ["handoff.change-password"] },
    ],
  }, undefined, m13SettingsRemainingGaps),
  incompleteEntry(
    "native.tray-window",
    ["tray", "popup", "pop-out"],
    "required-native",
    "partial",
    {
      localModules: ["apps/menubar-tauri/src-tauri/src/main.rs"],
      evidence: m15NativeAuditEvidence("native.tray-window"),
    },
    undefined,
    [
      "The immediately prior release launched hidden; the final rebuild has only an exact process-path launch observation, so hidden startup and all tray interactions remain unverified.",
      "Two-display placement remains blocked because only one online display was available.",
      "Clean-user launch remains blocked because no clean-user macOS session was available.",
    ],
  ),
  incompleteEntry(
    "native.keychain",
    ["secure account/session storage"],
    "required-native",
    "partial",
    {
      localModules: [
        "apps/menubar-tauri/src/auth/account-session-store.ts",
        "apps/menubar-tauri/src-tauri/src/keychain.rs",
      ],
      tests: ["apps/menubar-tauri/src-tauri/src/keychain.rs"],
      evidence: [
        {
          gate: "native",
          path: "docs/superpowers/specs/2026-07-11-standard-auth-server-matrix-result.md",
          surfaceIds: ["native.keychain"],
        },
        {
          gate: "audit",
          path: "docs/superpowers/specs/2026-07-10-popup-completeness-audit.md",
          surfaceIds: ["native.keychain"],
        },
        ...m15NativeAuditEvidence("native.keychain"),
      ],
    },
    undefined,
    [
      "Current built-app two-account, selected-account removal, online relaunch, and offline relaunch remain blocked because disposable second-account credentials were unavailable; no historical credentials were used.",
    ],
  ),
  incompleteEntry(
    "native.clipboard",
    ["copy and timed clear"],
    "required-native",
    "partial",
    {
      localModules: ["apps/menubar-tauri/src/host/tauri-host.service.ts"],
      evidence: m15NativeAuditEvidence("native.clipboard"),
    },
    undefined,
    [
      "Built-UI clipboard generation and timed-clear cases remain unrun because the exact hidden status-bar app could not be operated.",
    ],
  ),
  incompleteEntry(
    "native.one-field-fill",
    ["selected field paste"],
    "required-native",
    "partial",
    {
      localModules: ["apps/menubar-tauri/src/host/tauri-host.service.ts"],
      evidence: m15NativeAuditEvidence("native.one-field-fill"),
    },
    undefined,
    [
      "Accessibility denied/granted controlled-fixture runs remain unperformed and require action-time user confirmation before any TCC setting change.",
      "Built-UI one-field paste remains unrun because the exact hidden status-bar app could not be operated.",
    ],
  ),
  incompleteEntry(
    "native.url-open",
    ["environment-aware external URL"],
    "required-native",
    "partial",
    {
      localModules: ["apps/menubar-tauri/src/host/tauri-host.service.ts"],
      evidence: m15NativeAuditEvidence("native.url-open"),
    },
    undefined,
    [
      "Exact public URL handoffs from the built UI remain unrun because the exact hidden status-bar app could not be operated.",
    ],
  ),
  incompleteEntry(
    "native.permissions",
    ["permission checks and feedback"],
    "required-native",
    "partial",
    {
      localModules: ["apps/menubar-tauri/src/host/tauri-host.service.ts"],
      evidence: m15NativeAuditEvidence("native.permissions"),
    },
    undefined,
    [
      "Accessibility denied/granted controlled-fixture runs remain unperformed and require action-time user confirmation before any TCC setting change.",
      "Permission feedback in the built UI remains unrun because the exact hidden status-bar app could not be operated.",
    ],
  ),

  incompleteEntry(
    "native.current-site-suggestions",
    ["/tabs/current", "URL ranking"],
    "required-native",
    "partial",
    {
      localModules: [
        "apps/menubar-tauri/src-tauri/src/frontmost.rs",
        "apps/menubar-tauri/src-tauri/src/browser_context.rs",
        "apps/menubar-tauri/src-tauri/src/browser_context_macos.rs",
        "apps/menubar-tauri/src/host/website-context.ts",
        "apps/menubar-tauri/src/app/vault/current-website-context.service.ts",
        "apps/menubar-tauri/src/app/vault/website-suggestion-matcher.ts",
        "apps/menubar-tauri/src/app/vault/vault.facade.ts",
        "apps/menubar-tauri/src/app/vault/vault-list-page.component.ts",
      ],
      tests: [
        "apps/menubar-tauri/src/host/website-context.spec.ts",
        "apps/menubar-tauri/src/app/vault/current-website-context.service.spec.ts",
        "apps/menubar-tauri/src/app/vault/website-suggestion-matcher.spec.ts",
        "apps/menubar-tauri/src/app/vault/vault.facade.spec.ts",
        "apps/menubar-tauri/src/app/vault/vault-list-page.component.spec.ts",
      ],
      productionOwner: "native",
    },
    undefined,
    [
      "Signed-build Automation permission and installed-browser live verification remain open.",
    ],
  ),
  incompleteEntry(
    "excluded.dom-autofill",
    ["content/DOM autofill"],
    "excluded-browser",
    "missing",
    {},
    excludedDomAutofillReason,
  ),
  incompleteEntry(
    "excluded.browser-background",
    ["background", "messaging", "badge", "page action"],
    "excluded-browser",
    "missing",
    {},
    excludedBrowserBackgroundReason,
  ),
  incompleteEntry(
    "excluded.browser-navigation",
    browserNavigationSurfaces,
    "excluded-browser",
    "missing",
    {},
    excludedBrowserNavigationReason,
  ),
  incompleteEntry(
    "excluded.native-messaging",
    ["desktop native messaging"],
    "excluded-browser",
    "missing",
    {},
    excludedNativeMessagingReason,
  ),
  incompleteEntry(
    "excluded.fido2",
    ["/fido2 interception"],
    "excluded-browser",
    "missing",
    {},
    excludedFido2Reason,
  ),
  incompleteEntry(
    "excluded.browser-prompts",
    ["default-manager", "triage", "phishing", "intro"],
    "excluded-browser",
    "missing",
    {},
    excludedBrowserPromptsReason,
  ),
] as const satisfies readonly PopupParityEntry[];

const authenticationAccountOrder = [
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
] as const;

export const popupParityManifest: readonly PopupParityEntry[] = [
  ...authenticationAccountOrder.map((id) =>
    popupParityEntries.find((entry) => entry.id === id)!,
  ),
  ...popupParityEntries.filter((entry) => !entry.id.startsWith("auth.")),
];

export function popupParitySummary() {
  return popupParityManifest
    .filter((entry) => entry.classification !== "excluded-browser")
    .reduce(
    (summary, entry) => ({ ...summary, [entry.status]: summary[entry.status] + 1 }),
    { missing: 0, partial: 0, complete: 0 },
  );
}

export function popupParityCompletionStatus(): PopupParityStatus {
  const summary = popupParitySummary();
  if (summary.missing > 0) {
    return "missing";
  }
  return summary.partial > 0 ? "partial" : "complete";
}

export function validateCompletedPopupParityEntries(
  entries: readonly PopupParityEntry[],
  sourceMappings: readonly PopupParitySourceMapping[],
  pathExists: (path: string) => boolean,
): string[] {
  return entries
    .filter((entry) => entry.status === "complete")
    .flatMap((entry) => validateCompletedPopupParityEntry(entry, sourceMappings, pathExists));
}

function validateCompletedPopupParityEntry(
  entry: PopupParityEntry,
  sourceMappings: readonly PopupParitySourceMapping[],
  pathExists: (path: string) => boolean,
): string[] {
  const failures: string[] = [];
  if (entry.remainingGaps.length > 0) {
    failures.push(`${entry.id}: completed entries must not list remaining gaps`);
  }
  if (entry.localRoutes.length === 0) {
    failures.push(`${entry.id}: completed entries require local routes`);
  }
  if (entry.localModules.length === 0) {
    failures.push(`${entry.id}: completed entries require local modules`);
  }
  if (entry.upstreamSources.length === 0) {
    failures.push(`${entry.id}: completed entries require upstream sources`);
  }
  if (entry.tests.length === 0) {
    failures.push(`${entry.id}: completed entries require tests`);
  }

  for (const gate of ["visual", "native", "audit"] as const) {
    const gateEvidence = entry.evidence.filter((evidence) => evidence.gate === gate);
    if (gateEvidence.length === 0) {
      failures.push(`${entry.id}: completed entries require ${gate} evidence`);
    } else if (!gateEvidence.every((evidence) => evidence.surfaceIds.includes(entry.id))) {
      failures.push(`${entry.id}: ${gate} evidence must be specific to this surface`);
    }
  }
  for (const evidence of entry.evidence) {
    if (!pathExists(evidence.path)) {
      failures.push(`${entry.id}: evidence path ${evidence.path} does not exist`);
    }
  }

  const claimedMappings = sourceMappings.filter((mapping) => entry.localModules.includes(mapping.localModule));
  for (const localModule of entry.localModules) {
    if (!claimedMappings.some((mapping) => mapping.localModule === localModule)) {
      failures.push(`${entry.id}: local module ${localModule} has no official source mapping`);
    }
  }
  const mappedUpstreamSources = new Set(claimedMappings.flatMap((mapping) => mapping.upstreamSources));
  const claimedUpstreamSources = new Set(entry.upstreamSources);
  for (const upstreamSource of claimedUpstreamSources) {
    if (!mappedUpstreamSources.has(upstreamSource)) {
      failures.push(`${entry.id}: upstream source ${upstreamSource} is not mapped from a claimed local module`);
    }
  }
  for (const upstreamSource of mappedUpstreamSources) {
    if (!claimedUpstreamSources.has(upstreamSource)) {
      failures.push(`${entry.id}: mapped upstream source ${upstreamSource} is omitted from the entry`);
    }
  }

  return failures;
}
