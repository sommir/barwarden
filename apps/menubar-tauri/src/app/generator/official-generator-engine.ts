import { EFFLongWordList } from "../../../../../vendor/bitwarden-clients/libs/common/src/platform/misc/wordlist";
import type { BitwardenSdkCore } from "../../sdk/bitwarden-sdk-core.service";

type PasswordGeneratorRequest = Parameters<BitwardenSdkCore["generatePassword"]>[0];
type PassphraseGeneratorRequest = Parameters<BitwardenSdkCore["generatePassphrase"]>[0];

export type PasswordGenerationOptions = {
  length?: number;
  ambiguous?: boolean;
  uppercase?: boolean;
  minUppercase?: number;
  lowercase?: boolean;
  minLowercase?: number;
  number?: boolean;
  minNumber?: number;
  special?: boolean;
  minSpecial?: number;
};

export type PassphraseGenerationOptions = {
  numWords?: number;
  wordSeparator?: string;
  capitalize?: boolean;
  includeNumber?: boolean;
};

export type UsernameGenerationOptions = {
  type?: "word" | "subaddress" | "catchall";
  wordCapitalize?: boolean;
  wordIncludeNumber?: boolean;
  subaddressEmail?: string;
  catchallDomain?: string;
};

type OfficialSdkGenerator = Pick<
  BitwardenSdkCore,
  "generatePassword" | "generatePassphrase" | "randomNumber"
>;

const USERNAME_NUMBER_OF_DIGITS = 4;
const EMAIL_RANDOM_LENGTH = 8;
const EMAIL_RANDOM_CHARACTERS = "abcdefghijklmnopqrstuvwxyz1234567890";
const SUBADDRESS_PARSER = /^(?<username>[^@+\s]+)(?<subaddress>\+[^@\s]*)?(?<domain>@[^@\s.]+(?:\.[^@\s.]+)+)$/;
const DOMAIN_PARSER = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** Adapts local generator options to the official SDK generator APIs. */
export class OfficialGeneratorEngine {
  constructor(private readonly sdk: OfficialSdkGenerator) {}

  generatePassword(options: PasswordGenerationOptions): Promise<string> {
    return this.sdk.generatePassword(convertPasswordRequest(options));
  }

  generatePassphrase(options: PassphraseGenerationOptions): Promise<string> {
    return this.sdk.generatePassphrase(convertPassphraseRequest(options));
  }

  async generateUsername(options: UsernameGenerationOptions): Promise<string> {
    if (options.type === "subaddress") {
      return this.generateSubaddress(options.subaddressEmail ?? "");
    }
    if (options.type === "catchall") {
      return this.generateCatchall(options.catchallDomain ?? "");
    }

    const word = EFFLongWordList[await this.sdk.randomNumber(0, EFFLongWordList.length - 1)]!;
    const parts = [options.wordCapitalize ? capitalizeWord(word) : word];

    if (options.wordIncludeNumber) {
      for (let index = 0; index < USERNAME_NUMBER_OF_DIGITS; index += 1) {
        parts.push((await this.sdk.randomNumber(0, 9)).toString());
      }
    }

    return parts.join("");
  }

  private async generateSubaddress(email: string): Promise<string> {
    const normalized = email.trim();
    const parsed = SUBADDRESS_PARSER.exec(normalized);
    if (!parsed?.groups) {
      throw new Error("A valid email address is required");
    }

    const suffix = await this.randomAscii(EMAIL_RANDOM_LENGTH);
    return `${parsed.groups["username"]}${parsed.groups["subaddress"] ?? "+"}${suffix}${parsed.groups["domain"]}`;
  }

  private async generateCatchall(domain: string): Promise<string> {
    const normalized = domain.trim().replace(/^@/, "");
    if (!DOMAIN_PARSER.test(normalized)) {
      throw new Error("A valid catch-all domain is required");
    }

    return `${await this.randomAscii(EMAIL_RANDOM_LENGTH)}@${normalized}`;
  }

  private async randomAscii(length: number): Promise<string> {
    const characters: string[] = [];
    for (let index = 0; index < length; index += 1) {
      const randomIndex = await this.sdk.randomNumber(0, EMAIL_RANDOM_CHARACTERS.length - 1);
      characters.push(EMAIL_RANDOM_CHARACTERS[randomIndex]!);
    }
    return characters.join("");
  }
}

function convertPasswordRequest(options: PasswordGenerationOptions): PasswordGeneratorRequest {
  return {
    lowercase: options.lowercase!,
    uppercase: options.uppercase!,
    numbers: options.number!,
    special: options.special!,
    length: options.length!,
    avoidAmbiguous: !options.ambiguous!,
    minLowercase: options.minLowercase!,
    minUppercase: options.minUppercase!,
    minNumber: options.minNumber!,
    minSpecial: options.minSpecial!,
  };
}

function convertPassphraseRequest(options: PassphraseGenerationOptions): PassphraseGeneratorRequest {
  return {
    numWords: options.numWords!,
    wordSeparator: options.wordSeparator!,
    capitalize: options.capitalize!,
    includeNumber: options.includeNumber!,
  };
}

function capitalizeWord(word: string): string {
  return word.length > 0 ? `${word[0]?.toUpperCase()}${word.slice(1)}` : word;
}
