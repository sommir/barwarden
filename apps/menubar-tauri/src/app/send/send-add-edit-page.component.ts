import { ChangeDetectorRef, Component, DestroyRef, Inject, OnDestroy, Optional, ViewChild } from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";
import { Subscription } from "rxjs";

import { DialogService } from "@bitwarden/components/dialog/dialog.service";

import type { AuthSession } from "../../auth/auth-session-store";
import type { HostApi } from "../../host/host-api";
import { TauriHostService } from "../../host/tauri-host.service";
import { OfficialSendAddEditComponent, type OfficialSendMode } from "../upstream-overlays/send/official-send-add-edit.component";
import { PopupStateStore } from "../popup-state";
import { ClipboardPolicyService } from "../settings/clipboard-policy.service";
import {
  claimLocalCopyFeedback,
  completeLocalCopyFeedback,
} from "../official-ui/local-copy-feedback-event";
import { SEND_CREATED_HOST } from "./send-created-page.component";
import { GeneratorService } from "../generator/generator.service";
import { BitwardenSendActions, SEND_ACTION_PORT, type SendActionPort } from "./send-actions.service";
import type { SendItem } from "./send-item.model";
import {
  RetainedTextSendFormService,
  type RetainedTextSendErrors,
  type RetainedTextSendField,
  type RetainedTextSendFormValue,
} from "./retained-text-send-form.service";
import { TextSendOperation } from "./text-send-operation";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";
import {
  PopupRouterCacheService,
  type PopupBackContinuation,
} from "../platform/popup-router-cache.service";

export const textSendDeletionPresetHours = [1, 24, 48, 72, 168, 336, 720] as const;

@Component({ selector: "bw-send-add-edit-page", host: { class: "macos-page macos-page--secondary macos-page--send-form" }, standalone: true, imports: [OfficialSendAddEditComponent], template: `<bw-official-send-add-edit [mode]="mode" [editing]="editing" [disabled]="disabled" [pending]="operation.pending" [valid]="form.valid()" [unavailable]="invalidRequestedSend" [value]="form.value()" [errors]="errors" [touched]="touched" [originalHadPassword]="originalHadPassword" [hideEmailAllowed]="hideEmailAllowed" [status]="status" (edit)="beginEditing()" (save)="save()" (cancel)="cancelEditing()" (back)="back()" (delete)="delete()" (removePassword)="removePassword()" (generatePassword)="generatePassword()" (copyPassword)="copyPassword($event)" (valueChange)="form.patch($event)" (fieldBlur)="fieldBlur($event)" />` })
export class SendAddEditPageComponent implements OnDestroy {
  @ViewChild(OfficialSendAddEditComponent) private presentation?: OfficialSendAddEditComponent;
  readonly form: RetainedTextSendFormService;
  readonly operation: TextSendOperation;
  readonly host: HostApi;
  readonly touched = new Set<RetainedTextSendField>();
  mode: OfficialSendMode = "add";
  editing = true;
  private source?: SendItem;
  private destroyed = false;
  private continuationEpoch = 0;
  private requestedId = "";
  private ownershipInvalid = false;
  private pageOwner?: SendPageOwner;
  private policyDisabled: boolean;
  private policyHideEmailAllowed: boolean;
  private readonly routeSubscription: Subscription;
  private readonly stateSubscription: Subscription;

  constructor(route: ActivatedRoute, private readonly router: Router, private readonly store: PopupStateStore, private readonly generator: GeneratorService, private readonly clipboard: ClipboardPolicyService, private readonly dialogService: DialogService, private readonly changeDetectorRef: ChangeDetectorRef, private readonly routeCache: PopupRouterCacheService, destroyRef: DestroyRef, @Optional() @Inject(SEND_ACTION_PORT) actions: SendActionPort | null = null, @Optional() @Inject(SEND_CREATED_HOST) host: HostApi | null = null) {
    const releaseBackOwner = routeCache.registerBackOwner((resume) => this.leaveRoute(resume));
    destroyRef.onDestroy(releaseBackOwner);
    this.host = host ?? new TauriHostService();
    const state = store.snapshot();
    this.policyDisabled = state.sendPolicy.disabled;
    this.policyHideEmailAllowed = state.sendPolicy.hideEmailAllowed;
    this.form = new RetainedTextSendFormService(() => this.store.snapshot().sendPolicy.hideEmailAllowed);
    this.operation = new TextSendOperation({ store, actions: actions ?? sessionSendActions(), navigation: { currentUrl: () => router.url } });
    this.routeSubscription = route.queryParamMap.subscribe((params) => this.routeChanged(params.get("sendId") ?? ""));
    this.stateSubscription = store.state$.subscribe((next) => this.stateChanged(next));
  }

  get disabled(): boolean { return this.policyDisabled; }
  get hideEmailAllowed(): boolean { return this.policyHideEmailAllowed; }
  get originalHadPassword(): boolean { return Boolean(this.source?.hasPassword || this.source?.password); }
  get status(): string { return this.store.snapshot().statusMessage; }
  get errors(): RetainedTextSendErrors { return this.form.errors(); }
  get invalidRequestedSend(): boolean { return this.ownershipInvalid || (this.requestedId.length > 0 && !this.source); }
  get canSave(): boolean { return !this.disabled && !this.invalidRequestedSend && !this.operation.pending; }
  get name(): string { return this.form.value().name; } set name(value: string) { this.form.patch({ name: value }); }
  get text(): string { return this.form.value().text; } set text(value: string) { this.form.patch({ text: value }); }
  get password(): string { return this.form.value().password; } set password(value: string) { this.form.patch({ authType: value ? "password" : "none", password: value }); }
  get privateNotes(): string { return this.form.value().notes; } set privateNotes(value: string) { this.form.patch({ notes: value }); }
  get maxAccessCount(): number | null { const value = this.form.value().maxAccessCount; return value ? Number(value) : null; } set maxAccessCount(value: number | null) { this.form.patch({ maxAccessCount: value == null ? "" : String(value) }); }
  get hidden(): boolean { return this.form.value().hidden; } set hidden(value: boolean) { this.form.patch({ hidden: value }); }
  get hideEmail(): boolean { return this.form.value().hideEmail; } set hideEmail(value: boolean) { this.form.patch({ hideEmail: value }); }
  get deletionHours(): number { return this.form.value().deletionPresetHours; }
  get passwordGenerationError(): string {
    return this.status === translateOfficialMessage("i18nGeneratingPasswordFailed")
      ? this.status
      : "";
  }
  setDeletionHoursValue(value: number | string | null): void { const hours = Number(value); if (textSendDeletionPresetHours.includes(hours as typeof textSendDeletionPresetHours[number])) this.form.patch({ deletionPresetHours: hours as RetainedTextSendFormValue["deletionPresetHours"] }); }
  fieldBlur(field: RetainedTextSendField): void {
    this.touched.add(field);
    this.changeDetectorRef.markForCheck();
  }

  beginEditing(): void { if (this.mode === "edit" && !this.invalidRequestedSend) this.editing = true; }
  async cancelEditing(): Promise<void> {
    if (this.mode === "edit") {
      if (!(await this.discardEditing())) return;
      return;
    }
    await this.routeCache.back();
  }
  async back(): Promise<void> {
    await this.routeCache.back();
  }

  private async leaveRoute(resume: PopupBackContinuation): Promise<void> {
    if (this.mode === "edit" && this.editing) {
      await this.discardEditing();
      return;
    }
    if (!(await this.discardEditing())) return;
    this.invalidateContinuations();
    await resume("/tabs/send");
  }

  async save(): Promise<void> {
    if (this.destroyed || this.invalidRequestedSend || this.operation.pending) return;
    if (this.disabled) { this.store.setStatus(translateOfficialMessage("i18nOrganizationPolicyDisabledSendStatus")); return; }
    const errors = this.form.errors();
    if (Object.keys(errors).length > 0) {
      for (const field of Object.keys(errors) as RetainedTextSendField[]) this.touched.add(field);
      this.changeDetectorRef.detectChanges();
      this.presentation?.focusFirstError(errors);
      return;
    }
    if (!this.store.snapshot().activeSession?.crypto?.userKeyB64) { this.store.setStatus(translateOfficialMessage("i18nUnlockBeforeCreatingSend")); return; }
    const source = this.mode === "edit" ? this.source : undefined;
    if (this.mode === "edit" && !source) { this.store.setStatus(translateOfficialMessage("i18nUnableToSaveSend")); return; }
    this.invalidateContinuations();
    const draft = this.form.draft(new Date());
    const result = this.mode === "add"
      ? await this.operation.create(draft)
      : await this.operation.update(source, draft);
    if (this.destroyed) return;
    if (!result.committed) {
      this.revalidate();
      return;
    }
    const send = result.send && this.store.snapshot().sends.find((candidate) => candidate === result.send);
    if (!send || send.type !== "text") {
      this.invalidateAndPurge();
      return;
    }
    if (this.mode === "edit") {
      this.adopt(send);
      if (!this.currentPageOwner()) return;
    } else if (!this.currentPageOwner()) {
      return;
    }
    await this.router.navigate(this.mode === "add" ? ["/send-created"] : ["/edit-send"], {
      queryParams: { sendId: send.id, type: "text" },
      replaceUrl: this.mode === "add",
    });
  }

  async generatePassword(): Promise<void> {
    const owner = this.captureContinuation(true);
    try {
      const generated = await this.generator.generate("password");
      if (this.currentContinuation(owner)) {
        this.form.patch({ authType: "password", password: generated.credential });
      }
    } catch {
      if (this.currentContinuation(owner)) {
        this.store.setStatus(translateOfficialMessage("i18nGeneratingPasswordFailed"));
      }
    }
  }

  async copyPassword(trigger?: Event): Promise<void> {
    const receipt = trigger ? claimLocalCopyFeedback(trigger) : null;
    const owner = this.captureContinuation();
    const password = this.form.value().password;
    if (!password) {
      completeLocalCopyFeedback(receipt, true);
      return;
    }
    await Promise.resolve();
    if (!this.currentContinuation(owner)) {
      completeLocalCopyFeedback(receipt, true);
      return;
    }
    try {
      await this.clipboard.copy(password, this.host);
      if (!this.currentContinuation(owner)) {
        completeLocalCopyFeedback(receipt, true);
        return;
      }
      this.store.setStatus(translateOfficialMessage("i18nCopiedSendPassword"));
      completeLocalCopyFeedback(receipt, false);
    } catch {
      if (this.currentContinuation(owner)) {
        this.store.setStatus(translateOfficialMessage("i18nCopySendPasswordFailed"));
      }
      completeLocalCopyFeedback(receipt, true);
    }
  }

  async removePassword(): Promise<void> {
    const source = this.source;
    if (!source || !this.currentPageOwner()) return;
    const owner = this.captureContinuation();
    this.invalidateContinuations();
    if (
      !(await this.dialogService.openSimpleDialog({
        title: translateOfficialMessage("i18nRemoveSendPassword"),
        content: translateOfficialMessage("i18nRemoveSendPasswordContent"),
        type: "warning",
        acceptButtonText: translateOfficialMessage("i18nRemove"),
        cancelButtonText: translateOfficialMessage("cancel"),
      }))
      || !this.currentConfirmation(owner)
    ) return;
    const result = await this.operation.removePassword(source);
    if (this.destroyed) return;
    if (result.committed) {
      const send = this.store.snapshot().sends.find((candidate) => candidate.id === source.id);
      if (send?.type === "text") this.adopt(send);
      else this.invalidateAndPurge();
    } else {
      this.revalidate();
      if (result.reason === "failure" && this.currentPageOwner()) this.store.setStatus(translateOfficialMessage("i18nRemoveSendPasswordFailed"));
    }
  }

  async delete(): Promise<void> {
    const source = this.source;
    if (!source || !this.currentPageOwner()) return;
    const owner = this.captureContinuation();
    this.invalidateContinuations();
    if (
      !(await this.dialogService.openSimpleDialog({
        title: translateOfficialMessage("i18nDeleteSendTitle", source.name),
        content: translateOfficialMessage("i18nCannotUndo"),
        type: "danger",
        acceptButtonText: translateOfficialMessage("i18nPermanentDelete"),
        cancelButtonText: translateOfficialMessage("cancel"),
      }))
      || !this.currentConfirmation(owner)
    ) return;
    const result = await this.operation.delete(source);
    if (this.destroyed) return;
    if (result.committed && this.currentPageOwner()) await this.router.navigate(["/tabs/send"]);
    else {
      this.revalidate();
      if (result.reason === "failure" && this.currentPageOwner()) this.store.setStatus(translateOfficialMessage("i18nDeleteSendFailed"));
    }
  }

  sourceSendForTest(): SendItem | undefined { return this.source; }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.routeSubscription.unsubscribe();
    this.stateSubscription.unsubscribe();
    this.invalidateAndPurge();
  }

  private routeChanged(id: string): void {
    if (this.requestedId || this.pageOwner) this.invalidateAndPurge();
    this.requestedId = id;
    this.ownershipInvalid = false;
    this.source = id ? this.store.snapshot().sends.find((send) => send.id === id && send.type === "text") : undefined;
    this.mode = this.source ? "edit" : "add";
    this.editing = !this.source;
    this.form.initialize(this.source ? valueFrom(this.source) : emptyValue(), this.source?.deletionDate);
    this.touched.clear();
    this.pageOwner = capturePageOwner(this.store);
  }

  private stateChanged(state: ReturnType<PopupStateStore["snapshot"]>): void {
    if (this.destroyed) return;
    this.policyDisabled = state.sendPolicy.disabled;
    this.policyHideEmailAllowed = state.sendPolicy.hideEmailAllowed;
    if (!state.sendPolicy.hideEmailAllowed && this.form.value().hideEmail) {
      this.form.patch({ hideEmail: false });
    }
    this.changeDetectorRef.markForCheck();
    if (!this.currentPageOwner()) {
      this.invalidateAndPurge();
      return;
    }
    if (this.source) {
      const current = state.sends.find((candidate) => candidate.id === this.source?.id);
      if (current !== this.source && !this.operation.isCommitting) this.invalidateAndPurge();
    }
  }

  private currentPageOwner(owner = this.pageOwner): boolean {
    return !this.destroyed && !this.ownershipInvalid && Boolean(owner && samePageOwner(this.store, owner));
  }

  private revalidate(): void {
    this.stateChanged(this.store.snapshot());
  }

  private adopt(send: SendItem): void {
    this.invalidateContinuations();
    this.source = send;
    this.mode = "edit";
    this.editing = false;
    this.form.initialize(valueFrom(send), send.deletionDate);
    this.touched.clear();
    this.pageOwner = capturePageOwner(this.store);
  }

  private async discardEditing(): Promise<boolean> {
    const owner = this.captureContinuation();
    this.invalidateContinuations();
    if (
      this.form.dirty()
      && (
        !(await this.dialogService.openSimpleDialog({
          title: translateOfficialMessage("i18nDiscardSendTitle"),
          content: translateOfficialMessage("i18nDiscardSendContent"),
          type: "warning",
          acceptButtonText: translateOfficialMessage("i18nDiscard"),
          cancelButtonText: translateOfficialMessage("i18nContinueEditing"),
        }))
        || !this.currentConfirmation(owner)
      )
    ) return false;
    this.form.reset();
    this.touched.clear();
    this.editing = false;
    return true;
  }

  private invalidateAndPurge(): void {
    this.operation.invalidate();
    this.invalidateContinuations();
    this.source = undefined;
    this.pageOwner = undefined;
    this.ownershipInvalid = true;
    this.editing = false;
    this.form.destroy();
    this.touched.clear();
  }

  private captureContinuation(invalidateExisting = false): SendContinuationOwner {
    if (invalidateExisting) this.invalidateContinuations();
    return {
      epoch: this.continuationEpoch,
      pageOwner: this.pageOwner,
      source: this.source,
      formRevision: this.form.revision(),
    };
  }

  private currentContinuation(owner: SendContinuationOwner): boolean {
    return owner.epoch === this.continuationEpoch &&
      owner.source === this.source &&
      owner.formRevision === this.form.revision() &&
      this.currentPageOwner(owner.pageOwner);
  }

  private currentConfirmation(owner: SendContinuationOwner): boolean {
    return owner.source === this.source
      && owner.formRevision === this.form.revision()
      && this.currentPageOwner(owner.pageOwner);
  }

  private invalidateContinuations(): void {
    this.continuationEpoch += 1;
  }
}

type SendPageOwner = {
  readonly session: AuthSession | null;
  readonly accountEmail: string;
  readonly serverUrl: string;
  readonly isUnlocked: boolean;
  readonly lifecycleRevision: number;
};

type SendContinuationOwner = {
  readonly epoch: number;
  readonly pageOwner: SendPageOwner | undefined;
  readonly source: SendItem | undefined;
  readonly formRevision: number;
};

function capturePageOwner(store: PopupStateStore): SendPageOwner {
  const state = store.snapshot();
  return {
    session: state.activeSession,
    accountEmail: state.email,
    serverUrl: state.serverUrl,
    isUnlocked: state.isUnlocked,
    lifecycleRevision: store.currentSendLifecycleRevision(),
  };
}

function samePageOwner(store: PopupStateStore, owner: SendPageOwner): boolean {
  const state = store.snapshot();
  return state.activeSession === owner.session &&
    state.email === owner.accountEmail &&
    state.serverUrl === owner.serverUrl &&
    state.isUnlocked === owner.isUnlocked &&
    store.currentSendLifecycleRevision() === owner.lifecycleRevision;
}

function emptyValue(): RetainedTextSendFormValue { return { name: "", text: "", hidden: false, deletionPresetHours: 168, authType: "none", password: "", maxAccessCount: "", hideEmail: false, notes: "" }; }
function valueFrom(send: SendItem): RetainedTextSendFormValue { return { ...emptyValue(), name: send.name, text: send.text ?? "", hidden: Boolean(send.hidden), authType: send.hasPassword || send.password ? "password" : "none", maxAccessCount: send.maxAccessCount?.toString() ?? "", hideEmail: Boolean(send.hideEmail), notes: send.notes }; }
function sessionSendActions(): SendActionPort { const actions = (session: AuthSession) => new BitwardenSendActions(session); return { createTextSend: (session, draft) => actions(session).createTextSend(session, draft), updateTextSend: (session, send, draft) => actions(session).updateTextSend(session, send, draft), deleteSend: (session, send) => actions(session).deleteSend(session, send), removePassword: (session, send) => actions(session).removePassword(session, send), refreshTextSend: (session, sendId) => actions(session).refreshTextSend(session, sendId) }; }
