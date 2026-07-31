import { ChangeDetectionStrategy, Component } from "@angular/core";

import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { CredentialGeneratorService } from "@bitwarden/generator-core";
import { GeneratorHistoryService } from "@bitwarden/generator-history";
import { OfficialGeneratorHistoryComponent } from "@bitwarden/generator-overlay/credential-generator-history";

import { TauriPopupPlatformUtilsAdapter } from "../upstream-overlays/pop-out/platform-utils.adapter";
import { PopupStateStore } from "../popup-state";
import { ClipboardPolicyService } from "../settings/clipboard-policy.service";
import { GeneratorHistoryRouteOwner } from "./generator-history-route.owner";
import { OfficialCredentialGeneratorServiceAdapter } from "./official-credential-generator-service.adapter";
import { OfficialGeneratorAccountAdapter } from "./official-generator-account.adapter";
import {
  GENERATOR_HISTORY_CLIPBOARD_HOST,
  OfficialGeneratorHistoryViewAdapter,
} from "./official-generator-history-view.adapter";
import {
  GENERATOR_CLIPBOARD_POLICY,
  GENERATOR_RUNTIME,
  GENERATOR_STATUS,
} from "./generator-runtime.port";
import {
  GENERATOR_HISTORY_RUNTIME,
  GENERATOR_HISTORY_STATE,
} from "./generator-history-runtime.port";
import { GeneratorService } from "./generator.service";

export { GENERATOR_HISTORY_CLIPBOARD_HOST } from "./official-generator-history-view.adapter";

@Component({
  selector: "bw-generator-history-page",
  host: { class: "macos-page macos-page--secondary macos-page--generator-history" },
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [OfficialGeneratorHistoryComponent],
  providers: [
    { provide: GENERATOR_RUNTIME, useExisting: GeneratorService },
    { provide: GENERATOR_STATUS, useExisting: PopupStateStore },
    { provide: GENERATOR_HISTORY_RUNTIME, useExisting: GeneratorService },
    { provide: GENERATOR_HISTORY_STATE, useExisting: PopupStateStore },
    { provide: GENERATOR_CLIPBOARD_POLICY, useExisting: ClipboardPolicyService },
    GeneratorHistoryRouteOwner,
    OfficialGeneratorAccountAdapter,
    OfficialCredentialGeneratorServiceAdapter,
    OfficialGeneratorHistoryViewAdapter,
    TauriPopupPlatformUtilsAdapter,
    { provide: CredentialGeneratorService, useExisting: OfficialCredentialGeneratorServiceAdapter },
    { provide: GeneratorHistoryService, useExisting: OfficialGeneratorHistoryViewAdapter },
    { provide: PlatformUtilsService, useExisting: TauriPopupPlatformUtilsAdapter },
    ClipboardPolicyService,
  ],
  template: "<bw-official-generator-history />",
})
export class GeneratorHistoryPageComponent {}
