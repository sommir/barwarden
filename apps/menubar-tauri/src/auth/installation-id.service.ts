import type { SecureUuidHost } from "../host/host-api";

export const INSTALLATION_ID_KEY = "installation.deviceIdentifier";

export interface InstallationIdPort {
  getInstallationId(): Promise<string>;
}

export class InstallationIdService implements InstallationIdPort {
  private pendingId: Promise<string> | undefined;

  constructor(private readonly host: SecureUuidHost) {}

  getInstallationId(): Promise<string> {
    if (!this.pendingId) {
      const pendingId = this.host.secureGetOrCreateUuid(INSTALLATION_ID_KEY);
      this.pendingId = pendingId;
      void pendingId.catch(() => {
        if (this.pendingId === pendingId) {
          this.pendingId = undefined;
        }
      });
    }

    return this.pendingId;
  }

}
