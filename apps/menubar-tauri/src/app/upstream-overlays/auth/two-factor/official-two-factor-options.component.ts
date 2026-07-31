import { CommonModule } from "@angular/common";
import { ChangeDetectorRef, Component, ElementRef, EventEmitter, Output, ViewChild } from "@angular/core";

import { TwoFactorAuthAuthenticatorIcon, TwoFactorAuthEmailIcon } from "@bitwarden/assets/svg";
import { SvgModule } from "@bitwarden/components";
import { I18nPipe } from "@bitwarden/ui-common";

import type { RetainedTwoFactorProvider } from "../../../auth/official-challenge.adapter";
import { AppBottomSheetComponent } from "../../../official-ui/app-bottom-sheet.component";
import {
  ButtonComponent,
  DialogComponent,
  DialogFooterDirective,
  ItemComponent,
  ItemContentComponent,
  ItemGroupComponent,
  TypographyDirective,
} from "../../../official-ui/official-components";
import { translateOfficialMessage } from "../../../official-ui/official-i18n.service";

export interface RetainedTwoFactorOption {
  readonly type: RetainedTwoFactorProvider;
  readonly name: string;
  readonly description: string;
}

/** Guarded official provider-options dialog limited statically to Authenticator and Email. */
@Component({
  selector: "bw-official-two-factor-options",
  standalone: true,
  imports: [
    AppBottomSheetComponent,
    ButtonComponent,
    CommonModule,
    DialogComponent,
    DialogFooterDirective,
    I18nPipe,
    ItemComponent,
    ItemContentComponent,
    ItemGroupComponent,
    SvgModule,
    TypographyDirective,
  ],
  templateUrl: "./official-two-factor-options.component.html",
})
export class OfficialTwoFactorOptionsComponent {
  @Output() readonly chosen = new EventEmitter<RetainedTwoFactorProvider>();
  @ViewChild("dialog") private dialog?: AppBottomSheetComponent;
  @ViewChild("firstOption", { read: ElementRef }) private firstOption?: ElementRef<HTMLButtonElement>;

  readonly icons = {
    authenticator: TwoFactorAuthAuthenticatorIcon,
    email: TwoFactorAuthEmailIcon,
  };
  providers: readonly RetainedTwoFactorOption[] = [];
  isOpen = false;

  constructor(
    private readonly changeDetectorRef: ChangeDetectorRef,
  ) {}

  open(trigger: HTMLElement, providers: readonly RetainedTwoFactorProvider[]): void {
    this.providers = providers.map((type) => type === 0
      ? {
          type,
          name: translateOfficialMessage("authenticatorAppTitle"),
          description: translateOfficialMessage("i18nTwoFactorAppDescription"),
        }
      : {
          type,
          name: translateOfficialMessage("email"),
          description: translateOfficialMessage("i18nTwoFactorEmailDescription"),
        });
    this.isOpen = true;
    this.changeDetectorRef.detectChanges();
    if (this.dialog && this.firstOption?.nativeElement) {
      this.dialog.open(trigger, this.firstOption.nativeElement);
    }
  }

  choose(provider: RetainedTwoFactorProvider): void {
    this.close();
    this.chosen.emit(provider);
  }

  cancel(): void {
    this.close();
  }

  onDismissed(): void {
    this.isOpen = false;
  }

  onClose(): void {
    this.isOpen = false;
  }

  private close(): void {
    this.isOpen = false;
    this.dialog?.close();
  }
}
