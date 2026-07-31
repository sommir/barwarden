import { ChangeDetectorRef, Component, Inject, Injectable, InjectionToken, OnDestroy, Optional } from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";
import { Subscription } from "rxjs";

import type { HostApi } from "../../host/host-api";
import { TauriHostService } from "../../host/tauri-host.service";
import { POP_OUT_HOST, type PopOutHost } from "../pop-out-host.port";
import { PopupStateStore } from "../popup-state";
import { ClipboardPolicyService } from "../settings/clipboard-policy.service";
import { AppFeedbackService } from "../official-ui/app-feedback.service";
import {
  claimLocalCopyFeedback,
  completeLocalCopyFeedback,
} from "../official-ui/local-copy-feedback-event";
import {
  OfficialSendCreatedComponent,
  type OfficialCreatedTextSend,
} from "../upstream-overlays/send/official-send-created.component";
import type { SendItem } from "./send-item.model";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";

export const SEND_CREATED_HOST = new InjectionToken<HostApi | null>("SEND_CREATED_HOST", {
  providedIn: "root",
  factory: () => null,
});

@Injectable()
export class SendLinkBuilder {
  constructor(private readonly store: PopupStateStore) {}

  linkFor(send: SendItem): string {
    if (send.type !== "text" || !send.accessId.trim() || !send.urlB64Key?.trim()) {
      return "";
    }
    const state = this.store.snapshot();
    const base = (state.activeSession?.environment.sendUrl ?? state.serverUrl).replace(/\/$/, "");
    return base ? `${base}/#/send/${send.accessId}/${send.urlB64Key}` : "";
  }
}

@Component({
  selector: "bw-send-created-page",
  host: { class: "macos-page macos-page--secondary macos-page--send-created" },
  standalone: true,
  imports: [OfficialSendCreatedComponent],
  providers: [SendLinkBuilder],
  template: `
    @if (send) {
      <bw-official-send-created
        [send]="send"
        [formattedExpiration]="formattedExpiration"
        (copyLink)="copyLink($event)"
        (close)="close()"
        (popOut)="popOut()"
      />
    }
  `,
})
export class SendCreatedPageComponent implements OnDestroy {
  private readonly host: HostApi;
  private readonly popOutHost: PopOutHost;
  private readonly owner: SendCreatedOwnership | undefined;
  private readonly stateSubscription: Subscription;

  constructor(
    route: ActivatedRoute,
    private readonly store: PopupStateStore,
    private readonly router: Router,
    private readonly linkBuilder: SendLinkBuilder,
    private readonly clipboardPolicy: ClipboardPolicyService,
    private readonly changeDetectorRef: ChangeDetectorRef,
    private readonly feedback: AppFeedbackService,
    @Optional() @Inject(SEND_CREATED_HOST) host: HostApi | null = null,
    @Optional() @Inject(POP_OUT_HOST) popOutHost: PopOutHost | null = null,
  ) {
    this.host = host ?? new TauriHostService();
    this.popOutHost = popOutHost ?? new TauriHostService();
    const sendId = route.snapshot.queryParamMap.get("sendId") ?? "";
    this.owner = captureSendCreatedOwnership(store.snapshot(), store.currentSendRevision(), sendId);
    this.stateSubscription = store.state$.subscribe(() => this.changeDetectorRef.markForCheck());
  }

  get send(): OfficialCreatedTextSend | undefined {
    const send = this.currentSend();
    if (!send) {
      return undefined;
    }
    return {
      id: send.id,
      name: send.name,
      deletionDate: send.deletionDate,
      hasPassword: Boolean(send.hasPassword || send.password),
    };
  }

  get formattedExpiration(): string {
    const deletionDate = this.currentSend()?.deletionDate;
    if (!deletionDate) {
      return "";
    }
    const hours = Math.max(0, Math.ceil((Date.parse(deletionDate) - Date.now()) / 3_600_000));
    return hours < 24
      ? translateOfficialMessage("i18nHours", hours)
      : translateOfficialMessage("i18nDays", Math.ceil(hours / 24));
  }

  async copyLink(trigger?: Event): Promise<void> {
    const receipt = trigger ? claimLocalCopyFeedback(trigger) : null;
    const send = this.currentSend();
    const link = send ? this.linkBuilder.linkFor(send) : "";
    if (!link) {
      completeLocalCopyFeedback(receipt, true);
      return;
    }
    try {
      await this.clipboardPolicy.copy(link, this.host);
      const message = translateOfficialMessage("i18nSendLinkCopied");
      this.store.setStatus(message);
      this.feedback.show(message, { kind: "success" });
      completeLocalCopyFeedback(receipt, false);
    } catch {
      this.store.setStatus(translateOfficialMessage("i18nCopySendLinkFailed"));
      completeLocalCopyFeedback(receipt, true);
    }
  }

  close(): void {
    void this.router.navigate(["/tabs/send"]);
  }

  async popOut(): Promise<void> {
    await this.popOutHost.popOut(this.router.url);
  }

  private currentSend(): SendItem | undefined {
    const owner = this.owner;
    const state = this.store.snapshot();
    if (!owner || !sameSendCreatedOwner(state, this.store.currentSendRevision(), owner)) {
      return undefined;
    }
    const send = state.sends.find((candidate) => candidate.id === owner.sendId);
    return isCopyableTextSend(send) ? send : undefined;
  }

  ngOnDestroy(): void {
    this.stateSubscription.unsubscribe();
  }
}

type SendCreatedOwnership = {
  readonly sendId: string;
  readonly sendRevision: number;
  readonly accountEmail: string;
  readonly serverUrl: string;
  readonly environment: {
    readonly apiUrl: string;
    readonly identityUrl: string;
    readonly webVaultUrl: string | null;
    readonly sendUrl: string | null;
  };
};

function captureSendCreatedOwnership(
  state: ReturnType<PopupStateStore["snapshot"]>,
  sendRevision: number,
  sendId: string,
): SendCreatedOwnership | undefined {
  const send = state.sends.find((candidate) => candidate.id === sendId);
  const session = state.activeSession;
  if (!state.isUnlocked || !session || !isCopyableTextSend(send)) {
    return undefined;
  }
  return {
    sendId,
    sendRevision,
    accountEmail: state.email,
    serverUrl: state.serverUrl,
    environment: {
      apiUrl: session.environment.apiUrl,
      identityUrl: session.environment.identityUrl,
      webVaultUrl: session.environment.webVaultUrl,
      sendUrl: session.environment.sendUrl,
    },
  };
}

function sameSendCreatedOwner(
  state: ReturnType<PopupStateStore["snapshot"]>,
  sendRevision: number,
  owner: SendCreatedOwnership,
): boolean {
  const environment = state.activeSession?.environment;
  return state.isUnlocked &&
    sendRevision === owner.sendRevision &&
    state.email === owner.accountEmail &&
    state.serverUrl === owner.serverUrl &&
    environment?.apiUrl === owner.environment.apiUrl &&
    environment.identityUrl === owner.environment.identityUrl &&
    environment.webVaultUrl === owner.environment.webVaultUrl &&
    environment.sendUrl === owner.environment.sendUrl;
}

function isCopyableTextSend(send: SendItem | undefined): send is SendItem {
  return send?.type === "text" && Boolean(send.accessId.trim() && send.urlB64Key?.trim());
}
