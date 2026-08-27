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
import { ios27RouteData } from "./platform/popup-route-metadata";

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
  {
    path: "login",
    component: LoginPageComponent,
    data: { ...ios27RouteData("auth", "base", false) },
  },
  {
    path: "lock",
    component: LockPageComponent,
    canMatch: [knownAccountGuard],
    data: { ...ios27RouteData("auth", "base", false) },
  },
  {
    path: "2fa",
    component: TwoFactorPageComponent,
    canMatch: [twoFactorChallengeGuard],
    data: { ...ios27RouteData("auth", "secondary", false) },
  },
  {
    path: "new-device-verification",
    component: NewDeviceVerificationPageComponent,
    canMatch: [newDeviceChallengeGuard],
    data: { ...ios27RouteData("auth", "secondary", false) },
  },
  {
    path: "hint",
    component: PasswordHintPageComponent,
    data: { ...ios27RouteData("auth", "secondary", false) },
  },
  {
    path: "tabs",
    component: PopupShellComponent,
    canMatch: [unlockedOnlyGuard],
    data: { ...ios27RouteData("shell", "base", true) },
    children: [
      {
        path: "vault",
        component: VaultListPageComponent,
        data: { ...ios27RouteData("vault", "base", true) },
      },
      {
        path: "otp",
        component: OtpPageComponent,
        data: { ...ios27RouteData("otp", "base", true) },
      },
      {
        path: "generator",
        component: GeneratorPageComponent,
        data: { ...ios27RouteData("generator", "base", true) },
      },
      {
        path: "send",
        component: SendPageComponent,
        data: { ...ios27RouteData("send", "base", true) },
      },
      {
        path: "settings",
        component: SettingsPageComponent,
        data: { ...ios27RouteData("settings", "base", true) },
      },
      { path: "", pathMatch: "full", redirectTo: "vault" },
    ],
  },
  {
    path: "account-switcher",
    component: OfficialAccountSwitcherComponent,
    canMatch: [knownAccountGuard],
    data: { ...ios27RouteData("auth", "secondary", false), state: "account-switcher" },
  },
  {
    path: "vault-settings",
    component: VaultSettingsPageComponent,
    canMatch: [unlockedOnlyGuard],
    data: { ...ios27RouteData("settings", "secondary", false) },
  },
  {
    path: "account-security",
    component: AccountSecurityPageComponent,
    canMatch: [unlockedOnlyGuard],
    data: { ...ios27RouteData("settings", "secondary", false) },
  },
  {
    path: "settings-password",
    component: SettingsPasswordPageComponent,
    canMatch: [unlockedOnlyGuard],
    data: { ...ios27RouteData("settings", "secondary", false) },
  },
  {
    path: "autofill",
    component: AutofillSettingsPageComponent,
    canMatch: [unlockedOnlyGuard],
    data: { ...ios27RouteData("settings", "secondary", false) },
  },
  { path: "autofill-picker", redirectTo: "tabs/vault", pathMatch: "full" },
  {
    path: "keyboard-shortcut",
    component: KeyboardShortcutPageComponent,
    canMatch: [unlockedOnlyGuard],
    data: { ...ios27RouteData("settings", "secondary", false) },
  },
  {
    path: "appearance",
    component: AppearancePageComponent,
    canMatch: [unlockedOnlyGuard],
    data: { ...ios27RouteData("settings", "secondary", false) },
  },
  {
    path: "new-item",
    component: NewItemPageComponent,
    canMatch: [unlockedOnlyGuard],
    data: { ...ios27RouteData("vault", "secondary", false) },
  },
  {
    path: "folders",
    component: FoldersPageComponent,
    canMatch: [unlockedOnlyGuard],
    data: { ...ios27RouteData("vault", "secondary", false) },
  },
  {
    path: "archive",
    component: ArchivePageComponent,
    canMatch: [unlockedOnlyGuard],
    data: { ...ios27RouteData("vault", "secondary", false) },
  },
  {
    path: "trash",
    component: TrashPageComponent,
    canMatch: [unlockedOnlyGuard],
    data: { ...ios27RouteData("vault", "secondary", false) },
  },
  {
    path: "view-cipher/:id",
    component: VaultItemDetailPageComponent,
    canMatch: [unlockedOnlyGuard],
    data: { ...ios27RouteData("vault", "secondary", false) },
  },
  {
    path: "add-cipher",
    component: VaultAddEditPageComponent,
    canMatch: [unlockedOnlyGuard],
    data: { ...ios27RouteData("vault", "secondary", false) },
  },
  {
    path: "edit-cipher",
    component: VaultAddEditPageComponent,
    canMatch: [unlockedOnlyGuard],
    data: { ...ios27RouteData("vault", "secondary", false) },
  },
  {
    path: "clone-cipher",
    component: VaultAddEditPageComponent,
    canMatch: [unlockedOnlyGuard],
    data: { ...ios27RouteData("vault", "secondary", false) },
  },
  {
    path: "cipher-password-history",
    component: VaultPasswordHistoryPageComponent,
    canMatch: [unlockedOnlyGuard],
    data: { ...ios27RouteData("vault", "secondary", false) },
  },
  {
    path: "generator-history",
    component: GeneratorHistoryPageComponent,
    canMatch: [unlockedOnlyGuard],
    data: { ...ios27RouteData("generator", "secondary", false) },
  },
  {
    path: "add-send",
    component: SendAddEditPageComponent,
    canMatch: [unlockedOnlyGuard],
    data: { ...ios27RouteData("send", "secondary", false) },
  },
  {
    path: "edit-send",
    component: SendAddEditPageComponent,
    canMatch: [unlockedOnlyGuard],
    data: { ...ios27RouteData("send", "secondary", false) },
  },
  {
    path: "send-created",
    component: SendCreatedPageComponent,
    canMatch: [unlockedOnlyGuard],
    data: { ...ios27RouteData("send", "secondary", false) },
  },
  {
    path: "about",
    component: AboutPageComponent,
    canMatch: [unlockedOnlyGuard],
    data: { ...ios27RouteData("document", "secondary", false) },
  },
  {
    path: "third-party-notices",
    component: ThirdPartyNoticesPageComponent,
    canMatch: [unlockedOnlyGuard],
    data: { ...ios27RouteData("document", "secondary", false) },
  },
  {
    path: "third-party-licenses",
    component: ThirdPartyLicensesPageComponent,
    canMatch: [unlockedOnlyGuard],
    data: { ...ios27RouteData("document", "secondary", false) },
  },
  { path: "", pathMatch: "full", redirectTo: "login" },
  { path: "**", redirectTo: "login" },
];
