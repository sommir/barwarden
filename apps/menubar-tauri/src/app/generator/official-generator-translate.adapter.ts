import type { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import type { I18nKeyOrLiteral } from "@bitwarden/common/tools/types";

export function translate(key: I18nKeyOrLiteral, i18n: I18nService): string {
  return typeof key === "string" ? i18n.t(key) : key.literal;
}
