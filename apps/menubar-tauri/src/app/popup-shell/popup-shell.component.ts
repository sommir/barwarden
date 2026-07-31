import { Component } from "@angular/core";
import { RouterOutlet } from "@angular/router";

import { BARWARDEN_BRAND } from "../brand";
import { PopupStateStore } from "../popup-state";
import { FloatingTabSwitcherComponent, type FloatingTab } from "./floating-tab-switcher.component";

@Component({
  selector: "bw-popup-shell",
  standalone: true,
  imports: [FloatingTabSwitcherComponent, RouterOutlet],
  template: `
    <section class="popup-shell" [attr.aria-label]="productName">
      <div class="popup-tab-scroll-host" data-testid="popup-shell-scroll-region" tabindex="0">
        <router-outlet />
      </div>
      <bw-floating-tab-switcher [tabs]="tabs" />
    </section>
  `,
})
export class PopupShellComponent {
  readonly productName = BARWARDEN_BRAND.productName;

  constructor(private readonly store: PopupStateStore) {}

  protected get tabs(): readonly FloatingTab[] {
    return [
      {
        label: "Vault",
        translationKey: "vault",
        path: "/tabs/vault",
        icon: "bwi-vault",
      },
      {
        label: "OTP",
        path: "/tabs/otp",
        icon: "bwi-clock",
      },
      {
        label: "Generator",
        translationKey: "generator",
        path: "/tabs/generator",
        icon: "bwi-generate",
      },
      ...(this.store.snapshot().isSendDisabled
        ? []
        : [
            {
              label: "Send",
              path: "/tabs/send",
              icon: "bwi-send",
            },
          ]),
      {
        label: "Settings",
        translationKey: "settings",
        path: "/tabs/settings",
        icon: "bwi-settings",
      },
    ] as const;
  }

}
