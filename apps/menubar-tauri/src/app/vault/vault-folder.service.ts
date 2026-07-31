import { Inject, Injectable, InjectionToken, Optional } from "@angular/core";

import type { AuthSession } from "../../auth/auth-session-store";
import { base64ToBytes } from "../../auth/bitwarden-crypto";
import { BitwardenApiClient, type FolderRequest } from "../../bitwarden-api/bitwarden-api";
import { TauriHostService } from "../../host/tauri-host.service";
import { BitwardenSdkCore } from "../../sdk/bitwarden-sdk-core.service";
import { PopupStateStore } from "../popup-state";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";
import type { VaultFolder } from "./vault-item.model";

export interface VaultFolderApi {
  postFolder(request: FolderRequest, accessToken: string): Promise<unknown>;
  putFolder(folderId: string, request: FolderRequest, accessToken: string): Promise<unknown>;
  deleteFolder(folderId: string, accessToken: string): Promise<unknown>;
}

export interface VaultFolderCrypto {
  encryptString(value: string, key: Uint8Array): Promise<string>;
}

export interface FolderMutationOwnershipGuard {
  readonly isCurrent: () => boolean;
}

export type FolderMutationNotCommittedReason = "duplicate" | "failure" | "stale";

export type FolderMutationOutcome =
  | { readonly committed: true; readonly folder?: VaultFolder; readonly status: string }
  | { readonly committed: false; readonly reason: FolderMutationNotCommittedReason; readonly status: string };

export const VAULT_FOLDER_API = new InjectionToken<VaultFolderApi | null>("VAULT_FOLDER_API", {
  providedIn: "root",
  factory: () => null,
});

export const VAULT_FOLDER_CRYPTO = new InjectionToken<VaultFolderCrypto | null>("VAULT_FOLDER_CRYPTO", {
  providedIn: "root",
  factory: () => null,
});

@Injectable({ providedIn: "root" })
export class VaultFolderService {
  constructor(
    private readonly store: PopupStateStore,
    @Optional() @Inject(VAULT_FOLDER_API) private readonly api: VaultFolderApi | null = null,
    @Optional() @Inject(VAULT_FOLDER_CRYPTO) private readonly crypto: VaultFolderCrypto | null = null,
  ) {}

  async create(
    session: AuthSession | null,
    name: string,
    ownership: FolderMutationOwnershipGuard,
  ): Promise<FolderMutationOutcome> {
    const folderName = requiredFolderName(name);
    if (!session || !folderName) {
      return saveFailure();
    }
    if (!this.current(session, ownership)) {
      return staleFolderMutation();
    }

    try {
      const request = await this.encryptedRequest(session, folderName);
      if (!this.current(session, ownership)) {
        return staleFolderMutation();
      }
      const response = await this.client(session).postFolder(request, session.token.accessToken);
      if (!this.current(session, ownership)) {
        return staleFolderMutation();
      }
      const id = responseId(response);
      return id ? { committed: true, folder: { id, name: folderName }, status: "" } : saveFailure();
    } catch {
      return this.current(session, ownership) ? saveFailure() : staleFolderMutation();
    }
  }

  async update(
    session: AuthSession | null,
    folderId: string,
    name: string,
    ownership: FolderMutationOwnershipGuard,
  ): Promise<FolderMutationOutcome> {
    const folderName = requiredFolderName(name);
    if (!session || !folderId.trim() || !folderName) {
      return saveFailure();
    }
    if (!this.current(session, ownership)) {
      return staleFolderMutation();
    }

    try {
      const request = await this.encryptedRequest(session, folderName);
      if (!this.current(session, ownership)) {
        return staleFolderMutation();
      }
      await this.client(session).putFolder(folderId, request, session.token.accessToken);
      return this.current(session, ownership)
        ? { committed: true, folder: { id: folderId, name: folderName }, status: "" }
        : staleFolderMutation();
    } catch {
      return this.current(session, ownership) ? saveFailure() : staleFolderMutation();
    }
  }

  async delete(
    session: AuthSession | null,
    folderId: string,
    ownership: FolderMutationOwnershipGuard,
  ): Promise<FolderMutationOutcome> {
    if (!session || !folderId.trim()) {
      return deleteFailure();
    }
    if (!this.current(session, ownership)) {
      return staleFolderMutation();
    }

    try {
      if (!this.current(session, ownership)) {
        return staleFolderMutation();
      }
      await this.client(session).deleteFolder(folderId, session.token.accessToken);
      return this.current(session, ownership) ? { committed: true, status: "" } : staleFolderMutation();
    } catch {
      return this.current(session, ownership) ? deleteFailure() : staleFolderMutation();
    }
  }

  private current(session: AuthSession, ownership: FolderMutationOwnershipGuard): boolean {
    return this.store.snapshot().activeSession === session && ownership.isCurrent();
  }

  private async encryptedRequest(session: AuthSession, name: string): Promise<FolderRequest> {
    if (!session.crypto?.userKeyB64) {
      throw new Error("Missing Bitwarden user key for folder encryption");
    }

    return { name: await this.cryptoClient().encryptString(name, base64ToBytes(session.crypto.userKeyB64)) };
  }

  private client(session: AuthSession): VaultFolderApi {
    return this.api ?? new BitwardenApiClient(session.environment, new TauriHostService());
  }

  private cryptoClient(): VaultFolderCrypto {
    return this.crypto ?? new BitwardenSdkCore();
  }
}

function requiredFolderName(name: string): string {
  return name.trim();
}

function responseId(response: unknown): string {
  if (typeof response !== "object" || response === null) {
    return "";
  }
  const id = (response as Record<string, unknown>)["Id"] ?? (response as Record<string, unknown>)["id"];
  return typeof id === "string" ? id : "";
}

function saveFailure(): FolderMutationOutcome {
  return {
    committed: false,
    reason: "failure",
    status: translateOfficialMessage("i18nSaveFolderFailed"),
  };
}

function deleteFailure(): FolderMutationOutcome {
  return {
    committed: false,
    reason: "failure",
    status: translateOfficialMessage("i18nDeleteFolderFailed"),
  };
}

export function staleFolderMutation(): FolderMutationOutcome {
  return { committed: false, reason: "stale", status: "" };
}
