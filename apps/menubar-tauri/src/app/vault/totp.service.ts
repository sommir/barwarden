export interface TotpConfiguration {
  readonly secret: Uint8Array;
  readonly algorithm: "SHA-1" | "SHA-256" | "SHA-512";
  readonly digits: 6 | 8;
  readonly period: number;
}

export interface TotpCode {
  readonly code: string;
  readonly formattedCode: string;
  readonly period: number;
  readonly secondsRemaining: number;
  readonly isExpiring: boolean;
}

const DEFAULT_PERIOD = 30;
const DEFAULT_DIGITS: TotpConfiguration["digits"] = 6;
const DEFAULT_ALGORITHM: TotpConfiguration["algorithm"] = "SHA-1";

export function parseTotpSeed(seed: string): TotpConfiguration | null {
  const value = seed.trim();
  if (!value) {
    return null;
  }

  let secret = value;
  let algorithm = DEFAULT_ALGORITHM;
  let digits = DEFAULT_DIGITS;
  let period = DEFAULT_PERIOD;

  if (value.toLowerCase().startsWith("otpauth:")) {
    let uri: URL;
    try {
      uri = new URL(value);
    } catch {
      return null;
    }

    if (uri.protocol !== "otpauth:" || uri.hostname.toLowerCase() !== "totp") {
      return null;
    }

    secret = uri.searchParams.get("secret") ?? "";
    algorithm = parseAlgorithm(uri.searchParams.get("algorithm")) ?? DEFAULT_ALGORITHM;
    digits = parseDigits(uri.searchParams.get("digits")) ?? DEFAULT_DIGITS;
    period = parsePeriod(uri.searchParams.get("period")) ?? DEFAULT_PERIOD;

    if (!secret || !parseAlgorithmValue(uri.searchParams.get("algorithm")) || !parseDigitsValue(uri.searchParams.get("digits")) || !parsePeriodValue(uri.searchParams.get("period"))) {
      return null;
    }
  }

  const decodedSecret = decodeBase32(secret);
  return decodedSecret ? { secret: decodedSecret, algorithm, digits, period } : null;
}

export async function generateTotpCode(seed: string, epochSeconds: number): Promise<TotpCode> {
  const config = parseTotpSeed(seed);
  if (!config) {
    throw new Error("Unsupported TOTP seed");
  }

  const counter = Math.floor(epochSeconds / config.period);
  if (!Number.isSafeInteger(counter) || counter < 0) {
    throw new Error("Invalid TOTP time");
  }

  const counterBytes = new Uint8Array(8);
  const view = new DataView(counterBytes.buffer);
  view.setUint32(0, Math.floor(counter / 0x1_0000_0000));
  view.setUint32(4, counter >>> 0);

  const secret = new Uint8Array(config.secret.byteLength);
  secret.set(config.secret);
  const key = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: config.algorithm },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBytes));
  const offset = signature[signature.length - 1] & 0x0f;
  const binary = (
    ((signature[offset] & 0x7f) << 24) |
    (signature[offset + 1] << 16) |
    (signature[offset + 2] << 8) |
    signature[offset + 3]
  ) >>> 0;
  const code = String(binary % (10 ** config.digits)).padStart(config.digits, "0");
  const elapsed = epochSeconds % config.period;
  const secondsRemaining = config.period - elapsed;

  return {
    code,
    formattedCode: formatTotpCode(code),
    period: config.period,
    secondsRemaining,
    isExpiring: secondsRemaining <= 7,
  };
}

export function formatTotpCode(code: string): string {
  if (code.length <= 4) {
    return code;
  }

  const half = Math.floor(code.length / 2);
  return `${code.slice(0, half)} ${code.slice(half)}`;
}

function parseAlgorithm(value: string | null): TotpConfiguration["algorithm"] | null {
  if (!value) {
    return DEFAULT_ALGORITHM;
  }

  switch (value.toUpperCase().replace("-", "")) {
    case "SHA1":
      return "SHA-1";
    case "SHA256":
      return "SHA-256";
    case "SHA512":
      return "SHA-512";
    default:
      return null;
  }
}

function parseAlgorithmValue(value: string | null): boolean {
  return value === null || parseAlgorithm(value) !== null;
}

function parseDigits(value: string | null): 6 | 8 | null {
  if (!value) {
    return DEFAULT_DIGITS;
  }

  return value === "6" ? 6 : value === "8" ? 8 : null;
}

function parseDigitsValue(value: string | null): boolean {
  return value === null || parseDigits(value) !== null;
}

function parsePeriod(value: string | null): number | null {
  if (!value) {
    return DEFAULT_PERIOD;
  }

  const period = Number(value);
  return Number.isSafeInteger(period) && period > 0 ? period : null;
}

function parsePeriodValue(value: string | null): boolean {
  return value === null || parsePeriod(value) !== null;
}

function decodeBase32(value: string): Uint8Array | null {
  const normalized = value.replace(/[\s-]/g, "").toUpperCase();
  const withoutPadding = normalized.replace(/=+$/, "");
  if (!withoutPadding || /[^A-Z2-7]/.test(withoutPadding) || withoutPadding.includes("=")) {
    return null;
  }

  let buffer = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const character of withoutPadding) {
    const alphabetIndex = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(character);
    buffer = (buffer << 5) | alphabetIndex;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return bytes.length > 0 ? new Uint8Array(bytes) : null;
}
