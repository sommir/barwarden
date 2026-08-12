import {
  UriMatchStrategy,
  type UriMatchStrategySetting,
} from "@bitwarden/common/models/domain/domain-service";
import { LoginUriView } from "@bitwarden/common/vault/models/view/login-uri.view";

import type { VaultItem, VaultUri } from "./vault-item.model";

type WebsiteEvidenceKind =
  | "exact-url"
  | "starts-with"
  | "host"
  | "full-hostname"
  | "registrable-domain"
  | "regular-expression";

interface WebsiteMatchEvidence {
  readonly kind: WebsiteEvidenceKind;
  readonly rank: number;
  readonly specificity: number;
}

interface RankedWebsiteItem {
  readonly item: VaultItem;
  readonly evidence: WebsiteMatchEvidence;
}

const evidenceRanks: Readonly<Record<WebsiteEvidenceKind, number>> = {
  "exact-url": 6,
  "starts-with": 5,
  host: 4,
  "full-hostname": 3,
  "registrable-domain": 2,
  "regular-expression": 1,
};

function effectiveMatchType(value: string): UriMatchStrategySetting {
  if (value === "default" || value.trim() === "") {
    return UriMatchStrategy.Domain;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) &&
    parsed >= UriMatchStrategy.Domain &&
    parsed <= UriMatchStrategy.Never
    ? parsed as UriMatchStrategySetting
    : UriMatchStrategy.Domain;
}

function parseSavedWebsiteUri(value: string): URL | null {
  const candidate = value.includes("://") ? value : `https://${value}`;
  try {
    const parsed = new URL(candidate);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function normalizedHostname(value: URL): string {
  return value.hostname.toLowerCase().replace(/\.$/, "");
}

function evidence(
  kind: WebsiteEvidenceKind,
  specificity: number,
): WebsiteMatchEvidence {
  return { kind, rank: evidenceRanks[kind], specificity };
}

function uriEvidence(
  saved: VaultUri,
  currentUrl: string,
  current: URL,
): WebsiteMatchEvidence | null {
  const uri = saved.uri.trim();
  if (!uri) {
    return null;
  }
  const matchType = effectiveMatchType(saved.matchType);
  if (matchType === UriMatchStrategy.Never) {
    return null;
  }
  if (matchType === UriMatchStrategy.Exact) {
    return currentUrl === uri ? evidence("exact-url", uri.length) : null;
  }
  if (matchType === UriMatchStrategy.StartsWith) {
    return currentUrl.startsWith(uri) ? evidence("starts-with", uri.length) : null;
  }
  if (matchType === UriMatchStrategy.RegularExpression) {
    try {
      return new RegExp(uri, "i").test(currentUrl)
        ? evidence("regular-expression", uri.length)
        : null;
    } catch {
      return null;
    }
  }

  const view = LoginUriView.fromJSON({ uri, match: matchType });
  if (!view.matchesUri(currentUrl, new Set<string>(), matchType)) {
    return null;
  }
  const savedUrl = parseSavedWebsiteUri(uri);
  if (matchType === UriMatchStrategy.Host) {
    return savedUrl ? evidence("host", savedUrl.host.length) : null;
  }
  if (savedUrl && normalizedHostname(savedUrl) === normalizedHostname(current)) {
    return evidence("full-hostname", normalizedHostname(savedUrl).length);
  }
  return evidence("registrable-domain", view.domain?.length ?? 0);
}

function stronger(
  left: WebsiteMatchEvidence | null,
  right: WebsiteMatchEvidence | null,
): WebsiteMatchEvidence | null {
  if (left === null) {
    return right;
  }
  if (right === null) {
    return left;
  }
  return right.rank > left.rank ||
    (right.rank === left.rank && right.specificity > left.specificity)
    ? right
    : left;
}

function strongestEvidence(
  item: VaultItem,
  currentUrl: string,
  current: URL,
): WebsiteMatchEvidence | null {
  return item.uris.reduce<WebsiteMatchEvidence | null>(
    (best, uri) => stronger(best, uriEvidence(uri, currentUrl, current)),
    null,
  );
}

function compareRanked(left: RankedWebsiteItem, right: RankedWebsiteItem): number {
  return right.evidence.rank - left.evidence.rank ||
    right.evidence.specificity - left.evidence.specificity ||
    Number(right.item.favorite) - Number(left.item.favorite) ||
    left.item.name.localeCompare(right.item.name) ||
    left.item.id.localeCompare(right.item.id);
}

export function rankWebsiteSuggestions(
  items: readonly VaultItem[],
  currentUrl: string,
  limit = 5,
): readonly VaultItem[] {
  let current: URL;
  try {
    current = new URL(currentUrl);
  } catch {
    return [];
  }
  if ((current.protocol !== "http:" && current.protocol !== "https:") || !current.hostname) {
    return [];
  }

  const candidates = new Map<string, RankedWebsiteItem>();
  for (const item of items) {
    if (item.type !== "login") {
      continue;
    }
    const match = strongestEvidence(item, current.href, current);
    if (match === null) {
      continue;
    }
    const existing = candidates.get(item.id);
    if (!existing || stronger(existing.evidence, match) === match) {
      candidates.set(item.id, { item, evidence: match });
    }
  }

  return [...candidates.values()]
    .sort(compareRanked)
    .slice(0, Math.max(0, Math.floor(limit)))
    .map(({ item }) => item);
}
