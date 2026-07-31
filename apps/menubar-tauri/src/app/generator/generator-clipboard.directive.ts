import {
  Directive,
  ElementRef,
  HostListener,
  Inject,
  Input,
  OnDestroy,
  Optional,
} from "@angular/core";

import type { HostApi } from "../../host/host-api";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";
import {
  GENERATOR_CLIPBOARD_HOST,
  GENERATOR_CLIPBOARD_POLICY,
  GENERATOR_RUNTIME,
  GENERATOR_STATUS,
  type GeneratorClipboardPolicyPort,
  type GeneratorRuntimePort,
  type GeneratorStatusPort,
} from "./generator-runtime.port";

@Directive({ selector: "[bwGeneratorClipboard]", standalone: true })
export class GeneratorClipboardDirective implements OnDestroy {
  @Input({ required: true }) bwGeneratorClipboard: string | null = null;
  @Input() valueLabel: string | null = null;
  private feedbackTimer?: number;
  private restingLabel: string | null = null;

  constructor(
    @Inject(GENERATOR_RUNTIME) private readonly runtime: GeneratorRuntimePort,
    @Inject(GENERATOR_CLIPBOARD_POLICY) private readonly clipboard: GeneratorClipboardPolicyPort,
    @Inject(GENERATOR_STATUS) private readonly status: GeneratorStatusPort,
    @Optional() @Inject(GENERATOR_CLIPBOARD_HOST) private readonly host: HostApi | null,
    private readonly elementRef: ElementRef<HTMLButtonElement>,
  ) {}

  ngOnDestroy(): void {
    this.clearFeedbackTimer();
  }

  @HostListener("click")
  async copy(): Promise<void> {
    const value = this.bwGeneratorClipboard;
    if (!value || value === "-") return;
    const accountId = (await this.runtime.activeSettings()).accountId;
    try {
      await this.clipboard.copy(value, this.host);
    } catch (error) {
      this.restoreCopyState();
      throw error;
    }
    try {
      if ((await this.runtime.activeSettings()).accountId === accountId) {
        this.status.setStatus(
          translateOfficialMessage(
            "i18nCopiedLabel",
            translateOfficialMessage("i18nGeneratedResult"),
          ),
        );
        this.showCopiedState();
      }
    } catch {
      // A locked or switched account invalidates clipboard success publication.
      this.restoreCopyState();
    }
  }

  private showCopiedState(): void {
    const button = this.elementRef.nativeElement;
    const icon = button.querySelector<HTMLElement>(".bwi");
    this.restingLabel ??= button.getAttribute("aria-label");
    icon?.classList.remove("bwi-clone");
    icon?.classList.add("bwi-check", "macos-copy-feedback-icon");
    button.classList.add("is-copy-confirmed");
    button.setAttribute(
      "aria-label",
      this.valueLabel
        ? translateOfficialMessage("i18nCopiedLabel", this.valueLabel)
        : translateOfficialMessage("i18nCopied"),
    );
    this.clearFeedbackTimer();
    this.feedbackTimer = window.setTimeout(() => this.restoreCopyState(), 1_000);
  }

  private restoreCopyState(): void {
    this.clearFeedbackTimer();
    const button = this.elementRef.nativeElement;
    const icon = button.querySelector<HTMLElement>(".bwi");
    icon?.classList.remove("bwi-check", "macos-copy-feedback-icon");
    icon?.classList.add("bwi-clone");
    button.classList.remove("is-copy-confirmed");
    if (this.restingLabel) {
      button.setAttribute("aria-label", this.restingLabel);
    }
  }

  private clearFeedbackTimer(): void {
    if (this.feedbackTimer !== undefined) {
      window.clearTimeout(this.feedbackTimer);
      this.feedbackTimer = undefined;
    }
  }
}
