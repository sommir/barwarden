import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";
import { FolderView } from "@bitwarden/common/vault/models/view/folder.view";
import { LoginView } from "@bitwarden/common/vault/models/view/login.view";
import { LoginUriView } from "@bitwarden/common/vault/models/view/login-uri.view";
import { PasswordHistoryView } from "@bitwarden/common/vault/models/view/password-history.view";
import { CipherType, FieldType } from "@bitwarden/common/vault/enums";
import { CipherRepromptType } from "@bitwarden/common/vault/enums/cipher-reprompt-type";
import { UriMatchStrategy } from "@bitwarden/common/models/domain/domain-service";
import { describe, expect, it } from "vitest";

import type { VaultItem } from "./vault-item.model";
import { projectLoginDetail } from "./login-cipher-view.adapter";

describe("projectLoginDetail", () => {
  it("projects a Login into genuine official view classes", () => {
    const projection = projectLoginDetail(loginItem());

    expect(projection.cipher).toBeInstanceOf(CipherView);
    expect(projection.cipher.type).toBe(CipherType.Login);
    expect(projection.cipher.login).toBeInstanceOf(LoginView);
    expect(projection.cipher.login.uris).toHaveLength(3);
    expect(projection.cipher.login.uris.every((uri) => uri instanceof LoginUriView)).toBe(true);
    expect(projection.cipher.fields.every((field) => field instanceof FieldView)).toBe(true);
    expect(
      projection.cipher.passwordHistory.every((entry) => entry instanceof PasswordHistoryView),
    ).toBe(true);
    expect(projection.folder).toBeInstanceOf(FolderView);
  });

  it("maps supported Login values and excludes unsupported render data", () => {
    const projection = projectLoginDetail(loginItem());

    expect(projection.cipher).toMatchObject({
      id: "login-1",
      name: "Example Login",
      notes: "A private note",
      favorite: true,
      folderId: "folder-1",
      organizationId: undefined,
      collectionIds: [],
      attachments: [],
      reprompt: CipherRepromptType.Password,
    });
    expect(projection.cipher.creationDate.toISOString()).toBe("2026-07-01T01:02:03.000Z");
    expect(projection.cipher.key).toBeUndefined();
    expect(projection.cipher.revisionDate.toISOString()).toBe("2026-07-02T01:02:03.000Z");
    expect(projection.cipher.login).toMatchObject({
      username: "user@example.test",
      password: "secret-value",
      totp: "JBSWY3DPEHPK3PXP",
      fido2Credentials: [],
    });
    expect(projection.cipher.login.passwordRevisionDate?.toISOString()).toBe(
      "2026-07-02T00:00:00.000Z",
    );
    expect(projection.cipher.login.uris.map((uri) => uri.match)).toEqual([
      undefined,
      UriMatchStrategy.Host,
      undefined,
    ]);
    expect(projection.cipher.fields).toEqual([
      expect.objectContaining({ name: "Environment", value: "staging", type: FieldType.Text }),
      expect.objectContaining({ name: "PIN", value: "1234", type: FieldType.Hidden }),
      expect.objectContaining({ name: "Enabled", value: "true", type: FieldType.Boolean }),
      expect.objectContaining({ name: "Account name", type: FieldType.Linked, linkedId: 100 }),
    ]);
    expect(projection.folder).toMatchObject({ id: "folder-1", name: "Work" });
    expect(projection.cipher.passwordHistory).toEqual([
      expect.objectContaining({
        password: "old-secret",
        lastUsedDate: new Date("2026-06-01T00:00:00.000Z"),
      }),
    ]);
  });

  it("keeps action fields keyed by stable field ID without copying the map values", () => {
    const item = loginItem();
    const projection = projectLoginDetail(item);

    expect([...projection.actionFields.keys()]).toEqual([
      "username",
      "password",
      "otp",
      "custom:Environment",
      "custom:PIN",
      "custom:Enabled",
      "custom:Account name",
    ]);
    expect(projection.actionFields.get("password")).toBe(item.fields[1]);
  });

  it("rejects non-Login items", () => {
    expect(() => projectLoginDetail({ ...loginItem(), type: "card" })).toThrow(
      "Official Login detail projection requires a Login item",
    );
  });

  it("maps URI strategy boundaries and empty personal defaults", () => {
    const item = loginItem();
    const projection = projectLoginDetail({
      ...item,
      reprompt: false,
      folderId: "",
      folderName: "",
      uris: [
        { id: "uri-domain", uri: "https://domain.example.test", matchType: "0" },
        { id: "uri-never", uri: "https://never.example.test", matchType: "5" },
        { id: "uri-default", uri: "https://default.example.test", matchType: "   " },
      ],
    });

    expect(projection.cipher.reprompt).toBe(CipherRepromptType.None);
    expect(projection.cipher.folderId).toBeUndefined();
    expect(projection.folder).toBeUndefined();
    expect(projection.cipher.login.uris.map((uri) => uri.match)).toEqual([
      UriMatchStrategy.Domain,
      UriMatchStrategy.Never,
      undefined,
    ]);
  });
});

function loginItem(): VaultItem {
  return {
    id: "login-1",
    encryptedKey: "2.encrypted-key",
    organizationId: "org-1",
    collectionIds: ["collection-1"],
    type: "login",
    name: "Example Login",
    subtitle: "user@example.test",
    favorite: true,
    reprompt: true,
    folderId: "folder-1",
    folderName: "Work",
    organizationName: "Example Org",
    attachmentCount: 1,
    attachments: [{ id: "attachment-1", fileName: "private.txt", size: "10" }],
    uris: [
      { id: "uri-1", uri: "https://example.test", matchType: "default" },
      { id: "uri-2", uri: "https://sub.example.test", matchType: "1" },
      { id: "uri-3", uri: "https://invalid.example.test", matchType: "99" },
    ],
    fields: [
      { id: "username", label: "Username", value: "user@example.test" },
      { id: "password", label: "Password", value: "secret-value", type: "hidden", concealed: true },
      { id: "otp", label: "Authenticator key", value: "JBSWY3DPEHPK3PXP", type: "totp" },
      { id: "custom:Environment", label: "Environment", value: "staging", type: "text" },
      { id: "custom:PIN", label: "PIN", value: "1234", type: "hidden", concealed: true },
      { id: "custom:Enabled", label: "Enabled", value: "true", type: "boolean" },
      { id: "custom:Account name", label: "Account name", value: "", type: "linked", linkedId: 100 },
    ],
    createdDate: "2026-07-01T01:02:03.000Z",
    revisionDate: "2026-07-02T01:02:03.000Z",
    passwordRevisionDate: "2026-07-02T00:00:00.000Z",
    passwordHistory: [{ password: "old-secret", lastUsedDate: "2026-06-01T00:00:00.000Z" }],
    notes: "A private note",
    canLaunch: true,
    canFill: true,
    uri: "https://example.test",
  };
}
