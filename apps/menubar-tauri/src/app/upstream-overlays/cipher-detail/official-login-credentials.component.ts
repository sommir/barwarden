import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from "@angular/core";

import { I18nPipe } from "@bitwarden/ui-common";
import { CardComponent } from "@bitwarden/components/card/card.component";
import { BitLabelComponent } from "@bitwarden/components/form-control/label.component";
import { BitFormFieldComponent } from "@bitwarden/components/form-field/form-field.component";
import { BitSuffixDirective } from "@bitwarden/components/form-field/suffix.directive";
import { BitIconButtonComponent } from "@bitwarden/components/icon-button/icon-button.component";
import { BitInputDirective } from "@bitwarden/components/input/input.directive";
import { SectionHeaderComponent } from "@bitwarden/components/section/section-header.component";
import { TypographyDirective } from "@bitwarden/components/typography/typography.directive";
import { TotpService } from "@bitwarden/common/vault/abstractions/totp.service";

import type { VaultField } from "../../vault/vault-item.model";
import type { OfficialLoginDetailProjection } from "../../vault/login-cipher-view.adapter";
import { OfficialTotpServiceAdapter } from "../../vault/official-totp.service.adapter";
import { OfficialColorPasswordComponent } from "./official-color-password.component";
import { BitTotpCountdownComponent } from "./official-totp-countdown.component";

interface TotpCodeValues {
  readonly totpCode: string;
  readonly totpCodeFormatted?: string;
}

export interface LoginRevealRequest {
  readonly fieldId: string;
  readonly trigger: HTMLElement;
}

/** Guarded Login-only transform of pinned LoginCredentialsViewComponent. */
@Component({
  selector: "official-login-credentials",
  standalone: true,
  imports: [
    BitFormFieldComponent,
    BitIconButtonComponent,
    BitInputDirective,
    BitLabelComponent,
    BitSuffixDirective,
    CardComponent,
    OfficialColorPasswordComponent,
    I18nPipe,
    SectionHeaderComponent,
    TypographyDirective,
    BitTotpCountdownComponent,
  ],
  providers: [{ provide: TotpService, useClass: OfficialTotpServiceAdapter }],
  templateUrl: "./official-login-credentials.component.html",
})
export class OfficialLoginCredentialsComponent implements OnChanges {
  @Input({ required: true }) projection!: OfficialLoginDetailProjection;
  @Input() canFill = false;
  @Input() revealedFieldIds: ReadonlySet<string> = new Set();
  @Output() copyField = new EventEmitter<VaultField>();
  @Output() fillField = new EventEmitter<VaultField>();
  @Output() toggleReveal = new EventEmitter<LoginRevealRequest>();

  showPasswordCount = false;
  totpCodeCopyObj: TotpCodeValues | undefined;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["projection"]) {
      this.showPasswordCount = false;
      this.totpCodeCopyObj = undefined;
    }
  }

  get usernameField(): VaultField | undefined {
    return this.projection.actionFields.get("username");
  }

  get passwordField(): VaultField | undefined {
    return this.projection.actionFields.get("password");
  }

  get otpField(): VaultField | undefined {
    return this.projection.actionFields.get("otp");
  }

  isRevealed(fieldId: string): boolean {
    return this.revealedFieldIds.has(fieldId);
  }

  togglePasswordCount(): void {
    this.showPasswordCount = !this.showPasswordCount;
  }

  requestReveal(fieldId: string, event: Event): void {
    if (event.currentTarget instanceof HTMLElement) {
      this.toggleReveal.emit({ fieldId, trigger: event.currentTarget });
    }
  }

  setTotpCopyCode(value: TotpCodeValues): void {
    this.totpCodeCopyObj = value;
  }
}
