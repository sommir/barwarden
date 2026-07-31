import { Inject, Injectable, InjectionToken, Optional } from "@angular/core";
import { BehaviorSubject, Observable } from "rxjs";

import type { UserId } from "@bitwarden/common/types/guid";
import type { CredentialType } from "@bitwarden/generator-core";
import {
  GeneratedCredential as OfficialGeneratedCredential,
  GeneratorHistoryService,
} from "@bitwarden/generator-history";

import type { HostApi } from "../../host/host-api";
import { TauriHostService } from "../../host/tauri-host.service";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";
import {
  GeneratorHistoryRouteOwner,
  type GeneratorHistoryOwnerToken,
} from "./generator-history-route.owner";
import {
  GENERATOR_CLIPBOARD_POLICY,
  type GeneratorClipboardPolicyPort,
} from "./generator-runtime.port";
import {
  GENERATOR_HISTORY_RUNTIME,
  type GeneratorHistoryRuntimePort,
} from "./generator-history-runtime.port";

export const GENERATOR_HISTORY_CLIPBOARD_HOST = new InjectionToken<HostApi | null>(
  "GENERATOR_HISTORY_CLIPBOARD_HOST",
  { providedIn: "root", factory: () => null },
);

@Injectable()
export class OfficialGeneratorHistoryViewAdapter extends GeneratorHistoryService {
  readonly credentials = new BehaviorSubject<OfficialGeneratedCredential[]>([]);
  readonly loading = new BehaviorSubject(true);
  readonly clearing = new BehaviorSubject(false);
  readonly statusMessage = new BehaviorSubject<string | null>(null);

  private readonly clipboard: HostApi;
  private ownerToken: GeneratorHistoryOwnerToken | null = null;
  private loadStarted = false;
  private loadEpoch = 0;
  private copyEpoch = 0;
  private clearEpoch = 0;
  private active = true;

  constructor(
    @Inject(GENERATOR_HISTORY_RUNTIME) private readonly generator: GeneratorHistoryRuntimePort,
    private readonly owner: GeneratorHistoryRouteOwner,
    @Inject(GENERATOR_CLIPBOARD_POLICY)
    private readonly clipboardPolicy: GeneratorClipboardPolicyPort,
    @Optional() @Inject(GENERATOR_HISTORY_CLIPBOARD_HOST) clipboard: HostApi | null = null,
  ) {
    super();
    this.clipboard = clipboard ?? new TauriHostService();
  }

  override readonly track = async (
    _userId: UserId,
    _credential: string,
    _category: CredentialType,
    _date?: Date,
    _algorithm?: string,
  ): Promise<OfficialGeneratedCredential | null> => null;

  override readonly take = async (
    _userId: UserId,
    _credential: string,
  ): Promise<OfficialGeneratedCredential | null> => null;

  override readonly credentials$ = (userId: UserId): Observable<OfficialGeneratedCredential[]> => {
    this.ensureOwner(userId);
    if (!this.loadStarted) {
      this.loadStarted = true;
      void this.load(userId);
    }
    return this.credentials.asObservable();
  };

  override readonly clear = async (userId: UserId): Promise<OfficialGeneratedCredential[]> => {
    const token = this.ensureOwner(userId);
    if (this.clearing.value) {
      return [];
    }

    const epoch = ++this.clearEpoch;
    if (!await this.isCurrent(token, "clear", epoch)) {
      return [];
    }
    const previous = this.credentials.value;
    this.clearing.next(true);
    this.statusMessage.next(null);
    try {
      await this.generator.clearHistory(
        token.accountId,
        async () => this.isCurrent(token, "clear", epoch),
      );
      if (!await this.isCurrent(token, "clear", epoch)) {
        return [];
      }
      this.credentials.next([]);
      return previous;
    } catch {
      if (await this.isCurrent(token, "clear", epoch)) {
        this.statusMessage.next(translateOfficialMessage("i18nGeneratorHistoryClearFailed"));
      }
      return [];
    } finally {
      if (this.active && epoch === this.clearEpoch) {
        this.clearing.next(false);
      }
    }
  };

  async copy(credential: OfficialGeneratedCredential): Promise<boolean> {
    const token = this.ownerToken;
    if (!token) {
      return false;
    }
    const epoch = ++this.copyEpoch;
    if (!await this.isCurrent(token, "copy", epoch)) {
      return false;
    }
    this.statusMessage.next(null);
    try {
      await this.clipboardPolicy.copy(credential.credential, this.clipboard);
      if (!await this.isCurrent(token, "copy", epoch)) {
        return false;
      }
      return true;
    } catch {
      if (await this.isCurrent(token, "copy", epoch)) {
        this.statusMessage.next(translateOfficialMessage("i18nGeneratorHistoryCopyFailed"));
      }
      return false;
    }
  }

  destroy(): void {
    this.active = false;
    this.loadEpoch += 1;
    this.copyEpoch += 1;
    this.clearEpoch += 1;
    this.owner.destroy();
    this.credentials.complete();
    this.loading.complete();
    this.clearing.complete();
    this.statusMessage.complete();
  }

  private async load(userId: UserId): Promise<void> {
    const token = this.ensureOwner(userId);
    const epoch = ++this.loadEpoch;
    this.loading.next(true);
    this.statusMessage.next(null);
    try {
      const credentials = await this.generator.history(
        token.accountId,
        async () => this.isCurrent(token, "load", epoch),
      );
      if (!await this.isCurrent(token, "load", epoch)) {
        return;
      }
      this.credentials.next(credentials
        .filter(({ credential }) => credential.length > 0)
        .map(({ credential, category, generationDate, algorithm }) =>
          new OfficialGeneratedCredential(credential, category, generationDate, algorithm)));
    } catch {
      if (await this.isCurrent(token, "load", epoch)) {
        this.statusMessage.next(translateOfficialMessage("i18nGeneratorHistoryLoadFailed"));
      }
    } finally {
      if (this.active && epoch === this.loadEpoch) {
        this.loading.next(false);
      }
    }
  }

  private ensureOwner(userId: UserId): GeneratorHistoryOwnerToken {
    const accountId = String(userId);
    if (!this.ownerToken) {
      this.ownerToken = this.owner.capture(accountId);
    }
    if (this.ownerToken.accountId !== accountId) {
      throw new Error("Generator history account changed");
    }
    return this.ownerToken;
  }

  private async isCurrent(
    token: GeneratorHistoryOwnerToken,
    operation: "load" | "copy" | "clear",
    epoch: number,
  ): Promise<boolean> {
    if (!this.isLocallyCurrent(token, operation, epoch)) {
      return false;
    }
    try {
      const active = await this.generator.activeSettings();
      return active.accountId === token.accountId
        && this.isLocallyCurrent(token, operation, epoch);
    } catch {
      return false;
    }
  }

  private isLocallyCurrent(
    token: GeneratorHistoryOwnerToken,
    operation: "load" | "copy" | "clear",
    epoch: number,
  ): boolean {
    const currentEpoch = operation === "load"
      ? this.loadEpoch
      : operation === "copy"
        ? this.copyEpoch
        : this.clearEpoch;
    return this.active && epoch === currentEpoch && this.owner.isCurrent(token);
  }
}
