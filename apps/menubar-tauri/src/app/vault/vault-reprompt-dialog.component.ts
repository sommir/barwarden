import { Component, ElementRef, OnDestroy, ViewChild } from "@angular/core";
import { DialogModule as CdkDialogModule } from "@angular/cdk/dialog";

import {
  BitFormFieldComponent,
  BitIconButtonComponent,
  BitInputDirective,
  BitLabelComponent,
  BitPasswordInputToggleDirective,
  BitSuffixDirective,
  ButtonComponent,
  DialogComponent,
  DialogFooterDirective,
} from "../official-ui/official-components";
import { AppBottomSheetComponent } from "../official-ui/app-bottom-sheet.component";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";
import { I18nPipe } from "../official-ui/official-ui-common";
import { PopupStateStore } from "../popup-state";
import { VaultRepromptError, VaultRepromptService } from "./vault-reprompt.service";

type ProtectedContinuation = () => void | Promise<void>;

@Component({
  selector: "bw-vault-reprompt-dialog",
  standalone: true,
  imports: [
    AppBottomSheetComponent,
    BitFormFieldComponent,
    BitIconButtonComponent,
    BitInputDirective,
    BitLabelComponent,
    BitPasswordInputToggleDirective,
    BitSuffixDirective,
    ButtonComponent,
    CdkDialogModule,
    DialogComponent,
    DialogFooterDirective,
    I18nPipe,
  ],
  template: `
    <bw-app-bottom-sheet
      #dialog
      labelledBy="vault-reprompt-title"
      describedBy="vault-reprompt-description"
      testId="vault-reprompt-dialog"
      (dismissed)="cancel()"
      (click)="onDialogClick($event)"
    >
      <form bit-dialog dialogSize="small" (submit)="onSubmit($event)">
        <span bitDialogTitle id="vault-reprompt-title">{{ "i18nConfirmMasterPassword" | i18n }}</span>
        <ng-container bitDialogContent>
          <p id="vault-reprompt-description">{{ "i18nVaultRepromptDescription" | i18n }}</p>

          <bit-form-field disableMargin class="tw-mt-6">
            <bit-label>{{ "masterPass" | i18n }}</bit-label>
            <input
              #passwordInput
              bitInput
              type="password"
              autocomplete="current-password"
              [value]="masterPassword"
              [disabled]="busy"
              (input)="masterPassword = inputValue($event)"
            />
            <button type="button" bitSuffix bitIconButton bitPasswordInputToggle></button>
          </bit-form-field>

          @if (errorMessage) {
            <p class="tw-text-danger tw-mt-3" role="alert">{{ errorMessage }}</p>
          }
        </ng-container>

        <ng-container bitDialogFooter>
          <button bitButton buttonType="primary" type="submit" [disabled]="busy">
            {{ busy ? ("i18nVerifying" | i18n) : ("i18nConfirm" | i18n) }}
          </button>
          <button bitButton buttonType="secondary" type="button" [disabled]="busy" (click)="cancel()">
            {{ "cancel" | i18n }}
          </button>
        </ng-container>
      </form>
    </bw-app-bottom-sheet>
  `,
})
export class VaultRepromptDialogComponent implements OnDestroy {
  @ViewChild("dialog") private dialog?: AppBottomSheetComponent;
  @ViewChild("passwordInput") private passwordInput?: ElementRef<HTMLInputElement>;

  masterPassword = "";
  errorMessage = "";
  busy = false;
  operationEpoch = 0;
  private continuation: ProtectedContinuation | null = null;
  private itemId = "";

  constructor(
    private readonly reprompt: VaultRepromptService,
    private readonly store: PopupStateStore,
  ) {}

  openFor(
    itemId: string,
    continuation: ProtectedContinuation,
    trigger?: HTMLElement,
  ): void {
    this.clearTransientState();
    this.itemId = itemId;
    this.continuation = continuation;
    this.operationEpoch = this.store.beginProtectedOperation();
    if (!this.dialog) {
      return;
    }
    this.dialog.open(trigger, this.passwordInput?.nativeElement);
  }

  async submit(): Promise<void> {
    if (this.busy || !this.continuation || !this.itemId) {
      return;
    }

    const masterPassword = this.masterPassword;
    const continuation = this.continuation;
    const epoch = this.operationEpoch;
    this.busy = true;
    this.errorMessage = "";
    let verified = false;
    try {
      verified = await this.reprompt.verify(masterPassword, epoch);
    } catch (error) {
      if (this.store.isCurrentProtectedOperation(epoch)) {
        this.errorMessage = error instanceof VaultRepromptError
          ? error.message
          : translateOfficialMessage("i18nUnableToVerifyMasterPassword");
      } else {
        this.close(false);
      }
      return;
    } finally {
      this.busy = false;
      this.clearPassword();
    }

    if (!verified || !this.store.isCurrentProtectedOperation(epoch)) {
      this.close(false);
      return;
    }

    this.close(false);
    await continuation();
  }

  cancel(): void {
    this.close(true);
  }

  onDialogClick(event: Event): void {
    const target = event.target;
    if (target instanceof Element && target.closest("button")?.querySelector(".bwi-close")) {
      this.cancel();
    }
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    void this.submit().catch(() => {
      this.store.setStatus(translateOfficialMessage("i18nUnableToCompleteOperation"));
    });
  }

  ngOnDestroy(): void {
    this.close(true);
  }

  inputValue(event: Event): string {
    return event.target instanceof HTMLInputElement ? event.target.value : "";
  }

  private close(cancelOperation: boolean): void {
    if (cancelOperation) {
      this.store.cancelProtectedOperations();
    }
    this.dialog?.close();
    this.clearTransientState();
  }

  private clearTransientState(): void {
    this.clearPassword();
    this.errorMessage = "";
    this.itemId = "";
    this.continuation = null;
  }

  private clearPassword(): void {
    this.masterPassword = "";
    if (this.passwordInput) {
      this.passwordInput.nativeElement.value = "";
    }
  }
}
