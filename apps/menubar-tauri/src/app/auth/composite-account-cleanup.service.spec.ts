import { describe, expect, it, vi } from "vitest";

import type { GeneratorAccountCleanupService } from "../generator/generator-account-cleanup.service";
import type { UnlockMethodsPort } from "./unlock-methods.port";
import { CompositeAccountCleanupService } from "./composite-account-cleanup.service";

const accountA = "a".repeat(64);

describe("CompositeAccountCleanupService", () => {
  it("clears unlock material before generator and settings state", async () => {
    const events: string[] = [];
    const unlockMethods = unlockMethodsPort({
      clearAccount: async (id) => {
        events.push(`unlock:${id}`);
      },
    });
    const generatorCleanup = {
      clearAccount: vi.fn(async (id: string) => {
        events.push(`generator:${id}`);
      }),
    } as unknown as GeneratorAccountCleanupService;
    const cleanup = new CompositeAccountCleanupService(unlockMethods, generatorCleanup);

    await cleanup.clearAccount(accountA);

    expect(events).toEqual([
      `unlock:${accountA}`,
      `generator:${accountA}`,
    ]);
  });

  it("stops account removal cleanup when unlock material cleanup fails", async () => {
    const generatorCleanup = {
      clearAccount: vi.fn(async () => undefined),
    } as unknown as GeneratorAccountCleanupService;
    const cleanup = new CompositeAccountCleanupService(
      unlockMethodsPort({
        clearAccount: async () => {
          throw new Error("unlock cleanup failed");
        },
      }),
      generatorCleanup,
    );

    await expect(cleanup.clearAccount(accountA)).rejects.toThrow("unlock cleanup failed");

    expect(generatorCleanup.clearAccount).not.toHaveBeenCalled();
  });
});

function unlockMethodsPort(overrides: Partial<UnlockMethodsPort> = {}): UnlockMethodsPort {
  return {
    availability: async () => ({
      pinEnabled: false,
      biometricEnabled: false,
      biometricAvailability: "available",
    }),
    enablePin: async () => undefined,
    disablePin: () => undefined,
    enableBiometric: async () => undefined,
    disableBiometric: async () => undefined,
    unlockWithPin: async () => {
      throw new Error("Unexpected unlockWithPin");
    },
    unlockWithBiometric: async () => {
      throw new Error("Unexpected unlockWithBiometric");
    },
    prepareForLock: () => undefined,
    beginLockEpoch: () => 1,
    currentLockEpoch: () => 1,
    consumeAutomaticBiometricPrompt: () => false,
    clearAccount: async () => undefined,
    ...overrides,
  };
}
