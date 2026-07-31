declare module "@bitwarden/angular/jslib.module" {
  export class JslibModule {}
}

declare module "@bitwarden/auth/angular" {
  export class FingerprintDialogComponent {
    static open(
      dialogService: import("@bitwarden/components").DialogService,
      data: { fingerprint: string },
    ): { closed: import("rxjs").Observable<unknown> };
  }
}

declare module "@bitwarden/common/auth/abstractions/account.service" {
  export interface Account {
    id: string;
  }

  export class AccountService {
    activeAccount$: import("rxjs").Observable<Account | null>;
  }
}

declare module "@bitwarden/common/auth/services/account.service" {
  export function getUserId(
    source: import("rxjs").Observable<
      import("@bitwarden/common/auth/abstractions/account.service").Account | null
    >,
  ): import("rxjs").Observable<string>;
}

declare module "@bitwarden/common/autofill/services/domain-settings.service" {
  export class DomainSettingsService {
    showFavicons$: import("rxjs").Observable<boolean>;
    setShowFavicons(enabled: boolean): Promise<void>;
  }
}

declare module "@bitwarden/common/platform/abstractions/animation-control.service" {
  export class AnimationControlService {
    enableRoutingAnimation$: import("rxjs").Observable<boolean>;
    setEnableRoutingAnimation(enabled: boolean): Promise<void>;
  }
}

declare module "@bitwarden/common/platform/abstractions/config/config.service" {
  export interface ServerConfig {
    version: string;
    utcDate: Date;
    server?: { name: string };
    isValid(): boolean;
  }

  export class ConfigService {
    serverConfig$: import("rxjs").Observable<ServerConfig>;
  }
}

declare module "@bitwarden/common/platform/abstractions/environment.service" {
  export interface Environment {
    getWebVaultUrl(): string;
    isCloud(): boolean;
  }

  export class EnvironmentService {
    environment$: import("rxjs").Observable<Environment>;
  }
}

declare module "@bitwarden/common/platform/abstractions/i18n.service" {
  export class I18nService {
    t(key: string, ...parameters: unknown[]): string;
  }
}

declare module "@bitwarden/common/platform/abstractions/log.service" {
  export class LogService {
    error(message: string): void;
  }
}

declare module "@bitwarden/common/platform/abstractions/platform-utils.service" {
  export class PlatformUtilsService {
    copyToClipboard(value: string): void;
    getApplicationVersion(): Promise<string>;
    launchUri(uri: string): void;
  }
}

declare module "@bitwarden/common/platform/abstractions/sdk/sdk.service" {
  export class SdkService {
    version$: import("rxjs").Observable<string>;
  }
}

declare module "@bitwarden/common/platform/enums" {
  export type Theme = "system" | "light" | "dark";
  export const ThemeTypes: {
    readonly System: Theme;
    readonly Light: Theme;
    readonly Dark: Theme;
  };
}

declare module "@bitwarden/common/platform/theming/theme-state.service" {
  export class ThemeStateService {
    selectedTheme$: import("rxjs").Observable<import("@bitwarden/common/platform/enums").Theme>;
    setSelectedTheme(theme: import("@bitwarden/common/platform/enums").Theme): Promise<void>;
  }
}

declare module "@bitwarden/common/vault/abstractions/sync/sync.service.abstraction" {
  export class SyncService {
    fullSync(force: boolean): Promise<boolean>;
    getLastSync(): Promise<Date | null>;
  }
}

declare module "@bitwarden/components" {
  export class ButtonModule {}
  export class CardComponent {}
  export class CenterPositionStrategy {}
  export class CheckboxModule {}
  export class DialogModule {}
  export class FormFieldModule {}
  export class ItemModule {}
  export class SectionComponent {}
  export class SectionHeaderComponent {}
  export class SelectModule {}
  export class SpinnerComponent {}
  export class TypographyModule {}

  export interface Option<T> {
    label: string;
    value: T;
  }

  export interface ToastOptions {
    message: string;
    title?: string | null;
    variant: "success" | "error";
  }

  export class ToastService {
    showToast(options: ToastOptions): void;
  }

  export class DialogRef<T = unknown> {
    close(value?: T): Promise<void>;
  }

  export class DialogService {
    open<T>(component: new (...parameters: never[]) => T, options: Record<string, unknown>): void;
    openSimpleDialog(options: Record<string, unknown>): Promise<boolean>;
  }
}

declare module "@bitwarden/key-management" {
  export class KeyService {
    userPublicKey$(userId: string): import("rxjs").Observable<unknown | null>;
    getFingerprint(userId: string, publicKey: unknown): Promise<string>;
  }
}

declare module "@bitwarden/key-management-ui" {
  export class SessionTimeoutSettingsComponent {}
}

declare module "@bitwarden/logging-angular" {
  export class TroubleshootingDialogComponent {
    static open(dialogService: import("@bitwarden/components").DialogService): void;
  }
}

declare module "@bitwarden/ui-common" {
  export class I18nPipe {}
}

declare module "@bitwarden/vault" {
  export class PermitCipherDetailsPopoverComponent {}
}
