import {
  Inject,
  Injectable,
  InjectionToken,
  type OnDestroy,
  Optional,
} from "@angular/core";

import type {
  GlobalShortcutBinding,
  GlobalShortcutHost,
  GlobalShortcutMutationOutcome,
  GlobalShortcutSnapshot,
} from "../../host/global-shortcut";
import { TauriHostService } from "../../host/tauri-host.service";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";

export interface GlobalShortcutSettingsView {
  readonly shortcut: GlobalShortcutBinding | null;
  readonly availability: "active" | "cleared" | "unavailable";
  readonly pending: boolean;
  readonly message: string;
}

export const GLOBAL_SHORTCUT_SETTINGS_HOST = new InjectionToken<GlobalShortcutHost | null>(
  "GLOBAL_SHORTCUT_SETTINGS_HOST",
  {
    providedIn: "root",
    factory: () => null,
  },
);

@Injectable()
export class GlobalShortcutSettingsService implements OnDestroy {
  private readonly host: GlobalShortcutHost;
  private view = createView(
    { shortcut: null, availability: "unavailable" },
    false,
    "",
  );
  private mutationQueue: Promise<void> = Promise.resolve();
  private readonly queuedOperations = new Map<string, Promise<void>>();
  private pendingOperations = 0;
  private alive = true;

  constructor(
    @Optional() @Inject(GLOBAL_SHORTCUT_SETTINGS_HOST) host: GlobalShortcutHost | null = null,
  ) {
    this.host = host ?? new TauriHostService();
  }

  snapshot(): GlobalShortcutSettingsView {
    return this.view;
  }

  load(): Promise<void> {
    return this.enqueue("load", async () => {
      try {
        const snapshot = await this.host.getGlobalShortcut();
        this.publish(
          snapshot,
          snapshot.availability === "unavailable"
            ? translateOfficialMessage("i18nShortcutInUse")
            : "",
        );
      } catch {
        this.publishCurrent(translateOfficialMessage("i18nShortcutUpdateFailed"));
      }
    });
  }

  replace(shortcut: GlobalShortcutBinding): Promise<void> {
    return this.enqueue(`replace:${shortcut.modifiers.join("+")}:${shortcut.code}`, async () => {
      try {
        this.publishOutcome(await this.host.setGlobalShortcut(shortcut));
      } catch {
        this.publishCurrent(translateOfficialMessage("i18nShortcutUpdateFailed"));
      }
    });
  }

  clear(): Promise<void> {
    return this.enqueue("clear", async () => {
      try {
        this.publishOutcome(await this.host.clearGlobalShortcut());
      } catch {
        this.publishCurrent(translateOfficialMessage("i18nShortcutUpdateFailed"));
      }
    });
  }

  ngOnDestroy(): void {
    if (!this.alive) {
      return;
    }
    this.alive = false;
    this.pendingOperations = 0;
    this.queuedOperations.clear();
    this.view = createView(this.view, false, this.view.message);
  }

  private enqueue(key: string, operation: () => Promise<void>): Promise<void> {
    if (!this.alive) {
      return Promise.resolve();
    }

    const duplicate = this.queuedOperations.get(key);
    if (duplicate) {
      return duplicate;
    }

    this.pendingOperations += 1;
    this.publishCurrent("");

    const queued = this.mutationQueue.then(async () => {
      if (this.alive) {
        await operation();
      }
    });
    const settled = queued.finally(() => {
      this.queuedOperations.delete(key);
      if (this.alive) {
        this.pendingOperations -= 1;
        this.view = createView(
          this.view,
          this.pendingOperations > 0,
          this.view.message,
        );
      }
    });

    this.queuedOperations.set(key, settled);
    this.mutationQueue = settled;
    return settled;
  }

  private publishOutcome(outcome: GlobalShortcutMutationOutcome): void {
    this.publish(outcome.snapshot, outcomeMessage(outcome.status));
  }

  private publish(snapshot: GlobalShortcutSnapshot, message: string): void {
    if (!this.alive) {
      return;
    }
    this.view = createView(snapshot, this.pendingOperations > 0, message);
  }

  private publishCurrent(message: string): void {
    this.publish(this.view, message);
  }
}

function outcomeMessage(status: GlobalShortcutMutationOutcome["status"]): string {
  switch (status) {
    case "updated":
    case "unchanged":
      return "";
    case "invalid":
      return translateOfficialMessage("i18nShortcutInvalid");
    case "unavailable":
      return translateOfficialMessage("i18nShortcutInUse");
    case "failed":
      return translateOfficialMessage("i18nShortcutUpdateFailed");
  }
}

function createView(
  snapshot: Pick<GlobalShortcutSettingsView, "shortcut" | "availability">,
  pending: boolean,
  message: string,
): GlobalShortcutSettingsView {
  const shortcut = snapshot.shortcut === null
    ? null
    : Object.freeze({
        modifiers: Object.freeze([...snapshot.shortcut.modifiers]),
        code: snapshot.shortcut.code,
      });

  return Object.freeze({
    shortcut,
    availability: snapshot.availability,
    pending,
    message,
  });
}
