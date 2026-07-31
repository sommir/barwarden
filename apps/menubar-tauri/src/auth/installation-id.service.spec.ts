import { describe, expect, it, vi } from "vitest";

import { SecureStorageError, type SecureUuidHost } from "../host/host-api";
import { INSTALLATION_ID_KEY, InstallationIdService } from "./installation-id.service";

describe("InstallationIdService", () => {
  it("reuses the host's atomic installation GUID across service instances", async () => {
    const host = atomicUuidHost();

    const first = await new InstallationIdService(host).getInstallationId();
    const second = await new InstallationIdService(host).getInstallationId();

    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(second).toBe(first);
    expect(host.secureGetOrCreateUuid).toHaveBeenCalledTimes(2);
    expect(host.secureGetOrCreateUuid).toHaveBeenCalledWith(INSTALLATION_ID_KEY);
  });

  it("coalesces concurrent service instances in the atomic host boundary", async () => {
    const host = atomicUuidHost();

    const [first, second] = await Promise.all([
      new InstallationIdService(host).getInstallationId(),
      new InstallationIdService(host).getInstallationId(),
    ]);

    expect(second).toBe(first);
  });

  it("retries after the atomic secure-store operation fails", async () => {
    const host: SecureUuidHost = {
      secureGetOrCreateUuid: vi.fn()
        .mockRejectedValueOnce(new Error("secure storage write failed"))
        .mockResolvedValueOnce("11111111-1111-4111-8111-111111111111"),
    };
    const service = new InstallationIdService(host);

    await expect(service.getInstallationId()).rejects.toThrow("secure storage write failed");
    await expect(service.getInstallationId()).resolves.toBe(
      "11111111-1111-4111-8111-111111111111",
    );
  });

  it("preserves the fixed typed unavailable outcome without diagnostic detail", async () => {
    const host: SecureUuidHost = {
      secureGetOrCreateUuid: vi.fn().mockRejectedValue(new SecureStorageError("unavailable")),
    };

    await expect(new InstallationIdService(host).getInstallationId()).rejects.toMatchObject({
      name: "SecureStorageError",
      code: "unavailable",
      message: "unavailable",
    });
  });
});

function atomicUuidHost(): SecureUuidHost {
  let value: string | undefined;

  return {
    secureGetOrCreateUuid: vi.fn(async () => {
      await Promise.resolve();
      return value ??= "11111111-1111-4111-8111-111111111111";
    }),
  };
}
