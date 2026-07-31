import passphrase from "../../../../../vendor/bitwarden-clients/libs/tools/generator/core/src/metadata/password/eff-word-list";
import password from "../../../../../vendor/bitwarden-clients/libs/tools/generator/core/src/metadata/password/random-password";
import catchall from "../../../../../vendor/bitwarden-clients/libs/tools/generator/core/src/metadata/email/catchall";
import plusAddress from "../../../../../vendor/bitwarden-clients/libs/tools/generator/core/src/metadata/email/plus-address";
import effWordList from "../../../../../vendor/bitwarden-clients/libs/tools/generator/core/src/metadata/username/eff-word-list";

export { CredentialGeneratorService } from "../../../../../vendor/bitwarden-clients/libs/tools/generator/core/src/abstractions/credential-generator-service.abstraction";
export {
  Algorithm,
  AlgorithmsByType,
  Type,
} from "../../../../../vendor/bitwarden-clients/libs/tools/generator/core/src/metadata/data";
export {
  isPasswordAlgorithm,
  isEmailAlgorithm,
  isSameAlgorithm,
  isUsernameAlgorithm,
} from "../../../../../vendor/bitwarden-clients/libs/tools/generator/core/src/metadata/util";
export type { AlgorithmMetadata } from "../../../../../vendor/bitwarden-clients/libs/tools/generator/core/src/metadata/algorithm-metadata";
export type {
  CredentialAlgorithm,
  CredentialType,
} from "../../../../../vendor/bitwarden-clients/libs/tools/generator/core/src/metadata/type";
export { GeneratedCredential } from "../../../../../vendor/bitwarden-clients/libs/tools/generator/core/src/types/generated-credential";
export type { AlgorithmInfo } from "../../../../../vendor/bitwarden-clients/libs/tools/generator/core/src/types/algorithm-info";
export type { CredentialPreference } from "../../../../../vendor/bitwarden-clients/libs/tools/generator/core/src/types/credential-preference";
export type { GenerateRequest } from "../../../../../vendor/bitwarden-clients/libs/tools/generator/core/src/types/generate-request";
export type { PassphraseGenerationOptions } from "../../../../../vendor/bitwarden-clients/libs/tools/generator/core/src/types/passphrase-generation-options";
export type { PasswordGenerationOptions } from "../../../../../vendor/bitwarden-clients/libs/tools/generator/core/src/types/password-generation-options";
export type { EffUsernameGenerationOptions } from "../../../../../vendor/bitwarden-clients/libs/tools/generator/core/src/types/eff-username-generator-options";
export type { SubaddressGenerationOptions } from "../../../../../vendor/bitwarden-clients/libs/tools/generator/core/src/types/subaddress-generator-options";
export type { CatchallGenerationOptions } from "../../../../../vendor/bitwarden-clients/libs/tools/generator/core/src/types/catchall-generator-options";

/** Exact aliases of the two pinned official metadata values retained by Task 1. */
export const BuiltIn = Object.freeze({
  password,
  passphrase,
  effWordList,
  plusAddress,
  catchall,
});
