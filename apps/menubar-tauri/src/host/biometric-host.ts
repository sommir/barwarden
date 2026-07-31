export type BiometricAvailability =
  | "available"
  | "not-enrolled"
  | "not-available"
  | "locked-out"
  | "invalid-account";

export type BiometricOperationStatus =
  | "enabled"
  | "disabled"
  | "success"
  | "cancelled"
  | "failed"
  | "not-enrolled"
  | "not-available"
  | "locked-out"
  | "invalidated"
  | "storage-unavailable"
  | "invalid-account";

export interface BiometricHost {
  biometricStatus(accountId: string): Promise<BiometricAvailability>;
  biometricEnable(accountId: string): Promise<BiometricOperationStatus>;
  biometricUnlock(accountId: string): Promise<BiometricOperationStatus>;
  biometricDisable(accountId: string): Promise<BiometricOperationStatus>;
}

export class BiometricHostError extends Error {
  override readonly name = "BiometricHostError";

  constructor(readonly code: "unavailable") {
    super("Biometric unavailable.");
  }
}

const AVAILABILITY_STATUSES = new Set<BiometricAvailability>([
  "available",
  "not-enrolled",
  "not-available",
  "locked-out",
  "invalid-account",
]);

const OPERATION_STATUSES = new Set<BiometricOperationStatus>([
  "enabled",
  "disabled",
  "success",
  "cancelled",
  "failed",
  "not-enrolled",
  "not-available",
  "locked-out",
  "invalidated",
  "storage-unavailable",
  "invalid-account",
]);

export function decodeBiometricAvailability(value: unknown): BiometricAvailability {
  return decodeExactStatus(value, AVAILABILITY_STATUSES);
}

export function decodeBiometricOperation(value: unknown): BiometricOperationStatus {
  return decodeExactStatus(value, OPERATION_STATUSES);
}

function decodeExactStatus<T extends string>(value: unknown, allowed: ReadonlySet<T>): T {
  try {
    if (!isRecord(value)) {
      throw new BiometricHostError("unavailable");
    }
    const keys = Reflect.ownKeys(value);
    const status = value["status"];
    if (
      keys.length !== 1
      || keys[0] !== "status"
      || typeof status !== "string"
      || !allowed.has(status as T)
    ) {
      throw new BiometricHostError("unavailable");
    }
    return status as T;
  } catch {
    throw new BiometricHostError("unavailable");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
