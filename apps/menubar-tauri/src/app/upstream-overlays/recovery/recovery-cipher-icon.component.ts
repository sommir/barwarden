import { Component, Input } from "@angular/core";

import type { RetainedPopupCipherView } from "../../vault/popup-cipher-view.adapter";

@Component({
  selector: "bw-vault-item-icon",
  standalone: true,
  template: `
    <span
      class="vault-item-icon-slot"
      aria-hidden="true"
      [style.width.px]="28"
      [style.height.px]="28"
    >
      <i [class]="iconClass"></i>
    </span>
  `,
})
export class OfficialRecoveryCipherIconComponent {
  @Input({ required: true }) item!: RetainedPopupCipherView;

  get iconClass(): string {
    return `bwi ${RECOVERY_ICON_CLASSES[this.item.type]}`;
  }
}

const RECOVERY_ICON_CLASSES: Record<RetainedPopupCipherView["type"], string> = {
  login: "bwi-globe",
  card: "bwi-credit-card",
  identity: "bwi-id-card",
  "secure-note": "bwi-sticky-note",
};
