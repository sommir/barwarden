import { Injectable, OnDestroy } from "@angular/core";
import { BehaviorSubject } from "rxjs";

export type FeedbackKind = "status" | "success" | "warning";

export interface AppFeedback {
  readonly id: number;
  readonly kind: FeedbackKind;
  readonly message: string;
  readonly durationMs: number;
}

export interface ShowFeedbackOptions {
  readonly kind?: FeedbackKind;
  readonly durationMs?: number;
}

const DEFAULT_DURATION_MS = 4_000;

@Injectable({ providedIn: "root" })
export class AppFeedbackService implements OnDestroy {
  private readonly subject = new BehaviorSubject<AppFeedback | null>(null);
  private nextId = 0;
  private dismissTimer: number | undefined;

  readonly feedback$ = this.subject.asObservable();

  show(message: string, options: ShowFeedbackOptions = {}): AppFeedback {
    this.clearDismissTimer();
    const feedback: AppFeedback = {
      id: ++this.nextId,
      kind: options.kind ?? "status",
      message,
      durationMs: options.durationMs ?? DEFAULT_DURATION_MS,
    };
    this.subject.next(feedback);
    this.dismissTimer = window.setTimeout(() => this.dismiss(feedback.id), feedback.durationMs);
    return feedback;
  }

  dismiss(id?: number): void {
    const current = this.subject.value;
    if (!current || (id !== undefined && current.id !== id)) {
      return;
    }
    this.clearDismissTimer();
    this.subject.next(null);
  }

  snapshot(): AppFeedback | null {
    return this.subject.value;
  }

  ngOnDestroy(): void {
    this.clearDismissTimer();
    this.subject.complete();
  }

  private clearDismissTimer(): void {
    if (this.dismissTimer !== undefined) {
      window.clearTimeout(this.dismissTimer);
      this.dismissTimer = undefined;
    }
  }
}
