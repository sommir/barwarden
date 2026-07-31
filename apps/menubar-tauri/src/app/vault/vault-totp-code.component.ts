import {
  booleanAttribute,
  Component,
  EventEmitter,
  Inject,
  InjectionToken,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
} from "@angular/core";
import { AsyncPipe } from "@angular/common";
import { BehaviorSubject } from "rxjs";

import type { VaultField } from "../vault-demo";
import {
  BitFormFieldComponent,
  BitIconButtonComponent,
  BitInputDirective,
  BitLabelComponent,
  BitSuffixDirective,
} from "../official-ui/official-components";
import { generateTotpCode, type TotpCode } from "./totp.service";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";
import { I18nPipe } from "../official-ui/official-ui-common";

export interface TotpCodeSource {
  generate(seed: string, epochSeconds: number): Promise<TotpCode | null>;
}

export const TOTP_CODE_SOURCE = new InjectionToken<TotpCodeSource>("TOTP_CODE_SOURCE", {
  providedIn: "root",
  factory: () => ({ generate: generateTotpCode }),
});

export const TOTP_CLOCK = new InjectionToken<() => number>("TOTP_CLOCK", {
  providedIn: "root",
  factory: () => () => Math.floor(Date.now() / 1_000),
});

@Component({
  selector: "bw-vault-totp-code",
  standalone: true,
  imports: [
    AsyncPipe,
    BitFormFieldComponent,
    BitIconButtonComponent,
    BitInputDirective,
    BitLabelComponent,
    BitSuffixDirective,
    I18nPipe,
  ],
  template: `
    @if (totp$ | async; as totp) {
      <bit-form-field class="official-totp-field">
        <bit-label>{{ "verificationCodeTotp" | i18n }}</bit-label>
          <input
            id="totp"
            readonly
            bitInput
            aria-readonly="true"
            data-testid="login-totp"
            [value]="totp.formattedCode"
          />
          <span
            bitSuffix
            class="official-totp-countdown"
            [class.is-expiring]="totp.isExpiring"
            [attr.aria-label]="'i18nVerificationCodeExpires' | i18n: totp.secondsRemaining"
          >
            <span>{{ totp.secondsRemaining }}</span>
            <svg transform="rotate(-90)" viewBox="0 0 28 28" aria-hidden="true">
              <circle
                r="9.5"
                cy="14"
                cx="14"
                stroke-width="2"
                stroke-dasharray="60"
                [attr.stroke-dashoffset]="totpDash(totp)"
              ></circle>
              <circle r="11" cy="14" cx="14" stroke-width="1" stroke-dasharray="71"></circle>
            </svg>
          </span>
          <button bitIconButton="bwi-clone" bitSuffix type="button" [label]="'i18nCopyVerificationCode' | i18n" data-testid="copy-totp" (click)="copy.emit(field(totp))"></button>
          @if (canFill) {
            <button bitIconButton="bwi-clone" bitSuffix type="button" [label]="'i18nFillVerificationCode' | i18n" data-testid="fill-totp" (click)="fill.emit(field(totp))"></button>
          }
      </bit-form-field>
    }
  `,
})
export class VaultTotpCodeComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) seed = "";
  @Input({ transform: booleanAttribute }) canFill = false;
  @Output() copy = new EventEmitter<VaultField>();
  @Output() fill = new EventEmitter<VaultField>();

  readonly totp$ = new BehaviorSubject<TotpCode | null>(null);
  private initialRefresh: ReturnType<typeof setTimeout> | undefined;
  private latestTotp: TotpCode | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generatedCounter: number | null = null;

  constructor(
    @Inject(TOTP_CODE_SOURCE) private readonly codeSource: TotpCodeSource,
    @Inject(TOTP_CLOCK) private readonly clock: () => number,
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["seed"]) {
      this.stopRefresh();
      this.latestTotp = null;
      this.generatedCounter = null;
      this.totp$.next(null);
      const seed = this.seed.trim();
      this.initialRefresh = setTimeout(() => {
        this.initialRefresh = undefined;
        void this.resetSeed(seed);
      });
    }
  }

  ngOnDestroy(): void {
    if (this.initialRefresh) {
      clearTimeout(this.initialRefresh);
    }
    this.stopRefresh();
  }

  field(totp: TotpCode): VaultField {
    return {
      id: "otp",
      label: translateOfficialMessage("verificationCodeTotp"),
      value: totp.code,
      type: "text",
    };
  }

  totpDash(totp: TotpCode): number {
    const elapsed = totp.period - totp.secondsRemaining;
    return Math.round((60 / totp.period) * elapsed * 100) / 100;
  }

  private async resetSeed(seed: string): Promise<void> {
    if (!seed || seed !== this.seed.trim()) {
      return;
    }

    await this.refresh(seed);
    if (seed === this.seed.trim() && this.latestTotp) {
      this.scheduleTick(seed, 1_000);
    }
  }

  private async refresh(seed: string): Promise<void> {
    let code: TotpCode | null;
    const now = this.clock();
    try {
      code = await this.codeSource.generate(seed, now);
    } catch {
      code = null;
    }

    if (seed === this.seed.trim()) {
      this.latestTotp = code;
      this.generatedCounter = code ? Math.floor(now / code.period) : null;
      this.totp$.next(code);
    }
  }

  private scheduleTick(seed: string, delayMs: number): void {
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.tick(seed);
    }, delayMs);
  }

  private async tick(seed: string): Promise<void> {
    const latest = this.latestTotp;
    const now = this.clock();
    if (!latest || this.generatedCounter !== Math.floor(now / latest.period)) {
      await this.refresh(seed);
    } else if (seed === this.seed.trim()) {
      const secondsRemaining = latest.period - (now % latest.period);
      const next: TotpCode = {
        ...latest,
        secondsRemaining,
        isExpiring: secondsRemaining <= 7,
      };
      this.latestTotp = next;
      this.totp$.next(next);
    }

    if (seed === this.seed.trim() && this.latestTotp) {
      this.scheduleTick(seed, 1_000);
    }
  }

  private stopRefresh(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.generatedCounter = null;
  }
}
