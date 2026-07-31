import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from "@angular/core";

import {
  BitIconButtonComponent,
  ItemActionComponent,
  ItemComponent,
  ItemContentComponent,
} from "../../official-ui/official-components";
import type { VaultField, VaultItem } from "../../vault-demo";
import { I18nPipe } from "../../official-ui/official-ui-common";
import {
  resolveRetainedPopupCipherSource,
  type RetainedVaultListCipherView,
} from "../../vault/popup-cipher-view.adapter";
import { VaultItemIconComponent } from "../../vault/vault-item-icon.component";
import {
  ItemMoreOptionsComponent,
  type ItemMenuOpenChange,
} from "./item-more-options.component";

@Component({
  selector: "app-retained-vault-list-item",
  standalone: true,
  imports: [
    BitIconButtonComponent,
    I18nPipe,
    ItemActionComponent,
    ItemComponent,
    ItemContentComponent,
    ItemMoreOptionsComponent,
    VaultItemIconComponent,
  ],
  templateUrl: "./retained-vault-list-item.component.html",
  host: { class: "tw-contents" },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RetainedVaultListItemComponent {
  private currentCipher!: RetainedVaultListCipherView;
  protected source: VaultItem | undefined;
  protected usernameField: VaultField | undefined;
  protected passwordField: VaultField | undefined;
  protected otpField: VaultField | undefined;

  @Input({ required: true })
  set cipher(cipher: RetainedVaultListCipherView) {
    this.currentCipher = cipher;
    this.source = resolveRetainedPopupCipherSource(cipher);
    this.usernameField = retainedField(cipher, "username");
    this.passwordField = retainedField(cipher, "password");
    this.otpField = retainedField(cipher, "otp");
  }
  get cipher(): RetainedVaultListCipherView {
    return this.currentCipher;
  }
  @Input({ required: true }) sectionId!: string;
  @Input() openMenuRowId: string | null = null;
  @Input() showQuickCopyActions = true;
  @Output() view = new EventEmitter<VaultItem>();
  @Output() fill = new EventEmitter<VaultRowFieldAction>();
  @Output() edit = new EventEmitter<VaultItem>();
  @Output() clone = new EventEmitter<VaultItem>();
  @Output() launch = new EventEmitter<VaultItem>();
  @Output() toggleFavorite = new EventEmitter<VaultItem>();
  @Output() archive = new EventEmitter<VaultItem>();
  @Output() delete = new EventEmitter<VaultItem>();
  @Output() menuOpenChange = new EventEmitter<ItemMenuOpenChange>();

  protected get menuOpen(): boolean {
    return this.openMenuRowId === `${this.sectionId}:${this.cipher.id}`;
  }

  protected fillField(field: VaultField, trigger: Event): void {
    const source = this.source;
    if (source) {
      this.fill.emit({ item: source, field, trigger });
    }
  }

  protected emitItem(output: EventEmitter<VaultItem>): void {
    const source = this.source;
    if (source) {
      output.emit(source);
    }
  }

  protected launchCipher(): void {
    if (this.cipher.canLaunch && this.cipher.uri) {
      const source = this.source;
      if (source) {
        this.launch.emit(source);
      }
    }
  }

  protected selectCipher(): void {
    const source = this.source;
    if (source) {
      this.view.emit(source);
    }
  }
}

function retainedField(
  cipher: RetainedVaultListCipherView,
  fieldId: string,
): VaultField | undefined {
  return cipher.fields.find((field) => field.id === fieldId && field.value.length > 0);
}

export interface VaultRowFieldAction {
  readonly item: VaultItem;
  readonly field: VaultField;
  readonly trigger: Event;
}
