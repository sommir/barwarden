import { CommonModule } from "@angular/common";
import { Component, Input } from "@angular/core";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import {
  AvatarComponent,
  IconComponent,
  ItemComponent,
  ItemContentComponent,
} from "../../../official-ui/official-components";
import { OfficialAccountSwitcherAdapter } from "../../../auth/official-account-switcher.adapter";

export type OfficialAvailableAccount = {
  readonly id: string;
  readonly name: string;
  readonly email?: string;
  readonly server?: string;
  readonly status?: "locked" | "unlocked" | "recovery-required";
  readonly isActive: boolean;
  readonly avatarColor?: string;
};

@Component({
  selector: "auth-account",
  standalone: true,
  templateUrl: "./official-account.component.html",
  imports: [
    CommonModule,
    JslibModule,
    AvatarComponent,
    IconComponent,
    ItemComponent,
    ItemContentComponent,
  ],
})
export class OfficialAccountComponent {
  @Input({ required: true }) account!: OfficialAvailableAccount;

  constructor(
    private readonly accountSwitcher: OfficialAccountSwitcherAdapter,
    private readonly i18nService: I18nService,
  ) {}

  get specialAccountAddId(): string {
    return "addAccount";
  }

  async selectAccount(id: string): Promise<void> {
    try {
      if (id === this.specialAccountAddId) {
        await this.accountSwitcher.add();
      } else {
        await this.accountSwitcher.select(id);
      }
    } catch {
      // The adapter publishes only fixed feedback and owns navigation settlement.
    }
  }

  get status(): {
    readonly text: string;
    readonly icon:
      | "bwi-check-circle"
      | "bwi-unlock"
      | "bwi-lock"
      | "bwi-exclamation-triangle";
  } {
    if (this.account.isActive) {
      if (this.account.status === "recovery-required") {
        return {
          text: this.i18nService.t("i18nSessionRestoreRequired"),
          icon: "bwi-exclamation-triangle",
        };
      }
      if (this.account.status === "unlocked") {
        return {
          text: `${this.i18nService.t("active")} · ${this.i18nService.t("unlocked")}`,
          icon: "bwi-unlock",
        };
      }
      return {
        text: `${this.i18nService.t("active")} · ${this.i18nService.t("locked")}`,
        icon: "bwi-lock",
      };
    }

    if (this.account.status === "unlocked") {
      return { text: this.i18nService.t("unlocked"), icon: "bwi-unlock" };
    }

    return { text: this.i18nService.t("locked"), icon: "bwi-lock" };
  }
}
