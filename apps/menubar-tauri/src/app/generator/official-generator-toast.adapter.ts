import { Inject, Injectable } from "@angular/core";

import { GENERATOR_STATUS, type GeneratorStatusPort } from "./generator-runtime.port";
import { AppFeedbackService } from "../official-ui/app-feedback.service";

@Injectable()
export class OfficialGeneratorToastAdapter {
  constructor(
    @Inject(GENERATOR_STATUS) private readonly status: GeneratorStatusPort,
    private readonly feedback: AppFeedbackService,
  ) {}

  showToast(options: {
    readonly message: string | readonly string[];
    readonly variant?: "error" | "success" | "warning" | "info";
    readonly title?: string | null;
    readonly timeout?: number;
  }): void {
    const message = typeof options.message === "string" ? options.message : options.message.join(" ");
    this.status.setStatus(message);
    if (options.variant === "success") {
      this.feedback.show(message, { kind: "success", durationMs: options.timeout });
    }
  }
}
