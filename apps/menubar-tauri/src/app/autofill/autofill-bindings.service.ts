import { Injectable } from "@angular/core";
import { Subject } from "rxjs";

export interface AutoFillBindingProjection {
  readonly bundleId: string;
  readonly cipherId: string;
}

export interface AutoFillHistoryProjection {
  readonly contextKey: string;
  readonly cipherId: string;
  readonly successfulSelectionCount: number;
  readonly lastSelectedAt: number;
}

export interface AutoFillMatchingProjection {
  readonly bindings: readonly AutoFillBindingProjection[];
  readonly history: readonly AutoFillHistoryProjection[];
}

export interface SuccessfulAutoFillSelection {
  readonly accountId: string;
  readonly bundleId: string;
  readonly serviceIdentifiers: readonly string[];
  readonly cipherId: string;
  readonly selectedAt: string;
  readonly explicitUserAction: boolean;
  readonly succeeded: boolean;
}

@Injectable({ providedIn: "root" })
export class AutoFillBindingsService {
  private readonly changesSubject = new Subject<void>();
  readonly changes$ = this.changesSubject.asObservable();
  private readonly bindings = new Map<string, Map<string, string>>();
  private readonly history = new Map<string, Map<string, AutoFillHistoryProjection>>();
  private readonly lastUsedAt = new Map<string, Map<string, number>>();

  bind(accountId: string, bundleId: string, cipherId: string): void {
    const account = required(accountId);
    const bundle = normalizeBundleId(bundleId);
    const cipher = required(cipherId);
    const scoped = this.bindings.get(account) ?? new Map<string, string>();
    scoped.set(bundle, cipher);
    this.bindings.set(account, scoped);
    this.changesSubject.next();
  }

  unbind(accountId: string, bundleId: string): void {
    if (this.bindings.get(required(accountId))?.delete(normalizeBundleId(bundleId))) {
      this.changesSubject.next();
    }
  }

  bindingFor(accountId: string, bundleId: string): string | undefined {
    return this.bindings.get(required(accountId))?.get(normalizeBundleId(bundleId));
  }

  recordSuccessfulSelection(selection: SuccessfulAutoFillSelection): void {
    if (!selection.explicitUserAction || !selection.succeeded) return;
    const account = required(selection.accountId);
    const cipherId = required(selection.cipherId);
    const selectedAtText = required(selection.selectedAt);
    if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(selectedAtText)) {
      throw new Error("invalid selection timestamp");
    }
    const selectedAt = Date.parse(selectedAtText);
    if (!Number.isFinite(selectedAt) || selectedAt <= 0) throw new Error("invalid selection timestamp");
    const contextKey = matchingContextKey(selection.bundleId, selection.serviceIdentifiers);
    const key = `${contextKey}\u0000${cipherId}`;
    const scoped = this.history.get(account) ?? new Map<string, AutoFillHistoryProjection>();
    const previous = scoped.get(key);
    scoped.set(key, {
      contextKey,
      cipherId,
      successfulSelectionCount: Math.min((previous?.successfulSelectionCount ?? 0) + 1, 0xffff_ffff),
      lastSelectedAt: previous && previous.lastSelectedAt > selectedAt
        ? previous.lastSelectedAt
        : selectedAt,
    });
    this.history.set(account, scoped);
    const recent = this.lastUsedAt.get(account) ?? new Map<string, number>();
    recent.set(cipherId, Math.max(recent.get(cipherId) ?? 0, selectedAt));
    this.lastUsedAt.set(account, recent);
    this.changesSubject.next();
  }

  lastUsedAtFor(accountId: string, cipherId: string): number | undefined {
    return this.lastUsedAt.get(required(accountId))?.get(required(cipherId));
  }

  snapshot(accountId: string): AutoFillMatchingProjection {
    const account = required(accountId);
    const bindings = [...(this.bindings.get(account) ?? new Map()).entries()]
      .map(([bundleId, cipherId]) => ({ bundleId, cipherId }))
      .sort((left, right) => left.bundleId.localeCompare(right.bundleId) || left.cipherId.localeCompare(right.cipherId));
    const history = [...(this.history.get(account) ?? new Map()).values()]
      .sort((left, right) => left.contextKey.localeCompare(right.contextKey) || left.cipherId.localeCompare(right.cipherId));
    return { bindings, history };
  }

  clearAccount(accountId: string): void {
    const account = required(accountId);
    this.bindings.delete(account);
    this.history.delete(account);
    this.lastUsedAt.delete(account);
    this.changesSubject.next();
  }

  clearAccountAfterProjectionRemoval(accountId: string): void {
    const account = required(accountId);
    this.bindings.delete(account);
    this.history.delete(account);
    this.lastUsedAt.delete(account);
  }
}

export function matchingContextKey(bundleId: string, serviceIdentifiers: readonly string[]): string {
  const bundle = normalizeBundleId(bundleId, false);
  if (bundle) return `app:${bundle}`;
  const hosts = serviceIdentifiers.flatMap((service) => {
    try {
      return [new URL(service.includes("://") ? service : `https://${service}`).hostname.toLowerCase()];
    } catch {
      return [];
    }
  }).sort();
  return hosts[0] ? `service:${hosts[0]}` : "unknown";
}

function normalizeBundleId(value: string, failEmpty = true): string {
  const normalized = value.trim().normalize("NFC").toLowerCase();
  if (failEmpty && !normalized) throw new Error("invalid bundle id");
  return normalized;
}

function required(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error("missing identifier");
  return normalized;
}
