import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const excludedProductFiles = [
  "apps/menubar-tauri/src/app/send/file-send-request.service.ts",
  "apps/menubar-tauri/src/app/send/file-send-upload.service.ts",
  "apps/menubar-tauri/src/host/native-encrypted-upload.service.ts",
  "apps/menubar-tauri/src/host/native-file-download.service.ts",
  "apps/menubar-tauri/src/host/native-file-source.service.ts",
  "apps/menubar-tauri/src/app/settings/device-management-page.component.ts",
  "apps/menubar-tauri/src/app/settings/domain-list-page.component.ts",
  "apps/menubar-tauri/src/app/settings/notifications-page.component.ts",
  "apps/menubar-tauri/src/app/vault/assign-collections-page.component.ts",
  "apps/menubar-tauri/src/app/vault/at-risk-passwords-page.component.ts",
  "apps/menubar-tauri/src/app/vault/cipher-attachment-actions.service.ts",
  "apps/menubar-tauri/src/app/vault/cipher-attachment-download.service.ts",
  "apps/menubar-tauri/src/app/vault/cipher-attachment-upload.service.ts",
  "apps/menubar-tauri/src/app/vault/cipher-collections.service.ts",
  "apps/menubar-tauri/src/app/vault/vault-at-risk.service.ts",
  "apps/menubar-tauri/src/app/vault/vault-deferred-action-page.component.ts",
  "apps/menubar-tauri/src/app/vault/vault-export-page.component.ts",
  "apps/menubar-tauri/src/app/vault/vault-export.service.ts",
  "apps/menubar-tauri/src/app/vault/vault-import-page.component.ts",
  "apps/menubar-tauri/src/app/vault/vault-import.service.ts",
  "apps/menubar-tauri/src-tauri/src/file_save.rs",
  "apps/menubar-tauri/src-tauri/src/file_source.rs",
] as const;

const excludedSettingsFiles = [
  "apps/menubar-tauri/src/app/settings/admin-settings-page.component.ts",
  "apps/menubar-tauri/src/app/settings/extension-device-management-page.component.ts",
  "apps/menubar-tauri/src/app/settings/device-management-page.component.ts",
  "apps/menubar-tauri/src/app/settings/blocked-domains-page.component.ts",
  "apps/menubar-tauri/src/app/settings/excluded-domains-page.component.ts",
  "apps/menubar-tauri/src/app/settings/domain-list-page.component.ts",
  "apps/menubar-tauri/src/app/settings/premium-v2-page.component.ts",
  "apps/menubar-tauri/src/app/settings/billing-page.component.ts",
  "apps/menubar-tauri/src/app/settings/reports-page.component.ts",
  "apps/menubar-tauri/src/app/settings/import-browser-page.component.ts",
  "apps/menubar-tauri/src/app/settings/export-browser-page.component.ts",
  "apps/menubar-tauri/src/app/settings/await-desktop-dialog.component.ts",
  "apps/menubar-tauri/src/app/settings/native-messaging.service.ts",
  "apps/menubar-tauri/src/app/settings/browser-autofill-settings-page.component.ts",
] as const;

const excludedApiSymbols = [
  "CipherAttachmentCreateRequest",
  "FileSendCreateRequest",
  "FileSendUploadData",
  "SshKeyCipherCreateRequest",
  "deactivateDevice",
  "deleteCipherAttachment",
  "getDevices",
  "getCipherAttachmentData",
  "postCipherAttachment",
  "postFileSend",
  "putCipherCollections",
  "renewCipherAttachmentUploadUrl",
  "renewSendFileUploadUrl",
] as const;

const excludedProductionTokens = [
  "buildSshKeyCipherCreateRequest",
  "buildSshKeyCipherUpdateRequest",
  "createSshKeyCipher",
  "updateSshKeyCipher",
  "SshKeyCipherDraft",
] as const;

describe("Plan A product-scope guard", () => {
  it("keeps explicitly excluded product implementations out of the source tree", () => {
    for (const file of excludedProductFiles) {
      expect(existsSync(join(process.cwd(), file)), file).toBe(false);
    }
  });

  it("keeps excluded Settings implementation modules out of the source tree", () => {
    for (const file of excludedSettingsFiles) {
      expect(existsSync(join(process.cwd(), file)), file).toBe(false);
    }
  });

  it("keeps excluded attachment, collection, and File Send operations out of the API client", () => {
    const apiSource = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/bitwarden-api/bitwarden-api.ts"),
      "utf8",
    );

    for (const symbol of excludedApiSymbols) {
      expect(apiSource, symbol).not.toContain(symbol);
    }
  });

  it("keeps excluded SSH Key mutation and decryption code out of production", () => {
    for (const file of productionTypeScriptFiles(
      join(process.cwd(), "apps/menubar-tauri/src"),
    )) {
      const source = readFileSync(file, "utf8");
      for (const token of excludedProductionTokens) {
        expect(source, `${file}: ${token}`).not.toContain(token);
      }
    }

    const syncSource = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/vault/vault-sync.service.ts"),
      "utf8",
    );
    expect(syncSource).not.toMatch(/SshKey|ssh-key/);
  });

  it("keeps excluded native file transfer commands out of the Tauri host", () => {
    const nativeSources = [
      "apps/menubar-tauri/src/host/tauri-host.service.ts",
      "apps/menubar-tauri/src-tauri/src/main.rs",
      "apps/menubar-tauri/src-tauri/src/http.rs",
    ].map((file) => readFileSync(join(process.cwd(), file), "utf8")).join("\n");

    expect(nativeSources).not.toMatch(
      /pick_file_source|read_file_source_chunk|release_file_source|save_decrypted_file|http_upload_encrypted|http_fetch_encrypted_bytes/,
    );
  });

  it("ignores File Send records without decrypting or packaging their metadata", () => {
    const sendModel = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/app/send/send-item.model.ts"),
      "utf8",
    );
    const sendPage = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/app/send/send-page.component.ts"),
      "utf8",
    );
    const syncSource = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/vault/vault-sync.service.ts"),
      "utf8",
    );

    expect(sendModel).not.toContain("文件 Send");
    expect(sendModel).not.toContain("fileName");
    expect(sendPage).not.toContain("fileName");
    expect(syncSource).not.toMatch(/\[1,\s*["']file["']\]/);
    expect(syncSource).not.toContain('recordProperty(send, "File")');
  });
});

function productionTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return productionTypeScriptFiles(path);
    }
    return entry.isFile() && path.endsWith(".ts") && !path.endsWith(".spec.ts")
      ? [path]
      : [];
  });
}
