import {
  Component,
  EventEmitter,
  Inject,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
} from "@angular/core";
import { AsyncPipe } from "@angular/common";
import { BehaviorSubject } from "rxjs";

import type { VaultField, VaultItem } from "../vault-demo";
import type { TotpCode } from "./totp.service";
import { VaultItemIconComponent } from "./vault-item-icon.component";
import { I18nPipe } from "../official-ui/official-ui-common";
import {
  TOTP_CLOCK,
  TOTP_CODE_SOURCE,
  type TotpCodeSource,
} from "./vault-totp-code.component";

type OtpRowState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly totp: TotpCode }
  | { readonly kind: "unavailable" }
  | { readonly kind: "error" };

@Component({
  selector: "bw-otp-code-row",
  standalone: true,
  imports: [AsyncPipe, I18nPipe, VaultItemIconComponent],
  template: `
    <article
      class="otp-code-row"
      [attr.data-popup-focus-key]="'otp-item:' + item.id"
    >
      @if (copied) {
        <span
          class="tw-sr-only"
          data-testid="otp-copy-status"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >{{ "i18nCopiedOtpForItem" | i18n: item.name }}</span>
      }
      <bw-vault-item-icon class="otp-code-row__icon" [item]="item" />
      <div class="otp-code-row__identity">
        <div class="otp-code-row__name">{{ item.name }}</div>
        <div class="otp-code-row__subtitle">{{ item.subtitle }}</div>
      </div>
      @if (state$ | async; as state) {
        @switch (state.kind) {
          @case ("ready") {
            <span
              class="otp-code-row__countdown"
              [class.is-expiring]="state.totp.isExpiring"
              [attr.aria-label]="'i18nVerificationCodeExpires' | i18n: state.totp.secondsRemaining"
            >
              <span>{{ state.totp.secondsRemaining }}</span>
              <svg transform="rotate(-90)" viewBox="0 0 28 28" aria-hidden="true">
                <circle
                  class="otp-code-row__progress"
                  r="9.5"
                  cy="14"
                  cx="14"
                  stroke-width="2"
                  stroke-dasharray="60"
                  [attr.stroke-dashoffset]="totpDash(state.totp)"
                ></circle>
                <circle
                  class="otp-code-row__track"
                  r="11"
                  cy="14"
                  cx="14"
                  stroke-width="1"
                  stroke-dasharray="71"
                ></circle>
              </svg>
            </span>
            <button
              type="button"
              class="otp-code-row__copy macos-pressable"
              [class.is-copied]="copied"
              data-testid="otp-code"
              [attr.aria-label]="copied ? ('i18nCopiedOtpForItem' | i18n: item.name) : ('i18nCopyOtpForItem' | i18n: item.name)"
              (click)="copy.emit(field)"
            >
              <span class="otp-code-row__code">{{ state.totp.formattedCode }}</span>
              <i
                class="bwi otp-code-row__copy-icon"
                [class.bwi-clone]="!copied"
                [class.bwi-check]="copied"
                aria-hidden="true"
              ></i>
            </button>
          }
          @case ("loading") {
            <div class="otp-code-row__status" role="status" aria-live="polite">
              <i class="bwi bwi-spinner bwi-spin" aria-hidden="true"></i>
              <span>{{ "i18nGeneratingVerificationCode" | i18n }}</span>
            </div>
          }
          @default {
            <div class="otp-code-row__status" role="status" aria-live="polite">
              <span>{{ "i18nVerificationCodeUnavailable" | i18n }}</span>
              <button
                type="button"
                class="otp-code-row__retry"
                data-testid="otp-retry"
                (click)="retry()"
              >{{ "i18nRetry" | i18n }}</button>
            </div>
          }
        }
      }
    </article>
  `,
})
export class OtpCodeRowComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) item!: VaultItem;
  @Input({ required: true }) field!: VaultField;
  @Input() copied = false;
  @Output() readonly copy = new EventEmitter<VaultField>();

  protected readonly state$ = new BehaviorSubject<OtpRowState>({ kind: "loading" });
  private timer?: ReturnType<typeof setTimeout>;
  private refreshEpoch = 0;
  private failureCount = 0;
  private latestTotp: TotpCode | null = null;
  private generatedCounter: number | null = null;

  constructor(
    @Inject(TOTP_CODE_SOURCE) private readonly codeSource: TotpCodeSource,
    @Inject(TOTP_CLOCK) private readonly clock: () => number,
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["field"]) {
      this.stopRefresh();
      this.failureCount = 0;
      this.latestTotp = null;
      this.generatedCounter = null;
      this.state$.next({ kind: "loading" });
      const seed = this.field?.value.trim() ?? "";
      if (!seed) {
        this.state$.next({ kind: "unavailable" });
        return;
      }
      this.scheduleRefresh(seed, 0);
    }
  }

  ngOnDestroy(): void {
    this.stopRefresh();
  }

  protected totpDash(totp: TotpCode): number {
    const elapsed = totp.period - totp.secondsRemaining;
    return Math.round((60 / totp.period) * elapsed * 100) / 100;
  }

  protected retry(): void {
    const seed = this.field?.value.trim() ?? "";
    this.stopRefresh();
    this.failureCount = 0;
    this.latestTotp = null;
    this.generatedCounter = null;
    this.state$.next(seed ? { kind: "loading" } : { kind: "unavailable" });
    if (seed) {
      this.scheduleRefresh(seed, 0);
    }
  }

  private scheduleRefresh(seed: string, delayMs: number): void {
    const epoch = this.refreshEpoch;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.refresh(seed, epoch);
    }, delayMs);
  }

  private async refresh(seed: string, epoch: number): Promise<void> {
    let nextTotp: TotpCode | null = null;
    let failed = false;
    const now = this.clock();
    try {
      nextTotp = await this.codeSource.generate(seed, now);
    } catch {
      failed = true;
    }
    if (epoch !== this.refreshEpoch || seed !== this.field.value.trim()) {
      return;
    }
    if (nextTotp) {
      this.failureCount = 0;
      this.latestTotp = nextTotp;
      this.generatedCounter = Math.floor(now / nextTotp.period);
      this.state$.next({ kind: "ready", totp: nextTotp });
      this.scheduleTick(seed, 1_000);
      return;
    }

    this.failureCount += 1;
    this.state$.next({ kind: failed ? "error" : "unavailable" });
    const retryDelay = failed
      ? Math.min(30_000, 1_000 * 2 ** this.failureCount)
      : 30_000;
    this.scheduleRefresh(seed, retryDelay);
  }

  private scheduleTick(seed: string, delayMs: number): void {
    const epoch = this.refreshEpoch;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.tick(seed, epoch);
    }, delayMs);
  }

  private async tick(seed: string, epoch: number): Promise<void> {
    const latest = this.latestTotp;
    const now = this.clock();
    if (
      !latest ||
      this.generatedCounter !== Math.floor(now / latest.period)
    ) {
      await this.refresh(seed, epoch);
      return;
    }
    if (epoch !== this.refreshEpoch || seed !== this.field.value.trim()) {
      return;
    }

    const secondsRemaining = latest.period - (now % latest.period);
    const nextTotp: TotpCode = {
      ...latest,
      secondsRemaining,
      isExpiring: secondsRemaining <= 7,
    };
    this.latestTotp = nextTotp;
    this.state$.next({ kind: "ready", totp: nextTotp });
    this.scheduleTick(seed, 1_000);
  }

  private stopRefresh(): void {
    this.refreshEpoch += 1;
    this.latestTotp = null;
    this.generatedCounter = null;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}
