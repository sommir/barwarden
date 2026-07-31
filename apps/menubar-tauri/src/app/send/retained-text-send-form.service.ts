import type { TextSendDraft } from "./text-send-operation";
import type { TextSendPolicy } from "./text-send-policy";

export interface RetainedTextSendFormValue {
  readonly name: string;
  readonly text: string;
  readonly hidden: boolean;
  readonly deletionPresetHours: 1 | 24 | 48 | 72 | 168 | 336 | 720;
  readonly authType: "none" | "password";
  readonly password: string;
  readonly maxAccessCount: string;
  readonly hideEmail: boolean;
  readonly notes: string;
}

const emptyValue: RetainedTextSendFormValue = {
  name: "", text: "", hidden: false, deletionPresetHours: 168, authType: "none",
  password: "", maxAccessCount: "", hideEmail: false, notes: "",
};

export class RetainedTextSendFormService {
  private original = emptyValue;
  private current = emptyValue;
  private existingDeletionDate: string | undefined;
  private deletionPresetChanged = false;
  private changeRevision = 0;

  constructor(private readonly policy: Pick<TextSendPolicy, "hideEmailAllowed"> | (() => boolean)) {}

  initialize(value: RetainedTextSendFormValue, existingDeletionDate?: string): void {
    this.original = { ...value };
    this.current = { ...value };
    this.existingDeletionDate = existingDeletionDate;
    this.deletionPresetChanged = false;
    this.changeRevision += 1;
  }

  patch(value: Partial<RetainedTextSendFormValue>): void {
    if (Object.hasOwn(value, "deletionPresetHours")) {
      this.deletionPresetChanged = true;
    }
    this.current = { ...this.current, ...value };
    this.changeRevision += 1;
  }

  value(): RetainedTextSendFormValue { return { ...this.current }; }
  revision(): number { return this.changeRevision; }
  dirty(): boolean { return JSON.stringify(this.current) !== JSON.stringify(this.original); }
  valid(): boolean {
    const maximum = this.maxAccessCount();
    const passwordValid = this.current.authType !== "password" ||
      this.original.authType === "password" ||
      this.current.password.trim().length > 0;
    return this.current.name.trim().length > 0 && this.current.text.trim().length > 0 &&
      passwordValid && (maximum === undefined || maximum !== null);
  }

  draft(now: Date): TextSendDraft {
    if (!this.valid()) throw new Error("Invalid Text Send form");
    const maximum = this.maxAccessCount();
    return {
      name: this.current.name.trim(), text: this.current.text, notes: this.current.notes.trim(),
      authType: this.current.authType,
      hidden: this.current.hidden,
      hideEmail: this.hideEmailAllowed() && this.current.hideEmail,
      deletionDate: this.existingDeletionDate && !this.deletionPresetChanged
        ? this.existingDeletionDate
        : new Date(now.getTime() + this.current.deletionPresetHours * 3_600_000).toISOString(),
      ...(maximum == null ? {} : { maxAccessCount: maximum }),
      ...(this.current.authType === "password" && this.current.password.trim()
        ? { password: this.current.password } : {}),
    };
  }

  reset(): void { this.current = { ...this.original }; this.changeRevision += 1; }
  destroy(): void {
    this.original = { ...emptyValue };
    this.current = { ...emptyValue };
    this.existingDeletionDate = undefined;
    this.deletionPresetChanged = false;
    this.changeRevision += 1;
  }

  private hideEmailAllowed(): boolean {
    return typeof this.policy === "function" ? this.policy() : this.policy.hideEmailAllowed;
  }

  private maxAccessCount(): number | null | undefined {
    const raw = this.current.maxAccessCount.trim();
    if (!raw) return undefined;
    const value = Number(raw);
    return Number.isInteger(value) && value >= 1 ? value : null;
  }
}
