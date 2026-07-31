import { dirname, relative, resolve } from "node:path";

import internalBoundary from "./official-generator-internal-boundary.json";

export type OfficialGeneratorClosureExclusion = {
  readonly id: string;
  readonly pattern: string;
  readonly flags: string;
  readonly scopes: readonly ("path" | "edge" | "content")[];
  readonly ignoredContentPaths?: readonly string[];
};

export const officialGeneratorClosureExclusions: readonly OfficialGeneratorClosureExclusion[] = [
  {
    id: "browser-package",
    pattern: "^@bitwarden/browser(?:/|$)|(?:^|/)(?:autofill|background|content)(?:/|$)",
    flags: "i",
    scopes: ["edge"],
  },
  {
    id: "provider-package",
    pattern: "(?:^|/)(?:providers?|integrations?)(?:/|$)",
    flags: "i",
    scopes: ["path", "edge"],
  },
  {
    id: "sso-package",
    pattern: "(?:^|[./-])sso(?:[./-]|$)",
    flags: "i",
    scopes: ["path", "edge"],
  },
  {
    id: "forwarder-graph",
    pattern: "(?:^|/)(?:forwarders?|forwarder-[^/]*)(?:/|$)",
    flags: "i",
    scopes: ["path", "edge"],
  },
  {
    id: "official-history-storage",
    pattern: "local-generator-history|secret-state|state-provider|dialog\\.service",
    flags: "i",
    scopes: ["path", "edge"],
  },
  {
    id: "forbidden-provider-api",
    pattern: "ForwarderIntegration|ForwarderSettingsComponent|nativeMessaging|webRequest|webNavigation|content-script|autofill/background|browser/background|currentTab|currentUrl|CopyClickDirective|appCopyClick|SecretState|LocalGeneratorHistoryService|loading credential history|account input change detected",
    flags: "i",
    scopes: ["content"],
    // This is a pinned, data-only locale catalogue. Its prose can mention
    // browser concepts, but it does not introduce a provider/runtime edge.
    ignoredContentPaths: [
      "vendor/bitwarden-clients/apps/browser/src/_locales/en/messages.json",
    ],
  },
];

export const officialGeneratorHistoryClosureExclusions: readonly OfficialGeneratorClosureExclusion[] = [
  {
    id: "forbidden-history-state-provider",
    pattern: "\\bStateProvider\\b",
    flags: "",
    scopes: ["content"],
    ignoredContentPaths: [
      "vendor/bitwarden-clients/libs/tools/generator/core/src/util.ts",
    ],
  },
  {
    id: "forbidden-history-dialog-service",
    pattern: "\\bDialogService\\b",
    flags: "",
    scopes: ["content"],
    ignoredContentPaths: [
      "apps/menubar-tauri/official-components-overlay/index.ts",
    ],
  },
  {
    id: "forbidden-history-semantic-logger",
    pattern: "\\bSemanticLogger\\b",
    flags: "",
    scopes: ["content"],
  },
];

export const officialGeneratorAliasSources = [
  ["@bitwarden/generator-overlay/credential-generator", "apps/menubar-tauri/src/app/upstream-overlays/generator/official-credential-generator.component.ts"],
  ["@bitwarden/generator-overlay/password-settings", "vendor/bitwarden-clients/libs/tools/generator/components/src/password-settings.component.ts"],
  ["@bitwarden/generator-overlay/passphrase-settings", "vendor/bitwarden-clients/libs/tools/generator/components/src/passphrase-settings.component.ts"],
  ["@bitwarden/generator-overlay/username-settings", "vendor/bitwarden-clients/libs/tools/generator/components/src/username-settings.component.ts"],
  ["@bitwarden/generator-overlay/subaddress-settings", "vendor/bitwarden-clients/libs/tools/generator/components/src/subaddress-settings.component.ts"],
  ["@bitwarden/generator-overlay/catchall-settings", "vendor/bitwarden-clients/libs/tools/generator/components/src/catchall-settings.component.ts"],
  ["@bitwarden/generator-overlay/credential-generator-history", "apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-history.component.ts"],
  ["@bitwarden/generator-overlay/credential-generator-history-rows", "apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-history-rows.component.ts"],
  ["@bitwarden/generator-overlay/empty-credential-history", "apps/menubar-tauri/src/app/upstream-overlays/generator/official-empty-generator-history.component.ts"],
  ["@bitwarden/generator-core", "apps/menubar-tauri/src/app/generator/official-generator-core.boundary.ts"],
  ["@bitwarden/generator-history", "apps/menubar-tauri/src/app/generator/official-generator-history.boundary.ts"],
  ["@bitwarden/generator-overlay/color-password", "apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-color-password.component.ts"],
  ["@bitwarden/generator-overlay/popup-header-actions", "apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-header-actions.component.ts"],
] as const;

export interface OfficialGeneratorAlias {
  readonly find: RegExp;
  readonly replacement: string;
}

export function buildOfficialGeneratorAliases(projectRoot: string): OfficialGeneratorAlias[] {
  return officialGeneratorAliasSources.map(([specifier, source]) => ({
    find: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
    replacement: resolve(projectRoot, source),
  }));
}

export function resolveOfficialGeneratorInternalBoundary(
  projectRoot: string,
  source: string,
  importer: string | undefined,
): string | null {
  if (!importer || !source.startsWith(".")) return null;
  const coreRoot = resolve(projectRoot, internalBoundary.coreRoot);
  const cleanImporter = importer.split("?", 1)[0];
  const importerRelative = relative(coreRoot, cleanImporter);
  if (importerRelative.startsWith("..") || resolve(coreRoot, importerRelative) !== cleanImporter) {
    return null;
  }
  if (!internalBoundary.importers.includes(importerRelative)) return null;
  const candidate = resolve(dirname(cleanImporter), source);
  const isPinnedBarrel = internalBoundary.barrels.some((barrel) =>
    candidate === resolve(coreRoot, barrel) || candidate === resolve(coreRoot, barrel, "index.ts"));
  return isPinnedBarrel ? resolve(projectRoot, internalBoundary.boundary) : null;
}

export function buildOfficialGeneratorInternalBoundaryPlugin(projectRoot: string) {
  return {
    name: "official-generator-internal-boundary",
    enforce: "pre" as const,
    resolveId(source: string, importer: string | undefined) {
      return resolveOfficialGeneratorInternalBoundary(projectRoot, source, importer);
    },
  };
}
