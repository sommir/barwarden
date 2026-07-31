import { resolve } from "node:path";

export const officialPersonalFormAliasSources = [
  ["@bitwarden/vault/cipher-form/components/cipher-form.component", "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/cipher-form.component.ts"],
  ["@bitwarden/vault/cipher-form/cipher-form-container", "vendor/bitwarden-clients/libs/vault/src/cipher-form/cipher-form-container.ts"],
  ["@bitwarden/vault/cipher-form/abstractions/cipher-form-config.service", "vendor/bitwarden-clients/libs/vault/src/cipher-form/abstractions/cipher-form-config.service.ts"],
  ["@bitwarden/vault/cipher-form/abstractions/cipher-form.service", "vendor/bitwarden-clients/libs/vault/src/cipher-form/abstractions/cipher-form.service.ts"],
  ["@bitwarden/vault/cipher-form/components/item-details/item-details-section.component", "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/item-details/item-details-section.component.ts"],
  ["@bitwarden/vault/cipher-form/components/card-details-section/card-details-section.component", "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/card-details-section/card-details-section.component.ts"],
  ["@bitwarden/vault/cipher-form/components/identity/identity.component", "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/identity/identity.component.ts"],
  ["@bitwarden/vault/cipher-form/components/additional-options/additional-options-section.component", "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/additional-options/additional-options-section.component.ts"],
  ["@bitwarden/vault/cipher-form/components/custom-fields/custom-fields.component", "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/custom-fields/custom-fields.component.ts"],
  ["@bitwarden/vault/cipher-form/components/custom-fields/add-edit-custom-field-dialog/add-edit-custom-field-dialog.component", "vendor/bitwarden-clients/libs/vault/src/cipher-form/components/custom-fields/add-edit-custom-field-dialog/add-edit-custom-field-dialog.component.ts"],
] as const;

export interface OfficialPersonalFormAlias {
  readonly find: RegExp;
  readonly replacement: string;
}

export function buildOfficialPersonalFormAliases(
  projectRoot: string,
): OfficialPersonalFormAlias[] {
  return officialPersonalFormAliasSources.map(([specifier, source]) => ({
    find: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
    replacement: resolve(projectRoot, source),
  }));
}
