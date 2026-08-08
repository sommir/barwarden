import { importProvidersFrom, inject, provideAppInitializer, type ApplicationConfig } from "@angular/core";
import { provideAnimations } from "@angular/platform-browser/animations";
import { OVERLAY_DEFAULT_CONFIG } from "@angular/cdk/overlay";
import {
  provideRouter,
  RouteReuseStrategy,
  withComponentInputBinding,
  withDisabledInitialNavigation,
  withHashLocation,
  withRouterConfig,
} from "@angular/router";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { AvatarService } from "@bitwarden/common/auth/abstractions/avatar.service";
import { DialogModule, DialogService } from "@bitwarden/components";

import { retainedPopupRouteGraph, routes } from "./app.routes";
import { ACCOUNT_LOGOUT_CLEANUP_PORT } from "./auth/account-logout-cleanup";
import { CompositeAccountCleanupService } from "./auth/composite-account-cleanup.service";
import {
  BIOMETRIC_PREFERENCE_PORT,
  UNLOCK_METHODS_PORT,
} from "./auth/unlock-methods.port";
import { UnlockMethodsService } from "./auth/unlock-methods.service";
import { OfficialAccountSwitcherAdapter } from "./auth/official-account-switcher.adapter";
import { createEvidenceProviders } from "./evidence/evidence-providers";
import { GeneratorService } from "./generator/generator.service";
import { AppBottomSheetDialogService } from "./official-ui/app-bottom-sheet-dialog.service";
import { OfficialI18nService } from "./official-ui/official-i18n.service";
import { PopupStateStore } from "./popup-state";
import { PopupRouterCacheService } from "./platform/popup-router-cache.service";
import { PopupRouteReuseStrategy } from "./platform/popup-route-reuse.strategy";
import { createSettingsEvidencePreview } from "./settings/settings-evidence-preview";
import { SettingsService } from "./settings/settings.service";
import { APP_UPDATE_PORT } from "./updates/app-update.port";
import { createDefaultAppUpdatePort } from "./updates/tauri-app-update.port";
import {
  RETAINED_LOGIN_FORM_GENERATOR,
  RETAINED_LOGIN_FORM_STATUS_STORE,
} from "./vault/retained-login-form.adapter";
import {
  POPUP_ROUTER_CACHE_LIFECYCLE_PORT,
  POPUP_ROUTER_CACHE_ROUTE_GRAPH,
} from "./platform/popup-router-cache.lifecycle";
import { AutoFillProjectionService } from "./autofill/autofill-projection.service";

const evidenceSearch = globalThis.location?.search ?? "";
const settingsEvidencePreview = createSettingsEvidencePreview(evidenceSearch);
const evidenceProviders = settingsEvidencePreview ? [] : createEvidenceProviders(evidenceSearch);

export const appConfig: ApplicationConfig = {
  providers: [
    importProvidersFrom(DialogModule),
    provideAnimations(),
    { provide: OVERLAY_DEFAULT_CONFIG, useValue: { usePopover: false } },
    { provide: APP_UPDATE_PORT, useFactory: createDefaultAppUpdatePort },
    AppBottomSheetDialogService,
    { provide: DialogService, useExisting: AppBottomSheetDialogService },
    OfficialI18nService,
    { provide: I18nService, useExisting: OfficialI18nService },
    provideAppInitializer(() => {
      inject(SettingsService);
      inject(AutoFillProjectionService);
    }),
    { provide: RETAINED_LOGIN_FORM_GENERATOR, useExisting: GeneratorService },
    { provide: RETAINED_LOGIN_FORM_STATUS_STORE, useExisting: PopupStateStore },
    {
      provide: AccountService,
      useFactory: (adapter: OfficialAccountSwitcherAdapter) => adapter.accountService,
      deps: [OfficialAccountSwitcherAdapter],
    },
    {
      provide: AvatarService,
      useFactory: (adapter: OfficialAccountSwitcherAdapter) => adapter.avatarService,
      deps: [OfficialAccountSwitcherAdapter],
    },
    {
      provide: AuthService,
      useFactory: (adapter: OfficialAccountSwitcherAdapter) => adapter.authService,
      deps: [OfficialAccountSwitcherAdapter],
    },
    {
      provide: ACCOUNT_LOGOUT_CLEANUP_PORT,
      useExisting: CompositeAccountCleanupService,
    },
    {
      provide: UNLOCK_METHODS_PORT,
      useExisting: UnlockMethodsService,
    },
    {
      provide: BIOMETRIC_PREFERENCE_PORT,
      useExisting: SettingsService,
    },
    {
      provide: POPUP_ROUTER_CACHE_LIFECYCLE_PORT,
      useExisting: PopupRouterCacheService,
    },
    {
      provide: POPUP_ROUTER_CACHE_ROUTE_GRAPH,
      useValue: retainedPopupRouteGraph,
    },
    {
      provide: RouteReuseStrategy,
      useExisting: PopupRouteReuseStrategy,
    },
    ...evidenceProviders,
    ...(settingsEvidencePreview?.providers ?? []),
    provideRouter(
      routes,
      withDisabledInitialNavigation(),
      withHashLocation(),
      withComponentInputBinding(),
      withRouterConfig({ onSameUrlNavigation: "reload" }),
    ),
  ],
};
