import { webcrypto } from "node:crypto";

import { TotpService } from "@bitwarden/common/vault/abstractions/totp.service";
import { defaultIfEmpty, firstValueFrom, take, tap, toArray } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OfficialTotpServiceAdapter } from "./official-totp.service.adapter";

const RFC_SEED = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

beforeEach(() => {
  vi.useRealTimers();
  vi.stubGlobal("crypto", webcrypto);
});

describe("OfficialTotpServiceAdapter", () => {
  it("implements the pinned official abstraction over deterministic generation", async () => {
    const service = new OfficialTotpServiceAdapter(() => 59);

    expect(service).toBeInstanceOf(TotpService);
    await expect(firstValueFrom(service.getCode$(RFC_SEED))).resolves.toEqual({
      code: "287082",
      period: 30,
    });
  });

  it("emits the current code again after a period rollover", async () => {
    vi.useFakeTimers();
    let now = 59;
    const service = new OfficialTotpServiceAdapter(() => now);
    let emissionCount = 0;
    let resolveFirstEmission!: () => void;
    const firstEmission = new Promise<void>((resolve) => {
      resolveFirstEmission = resolve;
    });
    const result = firstValueFrom(service.getCode$(RFC_SEED).pipe(
      tap(() => {
        emissionCount += 1;
        if (emissionCount === 1) {
          resolveFirstEmission();
        }
      }),
      take(2),
      toArray(),
    ));

    vi.advanceTimersByTime(0);
    await firstEmission;
    now = 60;
    vi.advanceTimersByTime(1_000);

    await expect(result).resolves.toEqual([
      { code: "287082", period: 30 },
      { code: "359152", period: 30 },
    ]);
  });

  it("fails closed for malformed seeds", async () => {
    const service = new OfficialTotpServiceAdapter(() => 59);

    await expect(
      firstValueFrom(service.getCode$("not-a-valid*seed").pipe(defaultIfEmpty(null))),
    ).resolves.toBeNull();
  });
});
