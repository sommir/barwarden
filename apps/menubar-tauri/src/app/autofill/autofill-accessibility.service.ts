import { Inject, Injectable, InjectionToken, Optional } from "@angular/core";

import { TauriHostService } from "../../host/tauri-host.service";

export type AccessibilityPermission = "granted" | "denied";
export type AccessibilityObservation = "stopped" | "hidden" | "visible";
export type AccessibilityFallback = "system-autofill" | "unsupported";
const DIAGNOSTIC_REASONS = new Set([
  "permission-denied",
  "system-autofill-preferred",
  "invalid-application",
  "owned-application",
  "application-terminated",
  "application-unavailable",
  "application-changed",
  "observer-unavailable",
  "stale-element",
  "stale-window",
  "stale-observation",
  "unsupported-role",
  "not-editable",
  "missing-frame",
  "unreliable-geometry",
  "offscreen",
]);

export interface AccessibilityDiagnostic {
  readonly reason: string;
  readonly bundleId?: string;
}

export interface AccessibilityStatus {
  readonly permission: AccessibilityPermission;
  readonly observation: AccessibilityObservation;
  readonly diagnostic?: AccessibilityDiagnostic;
}

export interface AutoFillAccessibilityHost {
  status(): Promise<AccessibilityStatus>;
  setFallback(fallback: AccessibilityFallback): Promise<void>;
  requestPermission(): Promise<AccessibilityStatus>;
}

export const AUTOFILL_ACCESSIBILITY_HOST = new InjectionToken<AutoFillAccessibilityHost>(
  "AUTOFILL_ACCESSIBILITY_HOST",
);

@Injectable({ providedIn: "root" })
export class AutoFillAccessibilityService {
  private readonly host: AutoFillAccessibilityHost;

  constructor(
    @Optional() @Inject(AUTOFILL_ACCESSIBILITY_HOST) host: AutoFillAccessibilityHost | null,
  ) {
    this.host = host ?? new TauriHostService();
  }

  async status(): Promise<AccessibilityStatus> {
    return decodeAccessibilityStatus(await this.host.status());
  }

  stopForSystemAutoFill(): Promise<void> {
    return this.host.setFallback("system-autofill");
  }

  startUnsupportedFallback(): Promise<void> {
    return this.host.setFallback("unsupported");
  }

  async requestPermissionFromUserAction(): Promise<AccessibilityStatus> {
    return decodeAccessibilityStatus(await this.host.requestPermission());
  }
}

export function decodeAccessibilityStatus(value: unknown): AccessibilityStatus {
  const record = exactRecord(value, ["permission", "observation", "diagnostic"]);
  if (record.permission !== "granted" && record.permission !== "denied") {
    throw new Error("invalid accessibility status");
  }
  if (record.observation !== "stopped"
      && record.observation !== "hidden"
      && record.observation !== "visible") {
    throw new Error("invalid accessibility status");
  }
  const status: AccessibilityStatus = {
    permission: record.permission,
    observation: record.observation,
  };
  if (record.diagnostic !== undefined) {
    const diagnostic = exactRecord(record.diagnostic, ["reason", "bundleId"]);
    if (typeof diagnostic.reason !== "string" || !DIAGNOSTIC_REASONS.has(diagnostic.reason)) {
      throw new Error("invalid accessibility status");
    }
    if (diagnostic.bundleId !== undefined
        && (typeof diagnostic.bundleId !== "string" || !validBundleId(diagnostic.bundleId))) {
      throw new Error("invalid accessibility status");
    }
    return {
      ...status,
      diagnostic: {
        reason: diagnostic.reason,
        ...(diagnostic.bundleId === undefined ? {} : { bundleId: diagnostic.bundleId }),
      },
    };
  }
  return status;
}

function validBundleId(value: string): boolean {
  return value.length > 0
    && value.length <= 255
    && /^[\x00-\x7F]+$/.test(value)
    && value.split(".").length >= 2
    && value.split(".").every((segment) => (
      segment.length > 0
      && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(segment)
    ));
}

function exactRecord(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid accessibility status");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowed.includes(key))) {
    throw new Error("invalid accessibility status");
  }
  return record;
}
