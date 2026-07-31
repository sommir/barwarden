import { translateOfficialMessage } from "../official-ui/official-i18n.service";

export const SUPPORTED_TWO_FACTOR_PROVIDERS = ["0", "1"] as const;

export function unsupportedAuthenticationMessage(): string {
  return translateOfficialMessage("i18nUnsupportedTwoFactor");
}

export interface SupportedTwoFactorProvider {
  readonly id: 0 | 1;
  readonly label: string;
}

export function supportedTwoFactorProviders(
  providers: readonly string[],
): readonly SupportedTwoFactorProvider[] {
  return providers.flatMap((provider) =>
    provider === "0"
      ? [{ id: 0 as const, label: translateOfficialMessage("authenticatorAppTitle") }]
      : provider === "1"
        ? [{ id: 1 as const, label: translateOfficialMessage("email") }]
        : [],
  );
}
