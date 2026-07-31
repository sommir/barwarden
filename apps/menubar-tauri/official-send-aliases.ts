import { resolve } from "node:path";

export type RuntimeClosureExclusion = {
  readonly id: string;
  readonly pattern: string;
  readonly flags: string;
  readonly ignoredContentPaths?: readonly string[];
};

const officialEnglishCatalogue = [
  "vendor/bitwarden-clients/apps/browser/src/_locales/en/messages.json",
] as const;

export const officialSendAliasSources = [
  ["@bitwarden/send-overlay/list", "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list.component.ts"],
  ["@bitwarden/send-overlay/list-items", "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list-items-container.component.ts"],
  ["@bitwarden/send-overlay/add-edit", "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-add-edit.component.ts"],
  ["@bitwarden/send-overlay/created", "apps/menubar-tauri/src/app/upstream-overlays/send/official-send-created.component.ts"],
] as const;

export const officialSendClosureExclusions: readonly RuntimeClosureExclusion[] = [
  { id: "file-send", pattern: "send-file|SendFile|FileReader|upload.*send|download.*send", flags: "i" },
  { id: "premium-billing", pattern: "Billing|PremiumUpgrade|hasPremiumFromAnySource", flags: "i" },
  {
    id: "organization-admin",
    pattern: "OrganizationService|allowedDomains|SpecificPeople",
    flags: "i",
    ignoredContentPaths: officialEnglishCatalogue,
  },
  {
    id: "browser-runtime",
    pattern: "CurrentAccount|PopOutComponent|nativeMessaging|webRequest|webNavigation|contentScript|browser\\.tabs|chrome\\.tabs",
    flags: "i",
    ignoredContentPaths: officialEnglishCatalogue,
  },
  {
    id: "sso",
    pattern: "@bitwarden/auth/sso|singleSignOn",
    flags: "i",
    ignoredContentPaths: officialEnglishCatalogue,
  },
];

export type OfficialSendAlias = {
  readonly find: RegExp;
  readonly replacement: string;
};

export function buildOfficialSendAliases(root: string): readonly OfficialSendAlias[] {
  return officialSendAliasSources.map(([specifier, source]) => ({
    find: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
    replacement: resolve(root, source),
  }));
}
