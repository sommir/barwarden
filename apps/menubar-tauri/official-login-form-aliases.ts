import { resolve } from "node:path";

export const officialLoginFormAliasSources = [
  [
    "@bitwarden/official-login-form/cipher-form",
    "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/cipher-form.component.ts",
  ],
  [
    "@bitwarden/official-login-form/cipher-form-container",
    "vendor/bitwarden-clients/libs/vault/src/cipher-form/cipher-form-container.ts",
  ],
  [
    "@bitwarden/official-login-form/item-details",
    "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/item-details/item-details-section.component.ts",
  ],
  [
    "@bitwarden/official-login-form/login-details",
    "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/login-details-section/login-details-section.component.ts",
  ],
  [
    "@bitwarden/official-login-form/autofill-options",
    "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/autofill-options/autofill-options.component.ts",
  ],
  [
    "@bitwarden/official-login-form/uri-option",
    "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/autofill-options/uri-option.component.ts",
  ],
  [
    "@bitwarden/official-login-form/advanced-uri-option-dialog",
    "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/autofill-options/advanced-uri-option-dialog.component.ts",
  ],
  [
    "@bitwarden/official-login-form/additional-options",
    "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/additional-options/additional-options-section.component.ts",
  ],
  [
    "@bitwarden/official-login-form/custom-fields",
    "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/custom-fields/custom-fields.component.ts",
  ],
  [
    "@bitwarden/official-login-form/add-edit-custom-field-dialog",
    "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/custom-fields/add-edit-custom-field-dialog/add-edit-custom-field-dialog.component.ts",
  ],
] as const;

export interface OfficialLoginFormAlias {
  readonly find: RegExp;
  readonly replacement: string;
}

export function buildOfficialLoginFormAliases(
  projectRoot: string,
): OfficialLoginFormAlias[] {
  return officialLoginFormAliasSources.map(([specifier, source]) => ({
    find: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
    replacement: resolve(projectRoot, source),
  }));
}
