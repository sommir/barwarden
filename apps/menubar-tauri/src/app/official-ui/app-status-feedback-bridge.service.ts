import { Injectable, OnDestroy, Optional } from "@angular/core";
import { distinctUntilChanged, map, Subscription } from "rxjs";

import { PopupStateStore } from "../popup-state";
import { AppFeedbackService, type FeedbackKind } from "./app-feedback.service";
import {
  ACCESSIBILITY_PERMISSION_STATUS,
  AccessibilityPermissionDialogService,
} from "./accessibility-permission-dialog.service";

@Injectable({ providedIn: "root" })
export class AppStatusFeedbackBridgeService implements OnDestroy {
  private subscription = Subscription.EMPTY;
  private started = false;
  private publicationEpoch = 0;

  constructor(
    private readonly store: PopupStateStore,
    private readonly feedback: AppFeedbackService,
    @Optional()
    private readonly accessibilityPermission: AccessibilityPermissionDialogService | null = null,
  ) {}

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.subscription = this.store.state$
      .pipe(
        map((state) => ({
          eventId: state.statusEventId,
          message: state.statusMessage.trim(),
        })),
        distinctUntilChanged((left, right) => left.eventId === right.eventId),
      )
      .subscribe(({ message }) => {
        const epoch = ++this.publicationEpoch;
        const feedbackBefore = this.feedback.snapshot()?.id ?? null;
        if (!message) {
          return;
        }
        if (message === ACCESSIBILITY_PERMISSION_STATUS) {
          this.feedback.dismiss();
          this.accessibilityPermission?.present();
          return;
        }
        queueMicrotask(() => {
          if (epoch !== this.publicationEpoch) {
            return;
          }
          const current = this.feedback.snapshot();
          if (
            current
            && current.id !== feedbackBefore
            && current.message === message
          ) {
            return;
          }
          this.feedback.show(message, { kind: feedbackKind(message) });
        });
      });
  }

  destroy(): void {
    this.publicationEpoch += 1;
    this.subscription.unsubscribe();
    this.subscription = Subscription.EMPTY;
    this.started = false;
  }

  suppress(): void {
    this.publicationEpoch += 1;
    this.feedback.dismiss();
  }

  ngOnDestroy(): void {
    this.destroy();
  }
}

function feedbackKind(message: string): FeedbackKind {
  if (/(?:无法|失败|错误|不可用|需要恢复|请重试|unable|failed|failure|error|denied|unavailable)/iu.test(message)) {
    return "warning";
  }
  if (/(?:已|完成|成功|copied|saved|deleted|archived|restored|opened|filled|sent|synced|logged out|complete)/iu.test(message)) {
    return "success";
  }
  return "status";
}
