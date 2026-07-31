import { ChangeDetectionStrategy, Component } from "@angular/core";

import { OfficialCredentialGeneratorComponent } from "@bitwarden/generator-overlay/credential-generator";

import { ClipboardPolicyService } from "../settings/clipboard-policy.service";
import { PopupStateStore } from "../popup-state";
import {
  GENERATOR_CLIPBOARD_POLICY,
  GENERATOR_OWNERSHIP_STATE,
  GENERATOR_RUNTIME,
  GENERATOR_STATUS,
} from "./generator-runtime.port";
import { GeneratorService } from "./generator.service";
import { CredentialGeneratorService } from "@bitwarden/generator-core";
import { GeneratorHistoryService } from "@bitwarden/generator-history";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { OfficialCredentialGeneratorServiceAdapter } from "./official-credential-generator-service.adapter";
import { OfficialGeneratorAccountAdapter } from "./official-generator-account.adapter";
import { OfficialGeneratorHistoryAdapter } from "./official-generator-history.adapter";
import { OfficialGeneratorLogAdapter } from "./official-generator-log.adapter";
import { OfficialGeneratorToastAdapter } from "./official-generator-toast.adapter";
import { TauriPopupPlatformUtilsAdapter } from "../upstream-overlays/pop-out/platform-utils.adapter";

export { GENERATOR_CLIPBOARD_HOST } from "./generator-runtime.port";

@Component({
  selector: "bw-generator-page",
  host: { class: "macos-page macos-page--generator" },
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [OfficialCredentialGeneratorComponent],
  providers: [
    { provide: GENERATOR_RUNTIME, useExisting: GeneratorService },
    { provide: GENERATOR_OWNERSHIP_STATE, useExisting: PopupStateStore },
    { provide: GENERATOR_CLIPBOARD_POLICY, useExisting: ClipboardPolicyService },
    { provide: GENERATOR_STATUS, useExisting: PopupStateStore },
    OfficialGeneratorAccountAdapter,
    OfficialCredentialGeneratorServiceAdapter,
    OfficialGeneratorHistoryAdapter,
    OfficialGeneratorLogAdapter,
    OfficialGeneratorToastAdapter,
    TauriPopupPlatformUtilsAdapter,
    { provide: CredentialGeneratorService, useExisting: OfficialCredentialGeneratorServiceAdapter },
    { provide: GeneratorHistoryService, useExisting: OfficialGeneratorHistoryAdapter },
    { provide: LogService, useExisting: OfficialGeneratorLogAdapter },
    { provide: PlatformUtilsService, useExisting: TauriPopupPlatformUtilsAdapter },
  ],
  template: "<bw-official-credential-generator />",
})
export class GeneratorPageComponent {}
