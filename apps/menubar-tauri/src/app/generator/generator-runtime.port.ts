import { InjectionToken } from "@angular/core";
import type { Observable } from "rxjs";

import type { HostApi } from "../../host/host-api";

export type GeneratorMode = "password" | "passphrase" | "username";

export type GeneratorSettingsSnapshot = {
  readonly password: {
    readonly length: number;
    readonly ambiguous: boolean;
    readonly uppercase: boolean;
    readonly minUppercase: number;
    readonly lowercase: boolean;
    readonly minLowercase: number;
    readonly number: boolean;
    readonly minNumber: number;
    readonly special: boolean;
    readonly minSpecial: number;
  };
  readonly passphrase: {
    readonly numWords: number;
    readonly wordSeparator: string;
    readonly capitalize: boolean;
    readonly includeNumber: boolean;
  };
  readonly username: {
    readonly type: "word" | "subaddress" | "catchall";
    readonly wordCapitalize: boolean;
    readonly wordIncludeNumber: boolean;
    readonly subaddressEmail: string;
    readonly catchallDomain: string;
  };
};

export interface GeneratorRuntimePort {
  activeSettings(): Promise<{ readonly accountId: string; readonly settings: GeneratorSettingsSnapshot }>;
  generate(
    mode: GeneratorMode,
    isCurrent?: () => boolean | Promise<boolean>,
  ): Promise<{ readonly credential: string }>;
  updatePasswordSettings(
    accountId: string,
    settings: GeneratorSettingsSnapshot["password"],
  ): GeneratorSettingsSnapshot | Promise<GeneratorSettingsSnapshot>;
  updatePassphraseSettings(
    accountId: string,
    settings: GeneratorSettingsSnapshot["passphrase"],
  ): GeneratorSettingsSnapshot | Promise<GeneratorSettingsSnapshot>;
  updateUsernameSettings(
    accountId: string,
    settings: GeneratorSettingsSnapshot["username"],
  ): GeneratorSettingsSnapshot | Promise<GeneratorSettingsSnapshot>;
}

export interface GeneratorClipboardPolicyPort {
  copy(value: string, host?: HostApi | null): Promise<void>;
}

export interface GeneratorStatusPort {
  readonly state$: Observable<{ readonly isUnlocked: boolean }>;
  snapshot(): { readonly email: string };
  setStatus(message: string): void;
}

export interface GeneratorOwnershipStatePort {
  snapshot(): {
    readonly activeSession: object | null;
    readonly isUnlocked: boolean;
  };
}

export interface GeneratorOperationReceiptPort {
  begin(): () => void;
}

export const GENERATOR_RUNTIME = new InjectionToken<GeneratorRuntimePort>("GENERATOR_RUNTIME");
export const GENERATOR_CLIPBOARD_POLICY = new InjectionToken<GeneratorClipboardPolicyPort>(
  "GENERATOR_CLIPBOARD_POLICY",
);
export const GENERATOR_STATUS = new InjectionToken<GeneratorStatusPort>("GENERATOR_STATUS");
export const GENERATOR_OWNERSHIP_STATE = new InjectionToken<GeneratorOwnershipStatePort>(
  "GENERATOR_OWNERSHIP_STATE",
);
export const GENERATOR_OPERATION_RECEIPT = new InjectionToken<GeneratorOperationReceiptPort | null>(
  "GENERATOR_OPERATION_RECEIPT",
  { providedIn: "root", factory: () => null },
);
export const GENERATOR_CLIPBOARD_HOST = new InjectionToken<HostApi | null>("GENERATOR_CLIPBOARD_HOST", {
  providedIn: "root",
  factory: () => null,
});
