import { Inject, Injectable, InjectionToken, Optional } from "@angular/core";

import { ACCOUNT_SESSION_PORT, type AccountSessionPort } from "../../auth/account-session-port";
import { createDefaultHostService } from "../../host/default-host.service";
import { BitwardenSdkCore } from "../../sdk/bitwarden-sdk-core.service";
import { GeneratorHistoryStore, type GeneratedCredential } from "./generator-history.store";
import {
  OfficialGeneratorEngine,
  type PassphraseGenerationOptions,
  type PasswordGenerationOptions,
  type UsernameGenerationOptions,
} from "./official-generator-engine";
import {
  type GeneratorMode,
  type GeneratorSettingsSnapshot,
} from "./generator-runtime.port";

export type { GeneratorMode, GeneratorSettingsSnapshot } from "./generator-runtime.port";
export { GENERATOR_CLIPBOARD_HOST } from "./generator-runtime.port";

export type { GeneratedCredential } from "./generator-history.store";

export const GENERATOR_HISTORY_STORE = new InjectionToken<GeneratorHistoryStore>("GENERATOR_HISTORY_STORE", {
  providedIn: "root",
  factory: () => new GeneratorHistoryStore(createDefaultHostService()),
});

export const OFFICIAL_GENERATOR_ENGINE = new InjectionToken<OfficialGeneratorEngine>(
  "OFFICIAL_GENERATOR_ENGINE",
  {
    providedIn: "root",
    factory: () => new OfficialGeneratorEngine(new BitwardenSdkCore()),
  },
);

const SETTINGS_KEY_PREFIX = "barwarden.generator-settings.";

const DEFAULT_SETTINGS: GeneratorSettingsSnapshot = {
  password: {
    length: 14,
    ambiguous: true,
    uppercase: true,
    minUppercase: 1,
    lowercase: true,
    minLowercase: 1,
    number: true,
    minNumber: 1,
    special: false,
    minSpecial: 0,
  },
  passphrase: {
    numWords: 6,
    wordSeparator: "-",
    capitalize: false,
    includeNumber: false,
  },
  username: {
    type: "word",
    wordCapitalize: false,
    wordIncludeNumber: false,
    subaddressEmail: "",
    catchallDomain: "",
  },
};

@Injectable({ providedIn: "root" })
export class GeneratorService {
  private readonly historyStore: GeneratorHistoryStore;
  private readonly engine: OfficialGeneratorEngine;

  constructor(
    @Optional() @Inject(GENERATOR_HISTORY_STORE) historyStore: GeneratorHistoryStore | null = null,
    @Optional() @Inject(OFFICIAL_GENERATOR_ENGINE) engine: OfficialGeneratorEngine | null = null,
    @Optional() @Inject(ACCOUNT_SESSION_PORT) private readonly accountStore: AccountSessionPort | null = null,
  ) {
    this.historyStore = historyStore ?? new GeneratorHistoryStore(createDefaultHostService());
    this.engine = engine ?? new OfficialGeneratorEngine(new BitwardenSdkCore());
  }

  async generate(
    mode: GeneratorMode,
    isCurrent: () => boolean | Promise<boolean> = () => true,
  ): Promise<GeneratedCredential> {
    const accountId = await this.activeAccountId();
    const settings = this.settings(accountId);
    const generationDate = new Date();
    const credential = await this.generateOfficialCredential(mode, settings, generationDate);
    await this.assertActiveUnlockedOwnership(accountId);
    await this.assertOperationOwnership(isCurrent);
    const pendingHistory = await this.historyStore.prepareTrack(
      accountId,
      credential,
      () => this.hasActiveUnlockedOwnership(accountId).then(async (active) => (
        active && await retainsOperationOwnership(isCurrent)
      )),
    );
    try {
      await this.assertActiveUnlockedOwnership(accountId);
      await this.assertOperationOwnership(isCurrent);
      pendingHistory.commit();
    } catch (error) {
      await pendingHistory.rollback();
      throw error;
    }
    return credential;
  }

  async activeSettings(): Promise<{ readonly accountId: string; readonly settings: GeneratorSettingsSnapshot }> {
    const accountId = await this.activeAccountId();
    return { accountId, settings: this.settings(accountId) };
  }

  async history(
    requestedAccountId?: string,
    isCurrent: () => Promise<boolean> = async () => true,
  ): Promise<readonly GeneratedCredential[]> {
    const accountId = requestedAccountId ?? await this.activeAccountId();
    await this.assertHistoryOwnership(accountId, isCurrent);
    const credentials = await this.historyStore.credentials(accountId);
    await this.assertHistoryOwnership(accountId, isCurrent);
    return credentials;
  }

  async clearHistory(
    requestedAccountId?: string,
    isCurrent: () => Promise<boolean> = async () => true,
  ): Promise<void> {
    const accountId = requestedAccountId ?? await this.activeAccountId();
    await this.assertHistoryOwnership(accountId, isCurrent);
    const pending = await this.historyStore.prepareClear(
      accountId,
      () => this.hasHistoryOwnership(accountId, isCurrent),
    );
    try {
      await this.assertHistoryOwnership(accountId, isCurrent);
      pending.commit();
    } catch (error) {
      await pending.rollback();
      throw error;
    }
  }

  settings(accountId: string): GeneratorSettingsSnapshot {
    const raw = globalThis.localStorage?.getItem(generatorSettingsStorageKey(accountId));
    if (!raw) {
      return cloneSettings(DEFAULT_SETTINGS);
    }

    try {
      return normalizeSettings(JSON.parse(raw) as unknown);
    } catch {
      return cloneSettings(DEFAULT_SETTINGS);
    }
  }

  updatePasswordSettings(
    accountId: string,
    patch: Partial<PasswordGenerationOptions>,
  ): GeneratorSettingsSnapshot {
    const current = this.settings(accountId);
    return this.persistSettings(accountId, normalizeSettings({ ...current, password: { ...current.password, ...patch } }));
  }

  updatePassphraseSettings(
    accountId: string,
    patch: Partial<PassphraseGenerationOptions>,
  ): GeneratorSettingsSnapshot {
    const current = this.settings(accountId);
    return this.persistSettings(accountId, normalizeSettings({ ...current, passphrase: { ...current.passphrase, ...patch } }));
  }

  updateUsernameSettings(
    accountId: string,
    patch: Partial<UsernameGenerationOptions>,
  ): GeneratorSettingsSnapshot {
    const current = this.settings(accountId);
    return this.persistSettings(accountId, normalizeSettings({ ...current, username: { ...current.username, ...patch } }));
  }

  private async activeAccountId(): Promise<string> {
    if (!this.accountStore) {
      throw new Error("No active account is available");
    }

    try {
      const account = (await this.accountStore.list()).find((candidate) => candidate.isActive) ?? null;
      if (!account) {
        throw new Error("No active account is available");
      }
      if (account.status !== "unlocked") {
        throw new Error("Active account is locked");
      }
      return account.id;
    } catch (error) {
      if (
        error instanceof Error
        && (error.message === "No active account is available" || error.message === "Active account is locked")
      ) {
        throw error;
      }
      throw new Error("Unable to resolve the active generator account");
    }
  }

  private async hasActiveUnlockedOwnership(accountId: string): Promise<boolean> {
    try {
      return await this.activeAccountId() === accountId;
    } catch {
      return false;
    }
  }

  private async assertActiveUnlockedOwnership(accountId: string): Promise<void> {
    if (!await this.hasActiveUnlockedOwnership(accountId)) {
      throw new Error("Generator account changed or locked during generation");
    }
  }

  private async assertOperationOwnership(
    isCurrent: () => boolean | Promise<boolean>,
  ): Promise<void> {
    if (!await retainsOperationOwnership(isCurrent)) {
      throw new Error("Generator operation is no longer current");
    }
  }

  private async hasHistoryOwnership(
    accountId: string,
    isCurrent: () => Promise<boolean>,
  ): Promise<boolean> {
    return await this.hasActiveUnlockedOwnership(accountId) && await isCurrent();
  }

  private async assertHistoryOwnership(
    accountId: string,
    isCurrent: () => Promise<boolean>,
  ): Promise<void> {
    if (!await this.hasHistoryOwnership(accountId, isCurrent)) {
      throw new Error("Generator account changed or locked during history operation");
    }
  }

  private async generateOfficialCredential(
    mode: GeneratorMode,
    settings: GeneratorSettingsSnapshot,
    generationDate: Date,
  ): Promise<GeneratedCredential> {
    switch (mode) {
      case "password":
        return {
          credential: await this.engine.generatePassword(settings.password),
          category: "password",
          generationDate,
          algorithm: "password",
        };
      case "passphrase":
        return {
          credential: await this.engine.generatePassphrase(settings.passphrase),
          category: "password",
          generationDate,
          algorithm: "passphrase",
        };
      case "username":
        return {
          credential: await this.engine.generateUsername(settings.username),
          category: "username",
          generationDate,
          algorithm: "username",
        };
    }
  }

  private persistSettings(accountId: string, settings: GeneratorSettingsSnapshot): GeneratorSettingsSnapshot {
    const snapshot = cloneSettings(settings);
    globalThis.localStorage?.setItem(generatorSettingsStorageKey(accountId), JSON.stringify(snapshot));
    return snapshot;
  }
}

async function retainsOperationOwnership(
  isCurrent: () => boolean | Promise<boolean>,
): Promise<boolean> {
  try {
    return await isCurrent();
  } catch {
    return false;
  }
}

function normalizeSettings(value: unknown): GeneratorSettingsSnapshot {
  const source = isRecord(value) ? value : {};
  const password = isRecord(source["password"]) ? source["password"] : {};
  const passphrase = isRecord(source["passphrase"]) ? source["passphrase"] : {};
  const username = isRecord(source["username"]) ? source["username"] : {};

  const requestedPassword = {
    length: boundedNumber(password["length"], DEFAULT_SETTINGS.password.length, 5, 128),
    ambiguous: booleanValue(password["ambiguous"], DEFAULT_SETTINGS.password.ambiguous),
    uppercase: booleanValue(password["uppercase"], DEFAULT_SETTINGS.password.uppercase),
    minUppercase: boundedNumber(password["minUppercase"], DEFAULT_SETTINGS.password.minUppercase, 0, 9),
    lowercase: booleanValue(password["lowercase"], DEFAULT_SETTINGS.password.lowercase),
    minLowercase: boundedNumber(password["minLowercase"], DEFAULT_SETTINGS.password.minLowercase, 0, 9),
    number: booleanValue(password["number"], DEFAULT_SETTINGS.password.number),
    minNumber: boundedNumber(password["minNumber"], DEFAULT_SETTINGS.password.minNumber, 0, 9),
    special: booleanValue(password["special"], DEFAULT_SETTINGS.password.special),
    minSpecial: boundedNumber(password["minSpecial"], DEFAULT_SETTINGS.password.minSpecial, 0, 9),
  };
  const hasEnabledClass = requestedPassword.uppercase || requestedPassword.lowercase || requestedPassword.number || requestedPassword.special;
  const uppercase = hasEnabledClass ? requestedPassword.uppercase : true;
  const lowercase = hasEnabledClass ? requestedPassword.lowercase : true;
  const number = requestedPassword.number;
  const special = requestedPassword.special;
  const minUppercase = hasEnabledClass ? minimumForClass(uppercase, requestedPassword.minUppercase) : 1;
  const minLowercase = hasEnabledClass ? minimumForClass(lowercase, requestedPassword.minLowercase) : 1;
  const minNumber = minimumForClass(number, requestedPassword.minNumber);
  const minSpecial = minimumForClass(special, requestedPassword.minSpecial);
  const length = Math.min(
    128,
    Math.max(5, requestedPassword.length, minUppercase + minLowercase + minNumber + minSpecial),
  );

  return {
    password: {
      length,
      ambiguous: requestedPassword.ambiguous,
      uppercase,
      minUppercase,
      lowercase,
      minLowercase,
      number,
      minNumber,
      special,
      minSpecial,
    },
    passphrase: {
      numWords: boundedNumber(passphrase["numWords"], DEFAULT_SETTINGS.passphrase.numWords, 3, 20),
      wordSeparator:
        typeof passphrase["wordSeparator"] === "string"
          ? passphrase["wordSeparator"].slice(0, 1)
          : DEFAULT_SETTINGS.passphrase.wordSeparator,
      capitalize: booleanValue(passphrase["capitalize"], DEFAULT_SETTINGS.passphrase.capitalize),
      includeNumber: booleanValue(passphrase["includeNumber"], DEFAULT_SETTINGS.passphrase.includeNumber),
    },
    username: {
      type: usernameType(username["type"]),
      wordCapitalize: booleanValue(username["wordCapitalize"], DEFAULT_SETTINGS.username.wordCapitalize),
      wordIncludeNumber: booleanValue(
        username["wordIncludeNumber"],
        DEFAULT_SETTINGS.username.wordIncludeNumber,
      ),
      subaddressEmail: stringValue(username["subaddressEmail"], 320),
      catchallDomain: stringValue(username["catchallDomain"], 253),
    },
  };
}

function cloneSettings(settings: GeneratorSettingsSnapshot): GeneratorSettingsSnapshot {
  return {
    password: { ...settings.password },
    passphrase: { ...settings.passphrase },
    username: { ...settings.username },
  };
}

export function generatorSettingsStorageKey(accountId: string): string {
  return `${SETTINGS_KEY_PREFIX}${encodeURIComponent(accountId)}`;
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(Math.max(Math.trunc(value), min), max)
    : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function usernameType(value: unknown): Required<UsernameGenerationOptions>["type"] {
  return value === "subaddress" || value === "catchall" ? value : "word";
}

function stringValue(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function minimumForClass(enabled: boolean, value: number): number {
  return enabled ? Math.max(1, value) : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
