import type { Routes } from "@angular/router";

import { LockPageComponent } from "./auth/lock-page.component";
import { LoginPageComponent } from "./auth/login-page.component";
import { NewDeviceVerificationPageComponent } from "./auth/new-device-verification-page.component";
import { PasswordHintPageComponent } from "./auth/password-hint-page.component";
import { TwoFactorPageComponent } from "./auth/two-factor-page.component";
import {
  knownAccountGuard,
  newDeviceChallengeGuard,
  twoFactorChallengeGuard,
  unlockedOnlyGuard,
} from "./auth/auth-route-access";
import { GeneratorHistoryPageComponent } from "./generator/generator-history-page.component";
import { GeneratorPageComponent } from "./generator/generator-page.component";
import { PopupShellComponent } from "./popup-shell/popup-shell.component";
import { SendAddEditPageComponent } from "./send/send-add-edit-page.component";
import { SendCreatedPageComponent } from "./send/send-created-page.component";
import { SendPageComponent } from "./send/send-page.component";
import { OfficialAccountSwitcherComponent } from "./upstream-overlays/auth/account-switching/official-account-switcher.component";
import { AccountSecurityPageComponent } from "./settings/account-security-page.component";
import { AboutPageComponent } from "./settings/about-page.component";
import { AppearancePageComponent } from "./settings/appearance-page.component";
import { AutofillSettingsPageComponent } from "./settings/autofill-settings-page.component";
import { AutoFillPickerComponent } from "./autofill/autofill-picker.component";
import { KeyboardShortcutPageComponent } from "./settings/keyboard-shortcut-page.component";
import { SettingsPageComponent } from "./settings/settings-page.component";
import { SettingsPasswordPageComponent } from "./settings/settings-password-page.component";
import { ThirdPartyLicensesPageComponent } from "./settings/third-party-licenses-page.component";
import { ThirdPartyNoticesPageComponent } from "./settings/third-party-notices-page.component";
import { VaultSettingsPageComponent } from "./settings/vault-settings-page.component";
import { ArchivePageComponent } from "./vault/archive-page.component";
import { FoldersPageComponent } from "./vault/folders-page.component";
import { NewItemPageComponent } from "./vault/new-item-page.component";
import { TrashPageComponent } from "./vault/trash-page.component";
import { VaultAddEditPageComponent } from "./vault/vault-add-edit-page.component";
import { VaultItemDetailPageComponent } from "./vault/vault-item-detail-page.component";
import { VaultListPageComponent } from "./vault/vault-list-page.component";
import { VaultPasswordHistoryPageComponent } from "./vault/vault-password-history-page.component";
import { OtpPageComponent } from "./vault/otp-page.component";

export const retainedPopupRouteGraph = [
  "/tabs/vault",
  "/tabs/otp",
  "/tabs/generator",
  "/tabs/send",
  "/tabs/settings",
  "/vault-settings",
  "/account-security",
  "/settings-password",
  "/autofill",
  "/keyboard-shortcut",
  "/appearance",
  "/new-item",
  "/folders",
  "/archive",
  "/trash",
  "/generator-history",
  "/add-send",
  "/about",
  "/third-party-notices",
  "/third-party-licenses",
] as const;

export type RetainedPopupRoute = (typeof retainedPopupRouteGraph)[number];

export const routes: Routes = [
  { path: "login", component: LoginPageComponent },
  { path: "lock", component: LockPageComponent, canMatch: [knownAccountGuard] },
  { path: "2fa", component: TwoFactorPageComponent, canMatch: [twoFactorChallengeGuard] },
  {
    path: "new-device-verification",
    component: NewDeviceVerificationPageComponent,
    canMatch: [newDeviceChallengeGuard],
  },
  { path: "hint", component: PasswordHintPageComponent },
  {
    path: "tabs",
    component: PopupShellComponent,
    canMatch: [unlockedOnlyGuard],
    children: [
      { path: "vault", component: VaultListPageComponent },
      { path: "otp", component: OtpPageComponent },
      { path: "generator", component: GeneratorPageComponent },
      { path: "send", component: SendPageComponent },
      { path: "settings", component: SettingsPageComponent },
      { path: "", pathMatch: "full", redirectTo: "vault" },
    ],
  },
  {
    path: "account-switcher",
    component: OfficialAccountSwitcherComponent,
    canMatch: [knownAccountGuard],
    data: { state: "account-switcher" },
  },
  { path: "vault-settings", component: VaultSettingsPageComponent, canMatch: [unlockedOnlyGuard] },
  { path: "account-security", component: AccountSecurityPageComponent, canMatch: [unlockedOnlyGuard] },
  {
    path: "settings-password",
    component: SettingsPasswordPageComponent,
    canMatch: [unlockedOnlyGuard],
  },
  { path: "autofill", component: AutofillSettingsPageComponent, canMatch: [unlockedOnlyGuard] },
  { path: "autofill-picker", component: AutoFillPickerComponent },
  {
    path: "keyboard-shortcut",
    component: KeyboardShortcutPageComponent,
    canMatch: [unlockedOnlyGuard],
  },
  { path: "appearance", component: AppearancePageComponent, canMatch: [unlockedOnlyGuard] },
  { path: "new-item", component: NewItemPageComponent, canMatch: [unlockedOnlyGuard] },
  {
    path: "folders",
    component: FoldersPageComponent,
    canMatch: [unlockedOnlyGuard],
  },
  {
    path: "archive",
    component: ArchivePageComponent,
    canMatch: [unlockedOnlyGuard],
  },
  {
    path: "trash",
    component: TrashPageComponent,
    canMatch: [unlockedOnlyGuard],
  },
  { path: "view-cipher/:id", component: VaultItemDetailPageComponent, canMatch: [unlockedOnlyGuard] },
  { path: "add-cipher", component: VaultAddEditPageComponent, canMatch: [unlockedOnlyGuard] },
  { path: "edit-cipher", component: VaultAddEditPageComponent, canMatch: [unlockedOnlyGuard] },
  { path: "clone-cipher", component: VaultAddEditPageComponent, canMatch: [unlockedOnlyGuard] },
  { path: "cipher-password-history", component: VaultPasswordHistoryPageComponent, canMatch: [unlockedOnlyGuard] },
  { path: "generator-history", component: GeneratorHistoryPageComponent, canMatch: [unlockedOnlyGuard] },
  { path: "add-send", component: SendAddEditPageComponent, canMatch: [unlockedOnlyGuard] },
  { path: "edit-send", component: SendAddEditPageComponent, canMatch: [unlockedOnlyGuard] },
  { path: "send-created", component: SendCreatedPageComponent, canMatch: [unlockedOnlyGuard] },
  { path: "about", component: AboutPageComponent, canMatch: [unlockedOnlyGuard] },
  {
    path: "third-party-notices",
    component: ThirdPartyNoticesPageComponent,
    canMatch: [unlockedOnlyGuard],
  },
  {
    path: "third-party-licenses",
    component: ThirdPartyLicensesPageComponent,
    canMatch: [unlockedOnlyGuard],
  },
  { path: "", pathMatch: "full", redirectTo: "login" },
  { path: "**", redirectTo: "login" },
];
