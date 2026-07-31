import { CommonModule } from "@angular/common";
import { Component, DestroyRef, OnInit, inject } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { combineLatest, map, of } from "rxjs";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { DialogService } from "@bitwarden/components";
import { CurrentAccountComponent } from "@bitwarden/official-auth-popup/account-switching/current-account.component";
import { PopOutComponent } from "@bitwarden/browser-popup/components/pop-out.component";
import { I18nPipe } from "@bitwarden/ui-common";

import {
  OfficialAccountSwitcherAdapter,
  type ActiveAccountAuthorization,
} from "../../../auth/official-account-switcher.adapter";
import type { StoredAccount } from "../../../../auth/account-session-store";
import { PopupHeaderComponent } from "../../../layout/popup-header.component";
import { PopupPageComponent } from "../../../layout/popup-page.component";
import {
  CalloutComponent,
  IconComponent,
  ItemComponent,
  ItemContentComponent,
  SectionComponent,
  SectionHeaderComponent,
  TypographyDirective,
} from "../../../official-ui/official-components";
import {
  OfficialAccountComponent,
  type OfficialAvailableAccount,
} from "./official-account.component";

const SPECIAL_ADD_ACCOUNT_ID = "addAccount";

@Component({
  selector: "bw-official-account-switcher",
  host: { class: "macos-page macos-page--secondary macos-page--account-switcher" },
  standalone: true,
  templateUrl: "./official-account-switcher.component.html",
  imports: [
    CommonModule,
    JslibModule,
    CalloutComponent,
    IconComponent,
    ItemComponent,
    ItemContentComponent,
    I18nPipe,
    PopupPageComponent,
    PopupHeaderComponent,
    PopOutComponent,
    CurrentAccountComponent,
    OfficialAccountComponent,
    SectionComponent,
    SectionHeaderComponent,
    TypographyDirective,
  ],
})
export class OfficialAccountSwitcherComponent implements OnInit {
  readonly lockedStatus = "locked";
  readonly enableAccountSwitching$ = of(true);
  readonly activeUserCanLock = true;
  loading = false;
  readonly error$ = this.accountSwitcher.error$;
  readonly currentAccount$ = this.accountSwitcher.activeAccount$;
  readonly currentAuthorization$ = this.accountSwitcher.activeAuthorization$;
  readonly availableAccounts$ = combineLatest([
    this.accountSwitcher.accounts$,
    this.accountSwitcher.activeAuthorization$,
  ]).pipe(
    map(([accounts, authorization]) =>
      presentAvailableAccounts(accounts, authorization, this.accountLimit),
    ),
  );
  readonly showLockAll$ = this.accountSwitcher.accounts$.pipe(
    map((accounts) => accounts.length > 1),
  );

  constructor(
    private readonly accountSwitcher: OfficialAccountSwitcherAdapter,
    private readonly dialogService: DialogService,
  ) {
    const destroyRef = inject(DestroyRef);
    this.accountSwitcher.loading$
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((loading) => {
        this.loading = loading;
      });
  }

  get accountLimit(): number {
    return OfficialAccountSwitcherAdapter.ACCOUNT_LIMIT;
  }

  get specialAddAccountId(): string {
    return SPECIAL_ADD_ACCOUNT_ID;
  }

  ngOnInit(): void {
    void this.accountSwitcher.refresh().catch(() => undefined);
  }

  async lock(userId: string): Promise<void> {
    try {
      await this.accountSwitcher.lock(userId);
    } catch {
      // The adapter publishes only fixed feedback and owns navigation settlement.
    }
  }

  async lockAll(): Promise<void> {
    try {
      await this.accountSwitcher.lockAll();
    } catch {
      // The adapter publishes only fixed feedback and owns navigation settlement.
    }
  }

  async recover(userId: string): Promise<void> {
    try {
      await this.accountSwitcher.select(userId);
    } catch {
      // The adapter publishes fixed recovery feedback.
    }
  }

  async logOut(userId: string): Promise<void> {
    const confirmed = await this.dialogService.openSimpleDialog({
      title: { key: "logOut" },
      content: { key: "logOutConfirmation" },
      type: "info",
    });
    if (!confirmed) {
      return;
    }

    try {
      await this.accountSwitcher.logout(userId);
    } catch {
      // The adapter publishes only fixed feedback and owns navigation settlement.
    }
  }
}

function serverHost(serverUrl: string): string {
  try {
    return new URL(serverUrl).host;
  } catch {
    return "";
  }
}

export function presentAvailableAccounts(
  accounts: readonly StoredAccount[],
  activeAuthorization: ActiveAccountAuthorization,
  accountLimit: number,
): readonly OfficialAvailableAccount[] {
  const availableAccounts: OfficialAvailableAccount[] = accounts.map((account) => ({
    id: account.id,
    name: account.email,
    email: account.email,
    server: serverHost(account.serverUrl),
    status: account.isActive ? activeAuthorizationStatus(activeAuthorization) : account.status,
    isActive: account.isActive,
    avatarColor: "#175DDC",
  }));
  if (accounts.length < accountLimit) {
    availableAccounts.push({
      id: SPECIAL_ADD_ACCOUNT_ID,
      name: "addAccount",
      isActive: false,
    });
  }
  return availableAccounts;
}

function activeAuthorizationStatus(
  authorization: ActiveAccountAuthorization,
): OfficialAvailableAccount["status"] {
  switch (authorization) {
    case "unlocked":
      return "unlocked";
    case "recovery-required":
      return "recovery-required";
    case "locked":
    case "signed-out":
      return "locked";
  }
}
