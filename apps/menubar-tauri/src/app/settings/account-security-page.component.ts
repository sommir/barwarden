import {
  ChangeDetectorRef,
  Component,
  Inject,
  OnInit,
  Optional,
  ViewChild,
} from "@angular/core";

import type { AuthSession } from "../../auth/auth-session-store";
import { AuthFacade } from "../auth/auth.facade";
import {
  AlternativeUnlockError,
  UNLOCK_METHODS_PORT,
  type UnlockMethodAvailability,
  type UnlockMethodsPort,
} from "../auth/unlock-methods.port";
import { VaultTimeoutService } from "../auth/vault-timeout.service";
import { PopupStateStore } from "../popup-state";
import { OfficialAccountSecurityComponent } from "../upstream-overlays/settings/official-account-security.component";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";
import { VaultRepromptDialogComponent } from "../vault/vault-reprompt-dialog.component";
import { EnvironmentHandoffService, twoStepLoginHelpUrl } from "./environment-handoff.service";
import { PinSetupDialogComponent } from "./pin-setup-dialog.component";
import type { RetainedSettingsActions } from "./settings-actions.port";
import { SettingsService } from "./settings.service";
import { PopupRouterCacheService } from "../platform/popup-router-cache.service";

type SetupContext = {
  readonly accountId: string;
  readonly session: AuthSession;
};

type PendingPinSetup = SetupContext & {
  readonly operationEpoch: number;
};

const DEFAULT_UNLOCK_AVAILABILITY: UnlockMethodAvailability = {
  pinEnabled: false,
  biometricEnabled: false,
  biometricAvailability: "not-available",
};

@Component({
  selector: "bw-account-security-page",
  host: { class: "macos-page macos-page--secondary macos-page--settings-detail" },
  standalone: true,
  imports: [
    OfficialAccountSecurityComponent,
    PinSetupDialogComponent,
    VaultRepromptDialogComponent,
  ],
  template: `
    <bw-official-account-security
      [settings]="settings"
      [handoffError]="handoffError"
      [unlockMethodError]="unlockMethodError"
      [pinEnabled]="pinEnabled"
      [biometricEnabled]="biometricEnabled"
      [biometricAvailable]="biometricAvailable"
      [biometricUnavailableReason]="biometricUnavailableReason"
      [unlockMethodBusy]="unlockMethodBusy"
      (back)="back()"
      (vaultTimeoutMinutesChange)="setVaultTimeoutMinutes($event)"
      (vaultTimeoutActionChange)="setVaultTimeoutAction($event)"
      (openTwoStepLogin)="openTwoStepLogin()"
      (openChangePassword)="openChangePassword()"
      (pinEnabledChange)="setPinEnabled($event)"
      (biometricEnabledChange)="setBiometricEnabled($event)"
    />
    <bw-vault-reprompt-dialog #repromptDialog />
    <bw-pin-setup-dialog
      #pinSetupDialog
      (pinConfirmed)="completePinSetup($event)"
    />
  `,
})
export class AccountSecurityPageComponent implements OnInit {
  @ViewChild("repromptDialog")
  private repromptDialog?: VaultRepromptDialogComponent;
  @ViewChild("pinSetupDialog")
  private pinSetupDialog?: PinSetupDialogComponent;

  handoffError = "";
  unlockMethodError = "";
  unlockMethodBusy = false;
  pinEnabled = false;
  biometricEnabled = false;
  biometricAvailable = false;
  biometricUnavailableReason = "";
  private activeAccountId: string | null = null;
  private pendingPinSetup: PendingPinSetup | null = null;

  constructor(
    private readonly settingsService: SettingsService,
    private readonly routeCache: PopupRouterCacheService,
    private readonly handoff: EnvironmentHandoffService,
    private readonly vaultTimeout: VaultTimeoutService,
    private readonly auth: AuthFacade,
    private readonly store: PopupStateStore,
    @Inject(UNLOCK_METHODS_PORT)
    private readonly unlockMethods: UnlockMethodsPort | null,
    @Optional()
    private readonly changeDetectorRef: ChangeDetectorRef | null = null,
  ) {}

  async ngOnInit(): Promise<void> {
    await this.refreshUnlockAvailability();
  }

  get settings() {
    return this.settingsService.snapshot();
  }

  async back(): Promise<void> {
    await this.routeCache.back();
  }

  readonly setVaultTimeoutMinutes: RetainedSettingsActions["setVaultTimeoutMinutes"] = (value) => {
    if (this.settingsService.setVaultTimeoutMinutes(value)) {
      this.vaultTimeout.reschedule();
    }
  };

  readonly setVaultTimeoutAction: RetainedSettingsActions["setVaultTimeoutAction"] = (value) =>
    this.settingsService.setVaultTimeoutAction(value);

  async openTwoStepLogin(): Promise<void> {
    await this.openHandoff(() => this.handoff.openExternal(twoStepLoginHelpUrl));
  }

  async openChangePassword(): Promise<void> {
    await this.openHandoff(() => this.handoff.openWebVault("/#/settings/security/password"));
  }

  requestEnablePin(): void {
    const context = this.currentSetupContext();
    if (this.unlockMethodBusy || !context || !this.repromptDialog) {
      return;
    }
    this.unlockMethodError = "";
    let operationEpoch = 0;
    this.repromptDialog.openFor("enable-runtime-pin", async () => {
      if (!await this.isCurrentSetupContext(context, operationEpoch)) {
        this.failChangedContext();
        return;
      }
      this.pendingPinSetup = { ...context, operationEpoch };
      this.pinSetupDialog?.open();
    });
    operationEpoch = this.repromptDialog.operationEpoch;
  }

  setPinEnabled(enabled: boolean): void {
    if (enabled) {
      this.requestEnablePin();
      return;
    }
    this.disablePin();
  }

  async completePinSetup(pin: string): Promise<void> {
    const pending = this.pendingPinSetup;
    this.pendingPinSetup = null;
    if (this.unlockMethodBusy || !pending || !this.unlockMethods) {
      pin = "";
      return;
    }
    if (!await this.isCurrentSetupContext(pending, pending.operationEpoch)) {
      pin = "";
      this.failChangedContext();
      return;
    }

    this.unlockMethodBusy = true;
    this.unlockMethodError = "";
    try {
      await this.unlockMethods.enablePin(pending.accountId, pin, pending.session);
      if (!await this.isCurrentSetupContext(pending, pending.operationEpoch)) {
        await this.unlockMethods.disablePin(pending.accountId);
        this.failChangedContext();
        return;
      }
      this.pinEnabled = true;
    } catch {
      this.unlockMethodError = translateOfficialMessage("i18nUnableToSetPin");
    } finally {
      pin = "";
      this.unlockMethodBusy = false;
      this.changeDetectorRef?.detectChanges();
    }
  }

  disablePin(): void {
    const context = this.currentSetupContext();
    if (this.unlockMethodBusy || !context || !this.unlockMethods) {
      return;
    }
    void this.disablePinForContext(context);
  }

  requestEnableBiometric(): void {
    const context = this.currentSetupContext();
    if (this.unlockMethodBusy || !context || !this.repromptDialog) {
      return;
    }
    this.unlockMethodError = "";
    let operationEpoch = 0;
    this.repromptDialog.openFor("enable-touch-id", async () => {
      if (!await this.isCurrentSetupContext(context, operationEpoch)) {
        this.failChangedContext();
        return;
      }
      await this.enableBiometric(context, operationEpoch);
    });
    operationEpoch = this.repromptDialog.operationEpoch;
  }

  setBiometricEnabled(enabled: boolean): void {
    if (enabled) {
      this.requestEnableBiometric();
      return;
    }
    void this.disableBiometric();
  }

  async disableBiometric(): Promise<void> {
    const context = this.currentSetupContext();
    if (
      this.unlockMethodBusy
      || !context
      || !this.unlockMethods
      || !await this.isCurrentUnlockedContext(context)
    ) {
      return;
    }
    this.unlockMethodBusy = true;
    this.unlockMethodError = "";
    try {
      await this.unlockMethods.disableBiometric(context.accountId);
      this.biometricEnabled = false;
    } catch {
      this.unlockMethodError = translateOfficialMessage("i18nUnableToDisableTouchId");
    } finally {
      this.unlockMethodBusy = false;
      this.changeDetectorRef?.detectChanges();
    }
  }

  private async openHandoff(action: () => Promise<void>): Promise<void> {
    this.handoffError = "";
    try {
      await action();
    } catch {
      this.handoffError = translateOfficialMessage("i18nUnableToOpenLink");
    }
  }

  private async enableBiometric(
    context: SetupContext,
    operationEpoch: number,
  ): Promise<void> {
    if (!this.unlockMethods) {
      return;
    }
    this.unlockMethodBusy = true;
    this.unlockMethodError = "";
    try {
      await this.unlockMethods.enableBiometric(context.accountId);
      if (!await this.isCurrentSetupContext(context, operationEpoch)) {
        try {
          await this.unlockMethods.disableBiometric(context.accountId);
        } catch {
          this.biometricEnabled = true;
          this.unlockMethodError = translateOfficialMessage("i18nTouchIdCleanupFailed");
          return;
        }
        this.failChangedContext();
        return;
      }
      this.biometricEnabled = true;
      this.biometricAvailable = true;
      this.biometricUnavailableReason = "";
    } catch (error) {
      this.biometricEnabled = false;
      this.unlockMethodError = biometricSetupError(error);
    } finally {
      this.unlockMethodBusy = false;
      this.changeDetectorRef?.detectChanges();
    }
  }

  private async refreshUnlockAvailability(): Promise<void> {
    this.activeAccountId = null;
    let activeAccount: Awaited<ReturnType<AuthFacade["accounts"]>>[number] | undefined;
    try {
      activeAccount = (await this.auth.accounts()).find((account) => account.isActive);
    } catch {
      this.applyUnlockAvailability(DEFAULT_UNLOCK_AVAILABILITY);
      this.unlockMethodError = translateOfficialMessage("i18nUnableToReadUnlockOptions");
      return;
    }
    const snapshot = this.store.snapshot();
    if (!activeAccount || !snapshot.isUnlocked || !snapshot.activeSession) {
      this.applyUnlockAvailability(DEFAULT_UNLOCK_AVAILABILITY);
      return;
    }
    this.activeAccountId = activeAccount.id;
    if (!this.unlockMethods) {
      this.applyUnlockAvailability(DEFAULT_UNLOCK_AVAILABILITY);
      return;
    }
    try {
      this.applyUnlockAvailability(
        await this.unlockMethods.availability(activeAccount.id),
      );
    } catch {
      this.applyUnlockAvailability(DEFAULT_UNLOCK_AVAILABILITY);
      this.unlockMethodError = translateOfficialMessage("i18nUnableToReadUnlockOptions");
    }
  }

  private applyUnlockAvailability(availability: UnlockMethodAvailability): void {
    this.pinEnabled = availability.pinEnabled;
    this.biometricEnabled = availability.biometricEnabled;
    this.biometricAvailable = availability.biometricAvailability === "available";
    this.biometricUnavailableReason =
      biometricAvailabilityReason(availability.biometricAvailability);
  }

  private currentSetupContext(): SetupContext | null {
    const snapshot = this.store.snapshot();
    if (
      !this.activeAccountId
      || !snapshot.isUnlocked
      || !snapshot.activeSession
    ) {
      return null;
    }
    return {
      accountId: this.activeAccountId,
      session: snapshot.activeSession,
    };
  }

  private async isCurrentSetupContext(
    context: SetupContext,
    operationEpoch: number,
  ): Promise<boolean> {
    return (
      this.store.isCurrentProtectedOperation(operationEpoch)
      && await this.isCurrentUnlockedContext(context)
    );
  }

  private async disablePinForContext(context: SetupContext): Promise<void> {
    if (!this.unlockMethods || !await this.isCurrentUnlockedContext(context)) {
      return;
    }
    await this.unlockMethods.disablePin(context.accountId);
    this.pinEnabled = false;
    this.unlockMethodError = "";
  }

  private async isCurrentUnlockedContext(context: SetupContext): Promise<boolean> {
    const before = this.store.snapshot();
    if (
      !before.isUnlocked
      || before.activeSession !== context.session
      || this.activeAccountId !== context.accountId
      || !await this.isActiveAccount(context.accountId)
    ) {
      return false;
    }
    const after = this.store.snapshot();
    return after.isUnlocked && after.activeSession === context.session;
  }

  private async isActiveAccount(accountId: string): Promise<boolean> {
    try {
      return (await this.auth.accounts())
        .some((account) => account.isActive && account.id === accountId);
    } catch {
      return false;
    }
  }

  private failChangedContext(): void {
    this.pendingPinSetup = null;
    this.unlockMethodError = translateOfficialMessage("i18nAccountChangedReverify");
  }
}

function biometricAvailabilityReason(
  availability: UnlockMethodAvailability["biometricAvailability"],
): string {
  switch (availability) {
    case "available":
      return "";
    case "not-enrolled":
      return translateOfficialMessage("i18nTouchIdNotEnrolled");
    case "locked-out":
      return translateOfficialMessage("i18nTouchIdLocked");
    case "not-available":
    case "invalid-account":
      return translateOfficialMessage("i18nTouchIdNotAvailableMac");
  }
}

function biometricSetupError(error: unknown): string {
  if (!(error instanceof AlternativeUnlockError)) {
    return translateOfficialMessage("i18nUnableToEnableTouchId");
  }
  switch (error.code) {
    case "biometric-cancelled":
      return "";
    case "biometric-unavailable":
    case "biometric-invalidated":
      return translateOfficialMessage("i18nTouchIdCheckSettings");
    default:
      return translateOfficialMessage("i18nUnableToEnableTouchId");
  }
}
