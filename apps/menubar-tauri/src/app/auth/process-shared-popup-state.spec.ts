import { describe, expect, it } from "vitest";

import type { AuthSession } from "../../auth/auth-session-store";
import { PopupStateStore } from "../popup-state";
import { demoFolders, demoVaultItems } from "../vault-demo";
import {
  decodeProcessSharedPopupState,
  encodeProcessSharedPopupState,
  processSharedPopupStateRequiresLocalHydration,
} from "./process-shared-popup-state";

describe("process shared popup state", () => {
  it("round-trips committed UI state while requiring the caller to supply its local session", () => {
    const store = new PopupStateStore();
    const session = fakeSession();
    const syncedAt = new Date("2026-07-27T00:00:00.000Z");
    store.setLockedAccount("person@example.com", "https://vault.example.com");
    store.setActiveSession(session);
    store.setUnlocked("person@example.com");
    store.setItems(demoVaultItems, demoFolders, syncedAt);
    store.setStatus("Synced");
    store.setActiveTab("otp");
    store.setFilterType("card");
    store.toggleVaultSection("favorites");

    const shared = encodeProcessSharedPopupState(store.snapshot());
    const restored = decodeProcessSharedPopupState(shared, session);

    expect(restored).toMatchObject({
      isUnlocked: true,
      email: "person@example.com",
      serverUrl: "https://vault.example.com",
      folders: demoFolders,
      statusMessage: "Synced",
      activeSession: session,
      activeTab: "otp",
      filterType: "card",
      collapsedVaultSectionIds: ["favorites"],
    });
    expect(restored.items).toHaveLength(demoVaultItems.length);
    expect(restored.items[0]).toMatchObject({
      id: demoVaultItems[0]!.id,
      name: demoVaultItems[0]!.name,
      fields: [],
      uris: [],
      notes: "",
      requiresVaultSyncBeforeEdit: true,
    });
    expect(restored.lastSyncDate?.toISOString()).toBe(syncedAt.toISOString());
    expect(restored.lastSuccessfulSyncDate?.toISOString()).toBe(syncedAt.toISOString());
  });

  it.each(["vault", "otp", "generator", "send", "settings"] as const)(
    "accepts %s as a safe shared main-tab projection",
    (activeTab) => {
      const store = new PopupStateStore();
      const session = fakeSession();
      store.setActiveSession(session);
      store.setUnlocked("person@example.com");
      store.setActiveTab(activeTab);

      const restored = decodeProcessSharedPopupState(
        encodeProcessSharedPopupState(store.snapshot()),
        session,
      );

      expect(restored.activeTab).toBe(activeTab);
    },
  );

  it("projects parent and child hierarchy disclosure state in both window directions", () => {
    const session = fakeSession();
    const popup = new PopupStateStore();
    const popout = new PopupStateStore();
    for (const store of [popup, popout]) {
      store.setActiveSession(session);
      store.setUnlocked("person@example.com");
    }

    popup.setVaultHierarchyOpenState("types", "type:login");
    popout.restore(decodeProcessSharedPopupState(
      encodeProcessSharedPopupState(popup.snapshot()),
      session,
      popout.snapshot(),
    ));
    expect(popout.vaultHierarchyOpenNodeId()).toBe("types");
    expect(popout.vaultHierarchyOpenChildId()).toBe("type:login");

    popout.setVaultHierarchyOpenState("types", "type:card");
    popup.restore(decodeProcessSharedPopupState(
      encodeProcessSharedPopupState(popout.snapshot()),
      session,
      popup.snapshot(),
    ));
    expect(popup.vaultHierarchyOpenNodeId()).toBe("types");
    expect(popup.vaultHierarchyOpenChildId()).toBe("type:card");

    popout.setVaultHierarchyOpenState(null);
    popup.restore(decodeProcessSharedPopupState(
      encodeProcessSharedPopupState(popout.snapshot()),
      session,
      popup.snapshot(),
    ));
    expect(popup.vaultHierarchyOpenNodeId()).toBeNull();
    expect(popup.vaultHierarchyOpenChildId()).toBeNull();
  });

  it("applies peer UI metadata without erasing same-revision locally hydrated secrets", () => {
    const store = new PopupStateStore();
    const session = fakeSession();
    store.setActiveSession(session);
    store.setUnlocked("person@example.com");
    store.setItems(demoVaultItems, demoFolders);
    store.setSends([{
      id: "send-1",
      accessId: "local-access",
      urlB64Key: "local-key",
      type: "text",
      name: "Send",
      text: "local plaintext",
      notes: "local notes",
      revisionDate: "2026-07-27T00:00:00.000Z",
      deletionDate: "2026-08-27T00:00:00.000Z",
      disabled: false,
      accessCount: 0,
      password: "local password",
      hasPassword: true,
    }]);
    const local = store.snapshot();
    store.setActiveTab("settings");
    store.setFilterType("card");

    const restored = decodeProcessSharedPopupState(
      encodeProcessSharedPopupState(store.snapshot()),
      session,
      local,
    );

    expect(restored.activeTab).toBe("settings");
    expect(restored.filterType).toBe("card");
    expect(restored.items[0]?.fields).toEqual(local.items[0]?.fields);
    expect(restored.items[0]?.canFill).toBe(local.items[0]?.canFill);
    expect(restored.sends[0]).toMatchObject({
      accessId: "local-access",
      text: "local plaintext",
      password: "local password",
      urlB64Key: "local-key",
    });
    expect(processSharedPopupStateRequiresLocalHydration(restored)).toBe(false);
  });

  it("never serializes an active session, access token, refresh token, or master password", () => {
    const store = new PopupStateStore();
    store.setActiveSession(fakeSession());
    store.setUnlocked("person@example.com");

    const serialized = JSON.stringify(encodeProcessSharedPopupState(store.snapshot()));

    expect(serialized).not.toContain("activeSession");
    expect(serialized).not.toContain("accessToken");
    expect(serialized).not.toContain("refreshToken");
    expect(serialized).not.toContain("masterPassword");
    expect(serialized).not.toContain("access-secret");
    expect(serialized).not.toContain("refresh-secret");
  });

  it("normalizes optional undefined vault fields before sending state through Tauri JSON", () => {
    const store = new PopupStateStore();
    const session = fakeSession();
    store.setActiveSession(session);
    store.setUnlocked("person@example.com");
    store.setItems([
      {
        ...demoVaultItems[0],
        encryptedKey: undefined,
        archivedDate: undefined,
      },
    ]);

    const shared = encodeProcessSharedPopupState(store.snapshot());
    const restored = decodeProcessSharedPopupState(shared, session);

    expect(shared.items[0]).not.toHaveProperty("encryptedKey");
    expect(shared.items[0]).not.toHaveProperty("archivedDate");
    expect(restored.items).toHaveLength(1);
  });

  it("publishes only an explicit list-metadata allowlist for Vault and Send items", () => {
    const store = new PopupStateStore();
    store.setActiveSession(fakeSession());
    store.setUnlocked("person@example.com");
    store.setItems([
      {
        ...demoVaultItems[0],
        opaqueServerPayload: { value: "opaque-secret" },
        encryptedKey: "encrypted-item-key",
        subtitle: "username-secret",
        fields: [
          { id: "password", label: "Password", value: "password-secret", type: "hidden" },
          { id: "totp", label: "TOTP", value: "totp-secret", type: "totp" },
          { id: "custom", label: "Custom", value: "custom-field-secret" },
          { id: "ssh-private", label: "Private key", value: "ssh-private-key-secret" },
        ],
        card: {
          cardholderName: "cardholder-secret",
          brand: "Visa",
          number: "card-number-secret",
          expMonth: "01",
          expYear: "30",
          code: "cvv-secret",
        },
        identity: {
          title: "",
          firstName: "identity-secret",
          middleName: "",
          lastName: "",
          username: "",
          company: "",
          ssn: "ssn-secret",
          passportNumber: "",
          licenseNumber: "",
          email: "",
          phone: "",
          address1: "",
          address2: "",
          address3: "",
          city: "",
          state: "",
          postalCode: "",
          country: "",
        },
        notes: "notes-secret",
        passwordHistory: [{ password: "history-secret", lastUsedDate: "2026-01-01" }],
        uris: [{ id: "uri-1", uri: "https://secret.example", matchType: "default" }],
        uri: "https://secret.example",
        attachments: [{
          id: "attachment-1",
          fileName: "document.txt",
          size: "10",
          encryptedKey: "encrypted-attachment-key",
        }],
      },
    ]);
    store.setSends([{
      id: "send-1",
      accessId: "send-access-secret",
      urlB64Key: "send-key-secret",
      type: "text",
      name: "Visible Send",
      text: "send-text-secret",
      notes: "send-notes-secret",
      revisionDate: "2026-07-27T00:00:00.000Z",
      deletionDate: "2026-08-27T00:00:00.000Z",
      disabled: false,
      accessCount: 0,
      password: "send-password-secret",
      hasPassword: true,
    }]);

    const shared = encodeProcessSharedPopupState(store.snapshot());
    const serialized = JSON.stringify(shared);

    for (const secret of [
      "opaque-secret",
      "encrypted-item-key",
      "username-secret",
      "password-secret",
      "totp-secret",
      "custom-field-secret",
      "ssh-private-key-secret",
      "cardholder-secret",
      "card-number-secret",
      "cvv-secret",
      "identity-secret",
      "ssn-secret",
      "notes-secret",
      "history-secret",
      "https://secret.example",
      "send-access-secret",
      "send-key-secret",
      "send-text-secret",
      "send-notes-secret",
      "send-password-secret",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).not.toContain("encrypted-item-key");
    expect(serialized).not.toContain("encrypted-attachment-key");
    expect(Object.keys(shared.items[0]!).sort()).toEqual([
      "attachmentCount",
      "createdDate",
      "favorite",
      "folderId",
      "folderName",
      "id",
      "name",
      "organizationName",
      "revisionDate",
      "type",
    ]);
    expect(Object.keys(shared.sends[0]!).sort()).toEqual([
      "accessCount",
      "disabled",
      "hasPassword",
      "id",
      "name",
      "revisionDate",
      "deletionDate",
      "type",
    ].sort());
  });

  it("rejects an oversized metadata projection before it reaches the native broker", () => {
    const store = new PopupStateStore();
    store.setActiveSession(fakeSession());
    store.setUnlocked("person@example.com");
    store.setItems(Array.from({ length: 8_000 }, (_, index) => ({
      ...demoVaultItems[0]!,
      id: `item-${index}`,
      name: "n".repeat(400),
    })));

    expect(() => encodeProcessSharedPopupState(store.snapshot())).toThrow(
      "Invalid process snapshot",
    );
    expect(store.snapshot().isUnlocked).toBe(true);
  });

  it("drops any unexpected nested session credential keys at the process snapshot boundary", () => {
    const store = new PopupStateStore();
    store.setActiveSession(fakeSession());
    store.setUnlocked("person@example.com");
    const state = {
      ...store.snapshot(),
      organizations: [{
        id: "organization-1",
        name: "Example",
        enabled: true,
        status: 2,
        accessToken: "must-not-cross-boundary",
      }],
    };

    const shared = encodeProcessSharedPopupState(state);
    const serialized = JSON.stringify(shared);

    expect(serialized).not.toContain("accessToken");
    expect(serialized).not.toContain("must-not-cross-boundary");
  });

  it.each([
    { schemaVersion: 1, activeSession: { token: { accessToken: "secret" } } },
    { schemaVersion: 1, accessToken: "secret" },
    { schemaVersion: 1, nested: { refreshToken: "secret" } },
    { schemaVersion: 1, masterPassword: "secret" },
  ])("rejects secret-bearing or malformed broker state", (candidate) => {
    expect(() => decodeProcessSharedPopupState(candidate, fakeSession())).toThrow(
      "Invalid process snapshot",
    );
  });
});

function fakeSession(): AuthSession {
  return {
    environment: {
      apiUrl: "https://api.example.com",
      identityUrl: "https://identity.example.com",
    },
    token: {
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      tokenType: "Bearer",
      expiresIn: 3600,
    },
  };
}
