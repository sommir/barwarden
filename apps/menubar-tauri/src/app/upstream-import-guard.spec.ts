import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { assertPinnedUpstreamRevision } from "./upstream-provenance";

const sourceRoot = join(process.cwd(), "apps/menubar-tauri/src");

const forbiddenPathFragments = [
  "apps/browser/src/popup/app-routing.module",
  "apps/browser/src/autofill/content",
  "apps/browser/src/autofill/background",
  "apps/browser/src/vault/content",
  "autofill/content",
  "autofill/background",
  "vault/content",
];

const forbiddenRuntimeTokens = [
  "chrome.tabs",
  "browser.tabs",
  "webRequest",
  "webNavigation",
  "nativeMessaging",
  "contentScript",
  "showOpenFilePicker",
  "chrome.downloads",
  "browser.downloads",
];

const allowedOfficialTypeOnlyRuntimeTokens = new Map([
  [
    "app/upstream-overlays/vault-main/browser-src/vault/popup/components/vault/new-item-dropdown/new-item-dropdown.component.ts",
    new Set(["chrome.tabs"]),
  ],
]);

function listRuntimeTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = join(directory, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      return listRuntimeTypeScriptFiles(fullPath);
    }

    if (!entry.endsWith(".ts") || entry.endsWith(".spec.ts") || entry === "upstream-reuse.ts") {
      return [];
    }

    return [fullPath];
  });
}

function importedSpecifiers(source: string): string[] {
  return Array.from(source.matchAll(/\b(?:import|export)\s+(?:type\s+)?(?:[^'"]+\s+from\s+)?["']([^"']+)["']/g)).map(
    (match) => match[1],
  );
}

function readProjectFile(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

type ProductionEvidenceAlias = {
  readonly find: string;
  readonly replacement: string;
};

const expectedProductionEvidenceAliases: readonly ProductionEvidenceAlias[] = [
  {
    find: "/^\\.\\/evidence\\/evidence-providers$/",
    replacement: "./src/app/evidence/evidence-providers.production.ts",
  },
  {
    find: "/^(?:\\.\\/recovery-workflow-evidence|\\.\\.\\/evidence\\/recovery-workflow-evidence)$/",
    replacement: "./src/app/evidence/recovery-workflow-evidence.production.ts",
  },
  {
    find: "/^\\.\\/vault\\/vault-main-evidence-preview$/",
    replacement: "./src/app/vault/vault-main-evidence-preview.production.ts",
  },
  {
    find: "/^\\.\\/send\\/send-evidence-preview$/",
    replacement: "./src/app/send/send-evidence-preview.production.ts",
  },
  {
    find: "/^\\.\\/settings\\/settings-evidence-preview$/",
    replacement: "./src/app/settings/settings-evidence-preview.production.ts",
  },
  {
    find: "/^\\.\\/auth\\/auth-evidence-preview$/",
    replacement: "./src/app/auth/auth-evidence-preview.production.ts",
  },
];

function productionEvidenceAliases(source: string): ProductionEvidenceAlias[] {
  const sourceFile = ts.createSourceFile("vite.config.ts", source, ts.ScriptTarget.Latest, true);
  const aliases: ProductionEvidenceAlias[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const find = node.properties.find((property): property is ts.PropertyAssignment =>
        ts.isPropertyAssignment(property)
          && ts.isIdentifier(property.name)
          && property.name.text === "find"
          && property.initializer.kind === ts.SyntaxKind.RegularExpressionLiteral,
      );
      const replacement = node.properties.find((property): property is ts.PropertyAssignment =>
        ts.isPropertyAssignment(property)
          && ts.isIdentifier(property.name)
          && property.name.text === "replacement",
      );
      if (find && replacement) {
        const replacementLiteral = descendants(replacement.initializer)
          .find((candidate): candidate is ts.StringLiteral =>
            ts.isStringLiteral(candidate) && candidate.text.endsWith(".production.ts"),
          );
        if (replacementLiteral) {
          aliases.push({
            find: find.initializer.getText(sourceFile),
            replacement: replacementLiteral.text,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return aliases;
}

function productionProviderViolations(source: string): string[] {
  const sourceFile = ts.createSourceFile(
    "evidence-providers.production.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const [importStatement, functionStatement, ...extraStatements] = sourceFile.statements;
  const violations: string[] = [];
  if (!importStatement || !ts.isImportDeclaration(importStatement)
      || !importStatement.importClause?.isTypeOnly
      || !ts.isStringLiteral(importStatement.moduleSpecifier)
      || importStatement.moduleSpecifier.text !== "@angular/core"
      || !importStatement.importClause.namedBindings
      || !ts.isNamedImports(importStatement.importClause.namedBindings)
      || importStatement.importClause.namedBindings.elements.length !== 1
      || importStatement.importClause.namedBindings.elements[0]?.name.text !== "Provider") {
    violations.push("production provider must have only the Provider type import");
  }
  if (!functionStatement || !ts.isFunctionDeclaration(functionStatement)
      || functionStatement.name?.text !== "createEvidenceProviders"
      || !functionStatement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
      || functionStatement.modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
      || !functionStatement.body
      || functionStatement.body.statements.length !== 1
      || !ts.isReturnStatement(functionStatement.body.statements[0])
      || !functionStatement.body.statements[0].expression
      || !ts.isArrayLiteralExpression(functionStatement.body.statements[0].expression)
      || functionStatement.body.statements[0].expression.elements.length !== 0) {
    violations.push("production provider must only export createEvidenceProviders returning []");
  }
  if (extraStatements.length > 0) {
    violations.push("production provider must not contain top-level side effects or exports");
  }
  return violations;
}

function descendants(node: ts.Node): ts.Node[] {
  const nodes: ts.Node[] = [];
  const visit = (candidate: ts.Node): void => {
    nodes.push(candidate);
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return nodes;
}

const productionLockModules = [
  "apps/menubar-tauri/src/app/auth/lock-page.component.ts",
  "apps/menubar-tauri/src/app/auth/official-master-password-unlock.adapter.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/auth/lock/official-lock.component.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/auth/lock/official-master-password-lock.component.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/auth/lock/official-pin-lock.component.ts",
] as const;

const productionVaultHeaderModules = [
  "apps/menubar-tauri/src/app/vault/vault-list-page.component.ts",
  "apps/menubar-tauri/src/app/vault/vault-row-actions.adapter.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/components/vault/vault-header/vault-header.component.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/components/vault/vault-search/vault-search.component.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/components/vault/vault-list-filters/vault-list-filters.component.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/platform/browser/run-inside-angular.operator.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/services/vault-popup-items.service.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/services/vault-popup-list-filters.service.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/services/vault-popup-loading.service.ts",
] as const;

type AstImport = {
  readonly specifier: string;
  readonly bindings: readonly string[];
};

function astImports(path: string, source = readFileSync(path, "utf8")): AstImport[] {
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const imports: AstImport[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const bindings = node.importClause
        ? [
            ...(node.importClause.name ? [node.importClause.name.text] : []),
            ...(node.importClause.namedBindings && ts.isNamespaceImport(node.importClause.namedBindings)
              ? [node.importClause.namedBindings.name.text]
              : []),
            ...(node.importClause.namedBindings && ts.isNamedImports(node.importClause.namedBindings)
              ? node.importClause.namedBindings.elements.map((binding) => binding.name.text)
              : []),
          ]
        : [];
      imports.push({ specifier: node.moduleSpecifier.text, bindings });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push({ specifier: node.moduleSpecifier.text, bindings: [] });
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      imports.push({ specifier: node.arguments[0].text, bindings: [] });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return imports;
}

const forbiddenLockIntegrations = [
  { name: "PopupStateStore", module: /(?:^|\/)popup-state(?:$|\.)/i, binding: /^PopupStateStore$/ },
  { name: "PIN", module: /(?:pin|lock-component\.service)/i, binding: /(?:Pin|UnlockOption)/ },
  { name: "biometrics/native messaging", module: /(?:biometric|native[-_.]?messag|@bitwarden\/messaging)/i, binding: /(?:Biometric|MessageListener|NativeMessag)/ },
  { name: "PRF/WebAuthn", module: /(?:prf|webauthn|fido)/i, binding: /(?:Prf|PRF|WebAuthn|Fido)/ },
  { name: "shared unlock", module: /(?:@bitwarden\/unlock|shared[-_.]?unlock)/i, binding: /(?:UnlockService|SharedUnlock)/ },
  { name: "device trust", module: /device[-_.]?trust/i, binding: /DeviceTrust/ },
  { name: "broadcaster", module: /broadcaster/i, binding: /Broadcaster/ },
  { name: "browser pop-out", module: /(?:pop-out|browser-popup)/i, binding: /(?:PopOut|BrowserPopup)/ },
] as const;

function lockIntegrationViolations(path: string, source = readFileSync(path, "utf8")): string[] {
  return astImports(path, source).flatMap((entry) => forbiddenLockIntegrations.flatMap((integration) =>
    integration.name === "PIN" && entry.specifier === "./official-pin-lock.component"
      ? []
      : integration.module.test(entry.specifier) || entry.bindings.some((binding) => integration.binding.test(binding))
      ? [`${integration.name}: ${entry.specifier}`]
      : [],
  ));
}

function canonicalLockGraph(): string[] {
  const config = ts.readConfigFile(join(process.cwd(), "tsconfig.json"), ts.sys.readFile);
  const options = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd()).options;
  const absoluteModules = productionLockModules.map((path) => join(process.cwd(), path));
  const canonicalModules = new Map(absoluteModules.map((path) => [realpathSync.native(path), relative(process.cwd(), path)]));
  return absoluteModules.flatMap((importer) => astImports(importer).flatMap(({ specifier }) => {
    const resolved = ts.resolveModuleName(specifier, importer, options, ts.sys).resolvedModule?.resolvedFileName;
    if (!resolved || !existsSync(resolved)) {
      return [];
    }
    const target = canonicalModules.get(realpathSync.native(resolved));
    return target ? [`${relative(process.cwd(), importer)} -> ${target}`] : [];
  })).sort();
}

describe("upstream reuse guard", () => {
  it("keeps Vault evidence fixed, gated, and free of runtime secret inputs", () => {
    const evidenceSource = readProjectFile(
      "apps/menubar-tauri/src/app/vault/vault-main-evidence-preview.ts",
    );
    const configSource = readProjectFile("apps/menubar-tauri/src/app/app.config.ts");
    const rootSource = readProjectFile("apps/menubar-tauri/src/app/app.component.ts");
    const providerSource = readProjectFile(
      "apps/menubar-tauri/src/app/evidence/evidence-providers.ts",
    );
    const productionProviderSource = readProjectFile(
      "apps/menubar-tauri/src/app/evidence/evidence-providers.production.ts",
    );

    const viteSource = readProjectFile("apps/menubar-tauri/vite.config.ts");
    expect(configSource).toContain('from "./evidence/evidence-providers"');
    expect(configSource).not.toContain("g3-evidence-account");
    expect(viteSource).toContain('process.env.VITE_BW_VAULT_EVIDENCE === "true"');
    expect(productionEvidenceAliases(viteSource)).toEqual(expectedProductionEvidenceAliases);
    const misconfiguredViteSource = viteSource.replace(
      "/^\\.\\/evidence\\/evidence-providers$/",
      "/^\\.\\/evidence\\/evidence-provider$/",
    );
    expect(productionEvidenceAliases(misconfiguredViteSource))
      .not.toEqual(expectedProductionEvidenceAliases);
    expect(providerSource).toContain(
      'evidenceEnabled = import.meta.env.VITE_BW_VAULT_EVIDENCE === "true"',
    );
    expect(providerSource).toMatch(/if\s*\(!evidenceEnabled\)\s*\{\s*return \[\];/u);
    expect(productionProviderViolations(productionProviderSource)).toEqual([]);
    expect(productionProviderViolations(`${productionProviderSource}\nconsole.log("side effect");`))
      .toContain("production provider must not contain top-level side effects or exports");
    expect(rootSource).not.toContain("import.meta.env.VITE_BW_VAULT_EVIDENCE");
    expect(rootSource).toContain("@Inject(AUTH_EVIDENCE_STATE)");
    expect(rootSource).toMatch(/@Optional\(\)\s*@Inject\(VAULT_MAIN_EVIDENCE_STATE\)/u);
    expect(rootSource).toMatch(/@Optional\(\)\s*@Inject\(SEND_EVIDENCE_STATE\)/u);
    expect(rootSource).toMatch(/@Optional\(\)\s*@Inject\(SETTINGS_EVIDENCE_STATE\)/u);
    for (const preview of [
      "auth/auth-evidence-preview",
      "vault/vault-main-evidence-preview",
      "send/send-evidence-preview",
      "settings/settings-evidence-preview",
    ]) {
      expect(rootSource).toMatch(
        new RegExp(`await\\s+import\\(\\s*["']\\./${preview}["']\\s*\\)`, "u"),
      );
    }
    expect(rootSource).not.toMatch(/^import .*vault-main-evidence-preview/m);
    expect(evidenceSource).not.toMatch(
      /localStorage|sessionStorage|fetch\(|secureGet|access-token|refresh-token|PRIVATE KEY|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i,
    );
    expect(evidenceSource).not.toMatch(/BARWARDEN_LIVE_|process\.env/);
  });

  it("production-excludes the M9 provider and rejects its fixture markers", () => {
    const evidenceProvider = readProjectFile(
      "apps/menubar-tauri/src/app/evidence/personal-cipher-workflow-evidence.ts",
    );
    const productionProvider = readProjectFile(
      "apps/menubar-tauri/src/app/evidence/evidence-providers.production.ts",
    );
    const bundleAudit = readProjectFile("scripts/verify-production-bundle.sh");

    expect(productionProvider).not.toContain("personal-cipher-workflow-evidence");
    expect(productionProvider).not.toContain("PERSONAL_CIPHER_EVIDENCE");
    expect(evidenceProvider).not.toMatch(/BARWARDEN_LIVE_|process\.env|import\.meta\.env/);
    expect(evidenceProvider).not.toMatch(/afterAnimationFrames|requestAnimationFrame/);
    expect(evidenceProvider).toContain("bw-evidence-release-personal-write");
    for (const marker of [
      "card-detail-reprompt",
      "personal-form-stale",
      "m9-created-card",
      "m9-stale-returned-sentinel",
      "4242424242424242",
      "C123EXAMPLE",
      "000-00-0000",
      "identity.example.test",
      "Synthetic example.test Card notes",
      "+1 555 0100",
      "1 Example Way",
      "Synthetic example.test Identity notes",
      "card-hidden-example",
      "identity-hidden-example",
      "note-hidden-example",
      "Synthetic example.test secure note body",
    ]) {
      expect(bundleAudit).toContain(marker);
    }
  });

  it("terminates M10 recovery evidence at an empty production shim", () => {
    const evidenceProvider = readProjectFile(
      "apps/menubar-tauri/src/app/evidence/recovery-workflow-evidence.ts",
    );
    const productionShim = readProjectFile(
      "apps/menubar-tauri/src/app/evidence/recovery-workflow-evidence.production.ts",
    );
    const productionProvider = readProjectFile(
      "apps/menubar-tauri/src/app/evidence/evidence-providers.production.ts",
    );
    const viteSource = readProjectFile("apps/menubar-tauri/vite.config.ts");
    const bundleAudit = readProjectFile("scripts/verify-production-bundle.sh");

    expect(productionShim).toMatch(/return \[\];/);
    expect(productionProvider).not.toContain("recovery-workflow-evidence");
    expect(viteSource).toContain("recovery-workflow-evidence.production.ts");
    expect(evidenceProvider).not.toMatch(/BARWARDEN_LIVE_|process\.env|import\.meta\.env/);
    expect(evidenceProvider).not.toMatch(/setTimeout|requestAnimationFrame/);
    expect(evidenceProvider).toContain("bw-evidence-release-recovery-transport");
    for (const marker of [
      "password-history-populated",
      "password-history-empty",
      "password-history-reprompt",
      "folders-list",
      "folders-empty",
      "folders-add-dialog",
      "folders-edit-dialog",
      "folders-delete-confirmation",
      "archive-list",
      "archive-menu",
      "archive-empty",
      "trash-list",
      "trash-menu",
      "trash-permanent-delete-confirmation",
      "trash-empty",
      "recovery-operation-error",
      "m10-created-folder",
      "m10-encrypted-folder",
      "bw-evidence-release-recovery-transport",
      "bw-evidence-recovery-transition",
      "__bwRecoverySecureGet",
      "__bwRecoverySecureSet",
      "__bwRecoverySecureDelete",
      "__bwRecoveryServerCommit",
      "__bwRecoveryFreshSync",
      "__bwRecoveryNativeCopy",
      "recoveryStartup",
      "Synthetic recovery evidence operation failure",
      "Example Recovery Login",
      "Example Recovery Card",
      "Example Recovery Identity",
      "Example Recovery Note",
      "Example Work",
      "Example Personal",
    ]) {
      expect(bundleAudit).toContain(marker);
    }
  });

  it("audits password-history isolation with quiet structural markers instead of history values", () => {
    const bundleAudit = readProjectFile("scripts/verify-production-bundle.sh");
    const bundleAuditTest = readProjectFile("scripts/verify-production-bundle.test.sh");

    expect(bundleAudit).not.toMatch(/old-secret-[12]/);
    expect(bundleAuditTest).not.toMatch(/old-secret-[12]/);
    expect(bundleAudit).toContain("task10_patterns='appCopyClick|password-history-selection|PlatformUtilsService|archivePremiumRestart|restartPremium|assignToCollections|passkeyNotCopiedAlert|conditionallyNavigateToAssignCollections'");
    expect(bundleAudit).toContain("rg --quiet");
    expect(bundleAudit).toContain("Task 10 forbidden patterns:");
    for (const marker of ["appCopyClick", "password-history-selection", "PlatformUtilsService"]) {
      expect(bundleAuditTest).toContain(`'${marker}'`);
    }
  });

  it("vendors the pinned official cipher view source tree", () => {
    const sourceRevision = readFileSync(
      join(process.cwd(), "vendor/bitwarden-clients/.source-revision"),
      "utf8",
    );

    expect(assertPinnedUpstreamRevision(sourceRevision)).toEqual({
      repositoryUrl: "https://github.com/bitwarden/clients.git",
      commit: "f47b6946e01aed474875789081966d311d5b8289",
    });

    const officialDetailSources = [
      "cipher-view/cipher-view.component.html",
      "cipher-view/item-details/item-details-v2.component.html",
      "cipher-view/login-credentials/login-credentials-view.component.html",
      "cipher-view/autofill-options/autofill-options-view.component.html",
      "cipher-view/custom-fields/custom-fields-v2.component.html",
      "cipher-view/item-history/item-history-v2.component.html",
      "components/totp-countdown/totp-countdown.component.ts",
      "components/totp-countdown/totp-countdown.component.html",
    ];

    for (const source of officialDetailSources) {
      expect(
        existsSync(
          join(
            process.cwd(),
            "vendor/bitwarden-clients/libs/vault/src",
            source,
          ),
        ),
      ).toBe(true);
    }
  });

  it("rejects malformed upstream source markers for the vendored snapshot guard", () => {
    expect(() =>
      assertPinnedUpstreamRevision("https://github.com/bitwarden/clients.git\n"),
    ).toThrow("Invalid upstream source marker");
    expect(() =>
      assertPinnedUpstreamRevision("https://github.com/bitwarden/clients.git\nf47b6946e01aed474875789081966d311d5b8289\nextra"),
    ).toThrow("Invalid upstream source marker");
    expect(() =>
      assertPinnedUpstreamRevision("https://example.com/bitwarden/clients.git\nf47b6946e01aed474875789081966d311d5b8289"),
    ).toThrow("Unexpected Bitwarden clients source revision");
  });

  it("vendors the pinned official cipher form source templates", () => {
    const officialCipherFormSources = [
      "cipher-form/components/cipher-form.component.html",
      "cipher-form/components/item-details/item-details-section.component.html",
      "cipher-form/components/login-details-section/login-details-section.component.html",
      "cipher-form/components/autofill-options/autofill-options.component.html",
      "cipher-form/components/card-details-section/card-details-section.component.html",
      "cipher-form/components/identity/identity.component.html",
      "cipher-form/components/sshkey-section/sshkey-section.component.html",
      "cipher-form/components/additional-options/additional-options-section.component.html",
    ];

    for (const source of officialCipherFormSources) {
      expect(
        existsSync(
          join(
            process.cwd(),
            "vendor/bitwarden-clients/libs/vault/src",
            source,
          ),
        ),
      ).toBe(true);
    }
  });

  it("vendors the pinned official generator source tree", () => {
    const officialGeneratorSources = [
      "core/src/engine/sdk-password-randomizer.ts",
      "core/src/engine/username-randomizer.ts",
      "core/src/data/default-password-generation-options.ts",
      "core/src/data/default-passphrase-generation-options.ts",
      "components/src/credential-generator.component.html",
      "components/src/password-settings.component.html",
      "components/src/passphrase-settings.component.html",
      "components/src/credential-generator-history.component.html",
      "extensions/history/src/local-generator-history.service.ts",
    ];

    for (const source of officialGeneratorSources) {
      expect(
        existsSync(
          join(process.cwd(), "vendor/bitwarden-clients/libs/tools/generator", source),
        ),
      ).toBe(true);
    }
  });

  it("tracks official source provenance for the popup foundation", async () => {
    const upstreamModule = (await import("./upstream-reuse")) as Record<string, unknown>;
    const mappings = (upstreamModule["officialSourceMappings"] ?? []) as Array<{
      localModule: string;
      upstreamSources: readonly string[];
      mode: string;
      excludedDependencies: readonly string[];
    }>;

    expect(mappings.map((mapping) => mapping.localModule)).toEqual([
      "apps/menubar-tauri/src/auth/installation-id.service.ts",
      "apps/menubar-tauri/src/app/auth/auth-official-source.guard.spec.ts",
      "apps/menubar-tauri/src/app/auth/login-page.component.ts",
      "apps/menubar-tauri/src/app/app.component.ts",
      "apps/menubar-tauri/src/app/auth/lock-page.component.ts",
      "apps/menubar-tauri/src/app/auth/official-master-password-unlock.adapter.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/lock/official-lock.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/lock/official-master-password-lock.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/lock/official-pin-lock.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/lock/official-master-password-lock.transform-manifest.json",
      "apps/menubar-tauri/src/app/auth/two-factor-page.component.ts",
      "apps/menubar-tauri/src/app/auth/official-challenge.adapter.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/two-factor/official-two-factor.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/two-factor/official-two-factor-options.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/two-factor/official-two-factor-email.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/two-factor/official-two-factor-authenticator.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/two-factor/official-two-factor.transform-manifest.json",
      "apps/menubar-tauri/src/app/auth/new-device-verification-page.component.ts",
      "apps/menubar-tauri/src/app/auth/official-new-device.adapter.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/new-device/official-new-device-verification.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/new-device/official-new-device-verification.transform-manifest.json",
      "apps/menubar-tauri/src/app/auth/password-hint-page.component.ts",
      "apps/menubar-tauri/src/app/auth/official-password-auth.adapter.ts",
      "apps/menubar-tauri/src/app/auth/official-password-hint-api.adapter.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/login/official-password-login.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/login/official-password-hint.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/login/official-password-auth.transform-manifest.json",
      "apps/menubar-tauri/src/app/popup-header-actions.component.ts",
      "apps/menubar-tauri/src/app/auth/official-account-switcher.adapter.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/official-account-switcher.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/official-account.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/official-account-switcher.transform-manifest.json",
      "apps/menubar-tauri/src/app/auth/official-environment.adapter.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/anonymous/official-anonymous-shell.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/environment/official-environment-selector.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/environment/official-self-hosted-dialog.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/environment/native-dialog-lifecycle.adapter.ts",
      "apps/menubar-tauri/src/app/auth/auth.facade.ts",
      "apps/menubar-tauri/src/app/popup-shell/popup-shell.component.ts",
      "apps/menubar-tauri/src/app/layout/popup-footer.component.ts",
      "apps/menubar-tauri/src/app/layout/popup-page.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/popup-header/jslib.module.adapter.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/popup-header/popup-header.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/pop-out/pop-out.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/pop-out/browser-popup-utils.adapter.ts",
      "apps/menubar-tauri/src/app/official-ui/official-ui-common.ts",
      "apps/menubar-tauri/src/app/official-ui/official-i18n.service.ts",
      "apps/menubar-tauri/src/styles/official-theme.css",
      "apps/menubar-tauri/official-components-overlay/async-actions/bit-action.directive.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/generator/official-credential-generator.component.ts",
      "vendor/bitwarden-clients/libs/tools/generator/components/src/password-settings.component.ts",
      "vendor/bitwarden-clients/libs/tools/generator/components/src/passphrase-settings.component.ts",
      "vendor/bitwarden-clients/libs/tools/generator/components/src/username-settings.component.ts",
      "vendor/bitwarden-clients/libs/tools/generator/components/src/subaddress-settings.component.ts",
      "vendor/bitwarden-clients/libs/tools/generator/components/src/catchall-settings.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator.transform-manifest.json",
      "apps/menubar-tauri/src/app/generator/generator-history-page.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/components/vault/vault-header/vault-header.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/components/vault/vault-search/vault-search.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/components/vault/vault-list-filters/vault-list-filters.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/platform/browser/run-inside-angular.operator.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/components/vault/new-item-dropdown/new-item-dropdown.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/platform/browser/browser-api.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/platform/browser/browser-popup-utils.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/components/vault/add-edit/add-edit.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/services/vault-popup-items.service.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/services/vault-popup-list-filters.service.ts",
      "apps/menubar-tauri/src/app/vault/retained-restricted-item-types.service.ts",
      "apps/menubar-tauri/src/app/vault/retained-item-types.provider.ts",
      "apps/menubar-tauri/src/app/vault/official-vault-boundary.ts",
      "apps/menubar-tauri/src/app/vault/retained-new-item-dropdown.component.ts",
      "apps/menubar-tauri/src/app/vault/vault-list-page.component.ts",
      "apps/menubar-tauri/src/app/vault/vault-row-actions.adapter.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/vault-list-items-container.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/item-more-options.component.ts",
      "apps/menubar-tauri/src/app/vault/popup-cipher-view.adapter.ts",
      "apps/menubar-tauri/src/app/vault/login-cipher-view.adapter.ts",
      "apps/menubar-tauri/src/app/vault/personal-cipher-view.adapter.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-personal-detail.transform-manifest.json",
      "apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-personal-form.transform-manifest.json",
      "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-color-password.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-item-details.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-credentials.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-totp-countdown.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-uri-options.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-additional-options.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-custom-fields.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-item-history.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-detail.transform-manifest.json",
      "apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-login-form.transform-manifest.json",
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/vault-loading-skeleton/vault-loading-skeleton.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/vault-fade-in-out/vault-fade-in-out.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/vault-fade-in-out-skeleton/vault-fade-in-out-skeleton.component.ts",
      "apps/menubar-tauri/src/app/vault/vault-filter-chip.component.ts",
      "apps/menubar-tauri/src/app/vault/vault-item-icon.component.ts",
      "apps/menubar-tauri/src/app/vault/vault-detail-section.component.ts",
      "apps/menubar-tauri/src/app/vault/vault-detail-field.component.ts",
      "apps/menubar-tauri/src/app/vault/official-totp.service.adapter.ts",
      "apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.ts",
      "apps/menubar-tauri/src/app/vault/new-item-page.component.ts",
      "apps/menubar-tauri/src/app/vault/vault-add-edit-page.component.ts",
      "apps/menubar-tauri/src/app/vault/vault-reprompt-dialog.component.ts",
      "apps/menubar-tauri/src/app/vault/vault-password-history-page.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/recovery/password-history/official-password-history-view.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/recovery/official-recovery.transform-manifest.json",
      "apps/menubar-tauri/src/vault/vault-sync.service.ts",
      "apps/menubar-tauri/src/app/vault/folders-page.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/recovery/folders/official-folders.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/recovery/folders/official-add-edit-folder-dialog.component.ts",
      "apps/menubar-tauri/src/app/vault/vault-folder.service.ts",
      "apps/menubar-tauri/src/app/vault/archive-page.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/recovery/archive/official-archive.component.ts",
      "apps/menubar-tauri/src/app/vault/trash-page.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/recovery/trash/official-trash.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/recovery/trash/official-trash-list-items-container.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-add-edit.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-details.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-text-details.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-options.component.ts",
      "apps/menubar-tauri/src/app/send/retained-text-send-form.service.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list-items-container.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-created.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/send/official-send.transform-manifest.json",
      "apps/menubar-tauri/src/sdk/bitwarden-sdk-core.service.ts",
    ]);

    for (const mapping of mappings) {
      const expectedMode = [
        "apps/menubar-tauri/src/app/auth/auth-official-source.guard.spec.ts",
        "apps/menubar-tauri/src/app/upstream-overlays/auth/login/official-password-auth.transform-manifest.json",
        "apps/menubar-tauri/src/app/upstream-overlays/auth/two-factor/official-two-factor.transform-manifest.json",
        "apps/menubar-tauri/src/app/upstream-overlays/auth/new-device/official-new-device-verification.transform-manifest.json",
        "apps/menubar-tauri/src/app/upstream-overlays/auth/lock/official-master-password-lock.transform-manifest.json",
        "apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/official-account-switcher.transform-manifest.json",
        "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-detail.transform-manifest.json",
        "apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-login-form.transform-manifest.json",
        "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-personal-detail.transform-manifest.json",
        "apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-personal-form.transform-manifest.json",
        "apps/menubar-tauri/src/app/upstream-overlays/recovery/official-recovery.transform-manifest.json",
        "apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator.transform-manifest.json",
        "apps/menubar-tauri/src/app/upstream-overlays/send/official-send.transform-manifest.json",
      ].includes(mapping.localModule) ? "guard" :
        [
          "apps/menubar-tauri/src/app/vault/vault-password-history-page.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/recovery/password-history/official-password-history-view.component.ts",
          "apps/menubar-tauri/src/app/vault/folders-page.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/recovery/folders/official-folders.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/recovery/folders/official-add-edit-folder-dialog.component.ts",
          "apps/menubar-tauri/src/app/vault/archive-page.component.ts",
          "apps/menubar-tauri/src/app/vault/trash-page.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/recovery/archive/official-archive.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/recovery/trash/official-trash.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/recovery/trash/official-trash-list-items-container.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/generator/official-credential-generator.component.ts",
          "apps/menubar-tauri/src/app/generator/generator-history-page.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-add-edit.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-details.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-text-details.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-options.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list-items-container.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-created.component.ts",
        ].includes(mapping.localModule) ? "overlay" :
        [
          "apps/menubar-tauri/src/app/app.component.ts",
          "apps/menubar-tauri/src/app/layout/popup-footer.component.ts",
          "apps/menubar-tauri/src/app/layout/popup-page.component.ts",
          "apps/menubar-tauri/src/app/official-ui/official-ui-common.ts",
          "apps/menubar-tauri/src/styles/official-theme.css",
          "apps/menubar-tauri/src/app/popup-header-actions.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/components/vault/vault-header/vault-header.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/components/vault/vault-search/vault-search.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/components/vault/vault-list-filters/vault-list-filters.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/platform/browser/run-inside-angular.operator.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/components/vault/new-item-dropdown/new-item-dropdown.component.ts",
          "apps/menubar-tauri/src/app/vault/retained-new-item-dropdown.component.ts",
          "apps/menubar-tauri/src/app/vault/vault-list-page.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/vault-main/vault-loading-skeleton/vault-loading-skeleton.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/vault-main/vault-fade-in-out/vault-fade-in-out.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/vault-main/vault-fade-in-out-skeleton/vault-fade-in-out-skeleton.component.ts",
          "vendor/bitwarden-clients/libs/tools/generator/components/src/password-settings.component.ts",
          "vendor/bitwarden-clients/libs/tools/generator/components/src/passphrase-settings.component.ts",
          "vendor/bitwarden-clients/libs/tools/generator/components/src/username-settings.component.ts",
          "vendor/bitwarden-clients/libs/tools/generator/components/src/subaddress-settings.component.ts",
          "vendor/bitwarden-clients/libs/tools/generator/components/src/catchall-settings.component.ts",
        ].includes(mapping.localModule)
          ? "direct"
          : [
          "apps/menubar-tauri/src/auth/installation-id.service.ts",
          "apps/menubar-tauri/src/app/auth/login-page.component.ts",
          "apps/menubar-tauri/src/app/auth/lock-page.component.ts",
          "apps/menubar-tauri/src/app/auth/official-master-password-unlock.adapter.ts",
          "apps/menubar-tauri/src/app/auth/password-hint-page.component.ts",
          "apps/menubar-tauri/src/app/auth/official-password-auth.adapter.ts",
          "apps/menubar-tauri/src/app/auth/official-password-hint-api.adapter.ts",
          "apps/menubar-tauri/src/app/auth/two-factor-page.component.ts",
          "apps/menubar-tauri/src/app/auth/official-challenge.adapter.ts",
          "apps/menubar-tauri/src/app/auth/new-device-verification-page.component.ts",
          "apps/menubar-tauri/src/app/auth/official-new-device.adapter.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/auth/login/official-password-login.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/auth/lock/official-lock.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/auth/lock/official-master-password-lock.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/auth/lock/official-pin-lock.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/auth/login/official-password-hint.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/auth/two-factor/official-two-factor.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/auth/two-factor/official-two-factor-options.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/auth/two-factor/official-two-factor-email.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/auth/two-factor/official-two-factor-authenticator.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/auth/new-device/official-new-device-verification.component.ts",
          "apps/menubar-tauri/src/app/auth/official-account-switcher.adapter.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/official-account-switcher.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/official-account.component.ts",
          "apps/menubar-tauri/src/app/auth/official-environment.adapter.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/auth/anonymous/official-anonymous-shell.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/auth/environment/official-environment-selector.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/auth/environment/official-self-hosted-dialog.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/auth/environment/native-dialog-lifecycle.adapter.ts",
          "apps/menubar-tauri/src/app/auth/auth.facade.ts",
          "apps/menubar-tauri/src/app/popup-shell/popup-shell.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/popup-header/jslib.module.adapter.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/popup-header/popup-header.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/pop-out/pop-out.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/pop-out/browser-popup-utils.adapter.ts",
          "apps/menubar-tauri/src/app/official-ui/official-i18n.service.ts",
          "apps/menubar-tauri/official-components-overlay/async-actions/bit-action.directive.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/services/vault-popup-items.service.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/services/vault-popup-list-filters.service.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/services/vault-popup-loading.service.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/platform/browser/browser-api.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/platform/browser/browser-popup-utils.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/components/vault/add-edit/add-edit.component.ts",
          "apps/menubar-tauri/src/app/vault/retained-restricted-item-types.service.ts",
          "apps/menubar-tauri/src/app/vault/retained-item-types.provider.ts",
          "apps/menubar-tauri/src/app/vault/official-vault-boundary.ts",
          "apps/menubar-tauri/src/app/vault/vault-row-actions.adapter.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/vault-main/vault-list-items-container.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/vault-main/item-more-options.component.ts",
          "apps/menubar-tauri/src/app/vault/popup-cipher-view.adapter.ts",
          "apps/menubar-tauri/src/app/vault/login-cipher-view.adapter.ts",
          "apps/menubar-tauri/src/app/vault/personal-cipher-view.adapter.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-totp-countdown.component.ts",
          "apps/menubar-tauri/src/app/vault/official-totp.service.adapter.ts",
          "apps/menubar-tauri/src/app/vault/vault-item-icon.component.ts",
          "apps/menubar-tauri/src/app/vault/vault-reprompt-dialog.component.ts",
          "apps/menubar-tauri/src/vault/vault-sync.service.ts",
          "apps/menubar-tauri/src/app/vault/vault-folder.service.ts",
          "apps/menubar-tauri/src/app/send/retained-text-send-form.service.ts",
      "apps/menubar-tauri/src/sdk/bitwarden-sdk-core.service.ts",
        ].includes(mapping.localModule)
          ? "adapter"
          : "template";
      expect(mapping.mode).toBe(expectedMode);
      expect(existsSync(join(process.cwd(), mapping.localModule))).toBe(true);
      expect(mapping.upstreamSources.length).toBeGreaterThan(0);
      for (const upstreamSource of mapping.upstreamSources) {
        expect(existsSync(join(process.cwd(), upstreamSource))).toBe(true);
      }
    }

    const personalDetailGuard = mappings.find((mapping) =>
      mapping.localModule.endsWith("official-personal-detail.transform-manifest.json"));
    const personalFormGuard = mappings.find((mapping) =>
      mapping.localModule.endsWith("official-personal-form.transform-manifest.json"));
    const personalDetailPage = mappings.find((mapping) =>
      mapping.localModule.endsWith("vault-item-detail-page.component.ts"));
    const personalFormPage = mappings.find((mapping) =>
      mapping.localModule.endsWith("vault-add-edit-page.component.ts"));

    expect(personalDetailGuard?.excludedDependencies.join(" ")).not.toContain("until Task 2");
    expect(personalFormGuard?.excludedDependencies.join(" ")).not.toContain("until Task 4");
    expect(personalDetailPage?.upstreamSources).toEqual(expect.arrayContaining([
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/card-details/card-details-view.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-view/view-identity-sections/view-identity-sections.component.ts",
    ]));
    expect(personalFormPage?.upstreamSources).toEqual(expect.arrayContaining([
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/card-details-section/card-details-section.component.ts",
      "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/identity/identity.component.ts",
    ]));

    expect(
      mappings
        .filter((mapping) => [
          "apps/menubar-tauri/src/app/app.component.ts",
          "apps/menubar-tauri/src/app/auth/login-page.component.ts",
          "apps/menubar-tauri/src/app/auth/lock-page.component.ts",
          "apps/menubar-tauri/src/app/auth/two-factor-page.component.ts",
          "apps/menubar-tauri/src/app/auth/new-device-verification-page.component.ts",
          "apps/menubar-tauri/src/app/auth/password-hint-page.component.ts",
          "apps/menubar-tauri/src/app/popup-header-actions.component.ts",
          "apps/menubar-tauri/src/app/auth/official-account-switcher.adapter.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/official-account-switcher.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/official-account.component.ts",
          "apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/official-account-switcher.transform-manifest.json",
        ].includes(mapping.localModule))
        .map(({ localModule, mode, excludedDependencies }) => ({ localModule, mode, excludedDependencies })),
    ).toEqual([
      {
        localModule: "apps/menubar-tauri/src/app/auth/login-page.component.ts",
        mode: "adapter",
        excludedDependencies: ["official Login runtime lives in the guarded overlay and delegates only to the retained password-auth adapter"],
      },
      {
        localModule: "apps/menubar-tauri/src/app/app.component.ts",
        mode: "direct",
        excludedDependencies: [
          "SSO, passkey and hardware-key, device-login, approval, and FIDO2 popup routes",
          "domain-confirmation and browser popup pop-out routing",
          "redirect guard Device Trust Enrollment (TDE) branch is outside Plan A",
        ],
      },
      {
        localModule: "apps/menubar-tauri/src/app/auth/lock-page.component.ts",
        mode: "adapter",
        excludedDependencies: [
          "official runtime lives in the guarded lock overlays and delegates master-password, runtime PIN, and Touch ID operations to bounded local adapters",
        ],
      },
      {
        localModule: "apps/menubar-tauri/src/app/auth/two-factor-page.component.ts",
        mode: "adapter",
        excludedDependencies: [
          "official two-factor runtime lives in guarded parent/options/child overlays",
        ],
      },
      {
        localModule: "apps/menubar-tauri/src/app/auth/new-device-verification-page.component.ts",
        mode: "adapter",
        excludedDependencies: [
          "official new-device runtime lives in the guarded overlay and delegates only to the bounded challenge adapter",
        ],
      },
      {
        localModule: "apps/menubar-tauri/src/app/auth/password-hint-page.component.ts",
        mode: "adapter",
        excludedDependencies: ["official Password Hint runtime lives in the guarded overlay"],
      },
      {
        localModule: "apps/menubar-tauri/src/app/popup-header-actions.component.ts",
        mode: "direct",
        excludedDependencies: [],
      },
      {
        localModule: "apps/menubar-tauri/src/app/auth/official-account-switcher.adapter.ts",
        mode: "adapter",
        excludedDependencies: [
          "chrome runtime events, BrowserApi, fromChromeEvent, Safari flags, feature flags, extension messages, and browser-account timeouts",
        ],
      },
      {
        localModule: "apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/official-account-switcher.component.ts",
        mode: "adapter",
        excludedDependencies: [
          "official lock, logout, account, auth, and vault-timeout services replaced by OfficialAccountSwitcherAdapter and retained AuthFacade lifecycle state",
        ],
      },
      {
        localModule: "apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/official-account.component.ts",
        mode: "adapter",
        excludedDependencies: [
          "biometrics autoprompt, local logging, and browser-account selection services",
        ],
      },
      {
        localModule: "apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/official-account-switcher.transform-manifest.json",
        mode: "guard",
        excludedDependencies: [
          "digest-pinned manifest records direct, retained, adapted, and deleted account-hierarchy bindings and templates",
        ],
      },
    ]);

    const authMappings = mappings.filter((mapping) => [
      "apps/menubar-tauri/src/app/auth/login-page.component.ts",
      "apps/menubar-tauri/src/app/auth/lock-page.component.ts",
      "apps/menubar-tauri/src/app/auth/two-factor-page.component.ts",
      "apps/menubar-tauri/src/app/auth/official-challenge.adapter.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/two-factor/official-two-factor.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/two-factor/official-two-factor-options.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/two-factor/official-two-factor-email.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/two-factor/official-two-factor-authenticator.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/two-factor/official-two-factor.transform-manifest.json",
      "apps/menubar-tauri/src/app/auth/new-device-verification-page.component.ts",
      "apps/menubar-tauri/src/app/auth/official-new-device.adapter.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/new-device/official-new-device-verification.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/new-device/official-new-device-verification.transform-manifest.json",
      "apps/menubar-tauri/src/app/auth/password-hint-page.component.ts",
      "apps/menubar-tauri/src/app/auth/official-environment.adapter.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/anonymous/official-anonymous-shell.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/environment/official-environment-selector.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/environment/official-self-hosted-dialog.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/environment/native-dialog-lifecycle.adapter.ts",
      "apps/menubar-tauri/src/app/auth/official-account-switcher.adapter.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/official-account-switcher.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/official-account.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/official-account-switcher.transform-manifest.json",
      "apps/menubar-tauri/src/app/auth/auth-official-source.guard.spec.ts",
    ].includes(mapping.localModule));
    expect(authMappings.flatMap((mapping) => mapping.upstreamSources)).not.toContain(
      "vendor/bitwarden-clients/apps/browser/src/popup/app-routing.module.ts",
    );
  });

  it("does not import excluded browser runtime roots", () => {
    const violations = listRuntimeTypeScriptFiles(sourceRoot).flatMap((filePath) => {
      const source = readFileSync(filePath, "utf8");
      return importedSpecifiers(source)
        .filter((specifier) => forbiddenPathFragments.some((fragment) => specifier.includes(fragment)))
        .map((specifier) => `${relative(sourceRoot, filePath)} imports ${specifier}`);
    });

    expect(violations).toEqual([]);
  });

  it("does not reference browser-only runtime APIs in app code", () => {
    const violations = listRuntimeTypeScriptFiles(sourceRoot).flatMap((filePath) => {
      const source = readFileSync(filePath, "utf8");
      const relativePath = relative(sourceRoot, filePath);
      const allowedTokens = allowedOfficialTypeOnlyRuntimeTokens.get(relativePath) ?? new Set();
      return forbiddenRuntimeTokens
        .filter((token) => source.includes(token) && !allowedTokens.has(token))
        .map((token) => `${relativePath} references ${token}`);
    });

    expect(violations).toEqual([]);
  });

  it("keeps the production Vault header graph outside browser, autofill, and global-state services", () => {
    const forbiddenModule = /(?:vault-popup-copy-buttons|platform\/state|view-cache|admin-console|organization|collection|autofill|content-script|background|browser-api)/i;
    const forbiddenBinding = /^(?:StateProvider|ViewCacheService|PolicyService|OrganizationService|CollectionService|BrowserApi|BrowserPopupUtils)$/;
    const violations = productionVaultHeaderModules.flatMap((modulePath) => {
      const absolutePath = join(process.cwd(), modulePath);
      const source = readFileSync(absolutePath, "utf8");
      return astImports(absolutePath, source).flatMap(({ specifier, bindings }) => [
        ...(forbiddenModule.test(specifier) ? [`${modulePath} imports ${specifier}`] : []),
        ...bindings
          .filter((binding) => forbiddenBinding.test(binding))
          .map((binding) => `${modulePath} imports ${binding}`),
      ]);
    });

    expect(violations).toEqual([]);
    expect(readProjectFile(
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/browser-src/vault/popup/services/vault-popup-loading.service.ts",
    )).toBe(
      'export { VaultPopupItemsService as VaultPopupLoadingService } from "./vault-popup-items.service";\n',
    );
  });

  it("keeps the canonical production lock graph bounded and free of every excluded lock integration", () => {
    expect(canonicalLockGraph()).toEqual([
      "apps/menubar-tauri/src/app/auth/lock-page.component.ts -> apps/menubar-tauri/src/app/upstream-overlays/auth/lock/official-lock.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/lock/official-lock.component.ts -> apps/menubar-tauri/src/app/auth/official-master-password-unlock.adapter.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/lock/official-lock.component.ts -> apps/menubar-tauri/src/app/upstream-overlays/auth/lock/official-master-password-lock.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/lock/official-lock.component.ts -> apps/menubar-tauri/src/app/upstream-overlays/auth/lock/official-pin-lock.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/auth/lock/official-master-password-lock.component.ts -> apps/menubar-tauri/src/app/auth/official-master-password-unlock.adapter.ts",
    ]);
    expect(productionLockModules.flatMap((path) => lockIntegrationViolations(join(process.cwd(), path)))).toEqual([]);
  });

  it.each([
    ["PopupStateStore", 'import { PopupStateStore } from "../popup-state";'],
    ["PIN", 'import { UnlockOption } from "@bitwarden/key-management-ui/lock/services/lock-component.service";'],
    ["biometrics/native messaging", 'import { MessageListener } from "@bitwarden/messaging";'],
    ["PRF/WebAuthn", 'import { UnlockViaPrfComponent } from "./unlock-via-prf.component";'],
    ["shared unlock", 'import { UnlockService } from "@bitwarden/unlock";'],
    ["device trust", 'import { DeviceTrustService } from "@bitwarden/common/key-management/device-trust";'],
    ["broadcaster", 'import { BroadcasterService } from "@bitwarden/common/platform/abstractions/broadcaster.service";'],
    ["browser pop-out", 'import { PopOutComponent } from "@bitwarden/browser-popup/components/pop-out.component";'],
  ] as const)("rejects %s when introduced into the production lock graph", (name, addedImport) => {
    const path = join(process.cwd(), productionLockModules[0]);
    expect(lockIntegrationViolations(path, `${readFileSync(path, "utf8")}\n${addedImport}\n`))
      .toContainEqual(expect.stringContaining(`${name}:`));
  });

  it("keeps deferred Plan A capabilities unreachable from production surfaces", () => {
    const routeSource = readProjectFile("apps/menubar-tauri/src/app/app.routes.ts");
    const visibleSources = [
      "apps/menubar-tauri/src/app/popup-header-actions.component.ts",
      "apps/menubar-tauri/src/app/settings/settings-page.component.ts",
      "apps/menubar-tauri/src/app/settings/account-security-page.component.ts",
      "apps/menubar-tauri/src/app/settings/vault-settings-page.component.ts",
      "apps/menubar-tauri/src/app/settings/autofill-settings-page.component.ts",
      "apps/menubar-tauri/src/app/vault/vault-list-page.component.ts",
      "apps/menubar-tauri/src/app/vault/new-item-page.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/vault-main/item-more-options.component.ts",
      "apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.ts",
      "apps/menubar-tauri/src/app/vault/vault-add-edit-page.component.ts",
      "apps/menubar-tauri/src/app/vault/archive-page.component.ts",
      "apps/menubar-tauri/src/app/vault/trash-page.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/recovery/archive/official-archive.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/recovery/trash/official-trash.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/recovery/trash/official-trash-list-items-container.component.ts",
      "apps/menubar-tauri/src/app/send/send-page.component.ts",
      "apps/menubar-tauri/src/app/send/send-add-edit-page.component.ts",
    ].map(readProjectFile).join("\n");

    expect(routeSource).not.toMatch(
      /path:\s*["'`](?:attachments|assign-collections|import|export|at-risk-passwords|device-management|blocked-domains|excluded-domains|notifications|fingerprint-phrase)(?:\/[^"'`]*)?["'`]/,
    );
    expect(visibleSources).not.toMatch(
      /文件 Send|SSH 密钥|管理设备|阻止的域名|导入|导出|附件|分配集合|存在风险的密码|通知|["'`]\/(?:import|export|attachments|assign-collections|at-risk-passwords|notifications|device-management|blocked-domains|excluded-domains)(?=[/?"'`])/,
    );
  });

  it("keeps Plan A comparison documents free of deferred-feature backlog claims", () => {
    const comparison = readProjectFile(
      "docs/superpowers/specs/2026-07-10-bitwarden-popup-function-comparison.md",
    );

    expect(comparison).not.toMatch(
      /at-risk password entry implemented|local at-risk password entry|Assign collections now|additional notes, attachments|at-risk notification appearance settings remain deferred/,
    );
    const unscopedDeferredClaims = comparison
      .split("\n")
      .filter((line) =>
        /SSH Key|attachments?(?!['’])|import\/export|assign collections|device management|blocked domains?|excluded domains?|notifications?|entitlement|forwarded-email|file Send/i.test(line),
      )
      .filter((line) => !/Plan A|excluded|outside|unreachable|absent|dormant|untouched|not backlog/i.test(line));
    expect(unscopedDeferredClaims).toEqual([]);
    expect(comparison).toContain("Excluded from Plan A; no route or Vault entry is reachable.");
    expect(comparison).toContain("Excluded from Plan A; no notification or domain-administration route is reachable.");
  });

  it("reserves native file selection and transfer for the Tauri host", () => {
    expect(forbiddenRuntimeTokens).toEqual(
      expect.arrayContaining(["showOpenFilePicker", "chrome.downloads", "browser.downloads"]),
    );
  });

  it("confines the official SDK package to the crypto adapter and its narrow runtime bridge", () => {
    const sdkImporters = listRuntimeTypeScriptFiles(sourceRoot)
      .filter((filePath) => readFileSync(filePath, "utf8").includes("@bitwarden/sdk-internal"))
      .map((filePath) => relative(sourceRoot, filePath));

    expect(sdkImporters).toEqual([
      "sdk/bitwarden-sdk-core.service.ts",
      "sdk/bitwarden-sdk-runtime.ts",
    ]);
  });

  it("keeps the retained Generator graph on exact local aliases and bounded app ports", () => {
    const route = readProjectFile("apps/menubar-tauri/src/app/generator/generator-page.component.ts");
    const runtime = [
      "apps/menubar-tauri/src/app/upstream-overlays/generator/official-credential-generator.component.ts",
      "apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-core.component.ts",
      "apps/menubar-tauri/src/app/generator/official-credential-generator-service.adapter.ts",
      "apps/menubar-tauri/src/app/generator/official-generator-account.adapter.ts",
      "apps/menubar-tauri/src/app/generator/generator-clipboard.directive.ts",
    ].map(readProjectFile).join("\n");
    const settings = [
      "vendor/bitwarden-clients/libs/tools/generator/components/src/password-settings.component.ts",
      "vendor/bitwarden-clients/libs/tools/generator/components/src/passphrase-settings.component.ts",
    ].map(readProjectFile).join("\n");

    expect(route).toContain('from "@bitwarden/generator-overlay/credential-generator"');
    expect(route).toMatch(/GeneratorService/);
    expect(runtime).toMatch(/GENERATOR_RUNTIME/);
    expect(route).toMatch(/PopupStateStore/);
    expect(route).toMatch(/GENERATOR_STATUS/);
    expect(runtime).toMatch(/GeneratorStatusPort/);
    expect(runtime).not.toMatch(/PopupStateStore/);
    expect(route).toMatch(/ClipboardPolicyService/);
    expect(runtime).toMatch(/GENERATOR_CLIPBOARD_POLICY/);
    expect(settings).toMatch(/class PasswordSettingsComponent/);
    expect(settings).toMatch(/class PassphraseSettingsComponent/);
    expect(runtime).not.toMatch(
      /(?:chrome\.|currentTab|currentUrl|website|CopyClickDirective|appCopyClick|OrganizationService|Forwarder|forwarder|nudge|spotlight|content-script|background|nativeMessaging)/i,
    );
  });
});
