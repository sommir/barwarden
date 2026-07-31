import { InjectionToken } from "@angular/core";
import { listen } from "@tauri-apps/api/event";
import { ReplaySubject, type Observable } from "rxjs";

import type {
  ProcessSessionAttachment,
  ProcessSessionBrokerHost,
  ProcessSessionMutation,
  ProcessSessionSnapshot,
} from "../../host/host-api";
import { ProcessSessionBrokerError } from "../../host/host-api";
import { createDefaultHostService } from "../../host/default-host.service";
import { isTauriRuntime } from "../../host/default-host.service";

const PROCESS_SESSION_EVENT = "barwarden://session-broker-changed";

export interface ProcessSessionEventSource {
  listen(listener: () => void): Promise<() => void>;
}

export interface ProcessSessionBrokerPort {
  readonly changes$: Observable<ProcessSessionSnapshot>;
  attach(): Promise<ProcessSessionAttachment>;
  mutate(mutation: ProcessSessionMutation): Promise<ProcessSessionSnapshot>;
  setSessionHandoff?(session: unknown): Promise<void>;
  sessionHandoff?(): Promise<unknown | null>;
  destroy(): void;
}

export const PROCESS_SESSION_BROKER =
  new InjectionToken<ProcessSessionBrokerPort | null>(
    "PROCESS_SESSION_BROKER",
    {
      providedIn: "root",
      factory: () =>
        isTauriRuntime() ? new ProcessSessionBrokerService() : null,
    },
  );

class NativeProcessSessionEventSource implements ProcessSessionEventSource {
  async listen(listener: () => void): Promise<() => void> {
    return listen(PROCESS_SESSION_EVENT, () => listener());
  }
}

export class ProcessSessionBrokerService implements ProcessSessionBrokerPort {
  private readonly changesSubject = new ReplaySubject<ProcessSessionSnapshot>(1);
  private attachmentPromise: Promise<ProcessSessionAttachment> | null = null;
  private refreshPromise: Promise<ProcessSessionSnapshot> | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();
  private refreshRetryTimer: number | undefined;
  private pendingLocalMutations = 0;
  private refreshAfterLocalMutation = false;
  private unlisten: (() => void) | null = null;
  private currentSnapshot: ProcessSessionSnapshot | null = null;
  private destroyed = false;
  readonly changes$: Observable<ProcessSessionSnapshot> =
    this.changesSubject.asObservable();

  constructor(
    private readonly host: ProcessSessionBrokerHost = createDefaultHostService(),
    private readonly events: ProcessSessionEventSource =
      new NativeProcessSessionEventSource(),
  ) {}

  attach(): Promise<ProcessSessionAttachment> {
    if (this.attachmentPromise) {
      return this.attachmentPromise;
    }
    const attempt = this.attachOnce();
    this.attachmentPromise = attempt;
    void attempt.catch(() => {
      if (this.attachmentPromise === attempt) {
        this.attachmentPromise = null;
      }
    });
    return attempt;
  }

  mutate(mutation: ProcessSessionMutation): Promise<ProcessSessionSnapshot> {
    this.pendingLocalMutations += 1;
    const operation = this.mutationQueue.then(async () => {
      await this.attach();
      const snapshot = await this.host.mutateProcessSession(mutation);
      // Native mutations emit the same version back through the process event.
      // Record local ownership of that version without presenting it to this
      // window as a remote lifecycle transition.
      this.remember(snapshot);
      return snapshot;
    });
    this.mutationQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation.finally(() => {
      this.pendingLocalMutations -= 1;
      if (this.pendingLocalMutations === 0 && this.refreshAfterLocalMutation) {
        this.refreshAfterLocalMutation = false;
        this.refreshFromEvent(0);
      }
    });
  }

  async setSessionHandoff(session: unknown): Promise<void> {
    await this.attach();
    await this.host.setProcessSessionHandoff?.(session);
  }

  async sessionHandoff(): Promise<unknown | null> {
    await this.attach();
    return this.host.processSessionHandoff?.() ?? null;
  }

  destroy(): void {
    this.destroyed = true;
    this.unlisten?.();
    this.unlisten = null;
    if (this.refreshRetryTimer !== undefined) {
      window.clearTimeout(this.refreshRetryTimer);
      this.refreshRetryTimer = undefined;
    }
    this.changesSubject.complete();
  }

  private async attachOnce(): Promise<ProcessSessionAttachment> {
    let attemptUnlisten: (() => void) | null = null;
    try {
      const attachment = await this.host.attachProcessSession();
      attemptUnlisten = await this.events.listen(() => this.refreshFromEvent(0));
      const reconciled = await this.host.processSessionSnapshot();
      const snapshot =
        reconciled.processGeneration === attachment.snapshot.processGeneration &&
        reconciled.version >= attachment.snapshot.version
          ? reconciled
          : attachment.snapshot;
      if (this.destroyed) {
        attemptUnlisten();
        attemptUnlisten = null;
      } else {
        this.unlisten = attemptUnlisten;
      }
      this.commit(snapshot);
      return { startupMode: attachment.startupMode, snapshot };
    } catch {
      attemptUnlisten?.();
      throw new ProcessSessionBrokerError("unavailable");
    }
  }

  private refresh(): Promise<ProcessSessionSnapshot> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }
    const refresh = this.host.processSessionSnapshot().then((snapshot) => {
      this.commit(snapshot);
      return snapshot;
    });
    this.refreshPromise = refresh;
    const clearRefresh = () => {
      if (this.refreshPromise === refresh) {
        this.refreshPromise = null;
      }
    };
    void refresh.then(clearRefresh, clearRefresh);
    return refresh;
  }

  private refreshFromEvent(attempt: number): void {
    if (this.pendingLocalMutations > 0) {
      this.refreshAfterLocalMutation = true;
      return;
    }
    void this.refresh().catch(() => {
      if (this.destroyed || attempt >= 2 || this.refreshRetryTimer !== undefined) {
        return;
      }
      this.refreshRetryTimer = window.setTimeout(() => {
        this.refreshRetryTimer = undefined;
        this.refreshFromEvent(attempt + 1);
      }, 100 * (attempt + 1));
    });
  }

  private commit(snapshot: ProcessSessionSnapshot): void {
    if (
      this.destroyed ||
      (this.currentSnapshot?.processGeneration === snapshot.processGeneration &&
        this.currentSnapshot.version >= snapshot.version)
    ) {
      return;
    }
    this.remember(snapshot);
    this.changesSubject.next(snapshot);
  }

  private remember(snapshot: ProcessSessionSnapshot): void {
    if (
      !this.currentSnapshot ||
      this.currentSnapshot.processGeneration !== snapshot.processGeneration ||
      snapshot.version > this.currentSnapshot.version
    ) {
      this.currentSnapshot = snapshot;
    }
  }
}
