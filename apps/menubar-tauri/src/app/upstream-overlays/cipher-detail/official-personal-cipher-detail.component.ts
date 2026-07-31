import { Component, EventEmitter, HostListener, Input, OnChanges, Output, SimpleChanges } from "@angular/core";

import { isCardExpired } from "@bitwarden/common/autofill/utils";
import { CipherType } from "@bitwarden/common/vault/enums";
import { I18nPipe } from "@bitwarden/ui-common";

import type { VaultField } from "../../vault/vault-item.model";
import type { OfficialPersonalCipherProjection } from "../../vault/personal-cipher-view.adapter";
import { OfficialAdditionalOptionsComponent } from "./official-additional-options.component";
import { OfficialCardDetailsComponent } from "./official-card-details.component";
import { OfficialCustomFieldsComponent } from "./official-custom-fields.component";
import { OfficialIdentitySectionsComponent } from "./official-identity-sections.component";
import { OfficialItemDetailsComponent } from "./official-item-details.component";
import { OfficialItemHistoryComponent } from "./official-item-history.component";
import { MacosAlertStripComponent } from "../../official-ui/macos-alert-strip.component";

@Component({
  selector: "bw-official-personal-cipher-detail",
  standalone: true,
  imports: [
    I18nPipe,
    MacosAlertStripComponent,
    OfficialAdditionalOptionsComponent,
    OfficialCardDetailsComponent,
    OfficialCustomFieldsComponent,
    OfficialIdentitySectionsComponent,
    OfficialItemDetailsComponent,
    OfficialItemHistoryComponent,
  ],
  templateUrl: "./official-personal-cipher-detail.component.html",
})
export class OfficialPersonalCipherDetailComponent implements OnChanges {
  @Input({ required: true }) projection!: OfficialPersonalCipherProjection;
  @Input() canFill = false;
  @Input() set revealedFieldIds(value: ReadonlySet<string>) {
    this.hasExternalRevealedFieldIds = true;
    this.externalRevealedFieldIds = value;
  }
  @Output() copyField = new EventEmitter<VaultField>();
  @Output() fillField = new EventEmitter<VaultField>();
  @Output() toggleReveal = new EventEmitter<string>();
  @Output() viewPasswordHistory = new EventEmitter<void>();

  readonly cipherType = CipherType;
  private readonly localRevealedFieldIds = new Set<string>();
  private externalRevealedFieldIds: ReadonlySet<string> = new Set();
  private hasExternalRevealedFieldIds = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["projection"]) {
      this.localRevealedFieldIds.clear();
    }
  }

  get effectiveRevealedFieldIds(): ReadonlySet<string> {
    return this.hasExternalRevealedFieldIds
      ? this.externalRevealedFieldIds
      : this.localRevealedFieldIds;
  }

  get allowLocalReveal(): boolean {
    return !this.hasExternalRevealedFieldIds;
  }

  get cardIsExpired(): boolean {
    return this.projection.cipher.type === CipherType.Card &&
      isCardExpired(this.projection.cipher.card);
  }

  onToggleReveal(fieldId: string): void {
    if (this.allowLocalReveal) {
      if (this.localRevealedFieldIds.has(fieldId)) {
        this.localRevealedFieldIds.delete(fieldId);
      } else {
        this.localRevealedFieldIds.add(fieldId);
      }
    }
    this.toggleReveal.emit(fieldId);
  }

  @HostListener("copy", ["$event"])
  blockBrowserCopy(event: ClipboardEvent): void {
    event.preventDefault();
  }
}
