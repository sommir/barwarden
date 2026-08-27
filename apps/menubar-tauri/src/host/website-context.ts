export type WebsiteContextUnavailableReason =
  | "no-target"
  | "not-browser"
  | "permission-denied"
  | "no-active-tab"
  | "invalid-url"
  | "timeout"
  | "browser-unavailable"
  | "stale";

export type CapturedWebsiteContext =
  | {
      readonly status: "available";
      readonly generation: number;
      readonly browserBundleId: string;
      readonly url: string;
    }
  | {
      readonly status: "unavailable";
      readonly generation: number;
      readonly reason: WebsiteContextUnavailableReason;
    };

export interface WebsiteContextHost {
  capturedWebsiteContext(): Promise<CapturedWebsiteContext>;
}

export class WebsiteContextHostError extends Error {
  override readonly name = "WebsiteContextHostError";

  constructor(readonly code: "invalid-response" | "unavailable") {
    super("Website context unavailable.");
  }
}

const unavailableReasons = new Set<WebsiteContextUnavailableReason>([
  "no-target",
  "not-browser",
  "permission-denied",
  "no-active-tab",
  "invalid-url",
  "timeout",
  "browser-unavailable",
  "stale",
]);

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new WebsiteContextHostError("invalid-response");
  }
  return value as Record<string, unknown>;
}

function generation(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new WebsiteContextHostError("invalid-response");
  }
  return Number(value);
}

function websiteUrl(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || new TextEncoder().encode(value).length > 8192) {
    throw new WebsiteContextHostError("invalid-response");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new WebsiteContextHostError("invalid-response");
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.hostname.length === 0) {
    throw new WebsiteContextHostError("invalid-response");
  }
  return parsed.href;
}

export function decodeCapturedWebsiteContext(value: unknown): CapturedWebsiteContext {
  const input = record(value);
  const captureGeneration = generation(input["generation"]);
  if (input["status"] === "available") {
    if (typeof input["browserBundleId"] !== "string" || input["browserBundleId"].trim().length === 0) {
      throw new WebsiteContextHostError("invalid-response");
    }
    return {
      status: "available",
      generation: captureGeneration,
      browserBundleId: input["browserBundleId"],
      url: websiteUrl(input["url"]),
    };
  }
  if (input["status"] === "unavailable" && unavailableReasons.has(input["reason"] as WebsiteContextUnavailableReason)) {
    return {
      status: "unavailable",
      generation: captureGeneration,
      reason: input["reason"] as WebsiteContextUnavailableReason,
    };
  }
  throw new WebsiteContextHostError("invalid-response");
}
