import { describe, expect, it, vi } from "vitest";

import { Cipher } from "@bitwarden/common/vault/models/domain/cipher";
import { CipherType, FieldType } from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FolderView } from "@bitwarden/common/vault/models/view/folder.view";
import { OfficialI18nService } from "../official-ui/official-i18n.service";

import {
  RetainedCipherFormGenerationService,
  RetainedCipherFormService,
  buildOfficialLoginFormConfig,
  retainedLoginSubmitToDraft,
  type RetainedLoginFormGenerator,
  type RetainedLoginFormConfig,
  type RetainedLoginFormStatusStore,
} from "./retained-login-form.adapter";

describe("retained Login form adapter", () => {
  it("builds the official config around a branded Cipher carrier and fresh Login-only views", async () => {
    const initial = loginView();
    const config = buildOfficialLoginFormConfig({
      mode: "edit",
      initial,
      folders: [FolderView.fromJSON({ id: "folder-1", name: "Work" })],
      canViewSecrets: false,
    });
    const service = new RetainedCipherFormService();

    expect(config.cipherType).toBe(CipherType.Login);
    expect(config.organizationDataOwnershipDisabled).toBe(true);
    expect(config.collections).toEqual([]);
    expect(config.organizations).toEqual([]);
    expect(config.canViewSecrets).toBe(false);
    expect(config.originalCipher).toBeInstanceOf(Cipher);

    const first = await service.decryptCipher(config.originalCipher!);
    const second = await service.decryptCipher(config.originalCipher!);
    expect(first).not.toBe(initial);
    expect(second).not.toBe(first);
    expect(first.login).not.toBe(second.login);
    expect(first.login.uris).not.toBe(second.login.uris);
    expect(first.fields.map((field) => field.type)).toEqual([
      FieldType.Text,
      FieldType.Hidden,
      FieldType.Boolean,
    ]);
    expect(first.fields.map((field) => field.name)).not.toContain(
      "Linked field",
    );
    expect(first.fields.map((field) => field.name)).not.toContain(
      "Unknown field",
    );

    first.name = "Mutated copy";
    expect((await service.decryptCipher(config.originalCipher!)).name).toBe(
      "Example Login",
    );
  });

  it("keeps add inputs official and leaves a zero-URI edit at zero", async () => {
    const add = buildOfficialLoginFormConfig({
      mode: "add",
      initial: CipherView.fromJSON({
        type: CipherType.Login,
        name: "",
        folderId: "folder-1",
        login: { username: "prefill", uris: [] },
      })!,
      folders: [FolderView.fromJSON({ id: "folder-1", name: "Work" })],
      canViewSecrets: true,
    });
    const edit = buildOfficialLoginFormConfig({
      mode: "edit",
      initial: CipherView.fromJSON({
        id: "zero-uri",
        type: CipherType.Login,
        name: "No URI",
        login: { username: "user", uris: [] },
      })!,
      folders: [],
      canViewSecrets: true,
    });

    expect(add.mode).toBe("add");
    expect(add.originalCipher).toBeUndefined();
    expect(add.initialValues).toEqual(
      expect.objectContaining({
        folderId: "folder-1",
        username: "prefill",
      }),
    );
    expect(add.initialValues).not.toHaveProperty("loginUri");
    expect(
      (
        await new RetainedCipherFormService().decryptCipher(
          edit.originalCipher!,
        )
      ).login.uris,
    ).toEqual([]);
  });

  it("returns fresh saved copies without invoking a write port", async () => {
    const service = new RetainedCipherFormService();
    const source = loginView();
    const config = buildOfficialLoginFormConfig({
      mode: "edit",
      initial: source,
      folders: [],
      canViewSecrets: true,
    });

    const saved = await service.saveCipher(source, config);
    expect(saved).not.toBe(source);
    expect(saved.login).not.toBe(source.login);
    expect(saved.name).toBe(source.name);
  });

  it("adapts the existing generator service for password and username results", async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({ credential: "generated-password" })
      .mockResolvedValueOnce({ credential: "generated-username" });

    const adapter = new RetainedCipherFormGenerationService({
      generate,
    } as RetainedLoginFormGenerator);

    await expect(adapter.generatePassword()).resolves.toBe(
      "generated-password",
    );
    await expect(
      adapter.generateUsername("https://example.test"),
    ).resolves.toBe("generated-username");
    expect(generate.mock.calls).toEqual([
      ["password", expect.any(Function)],
      ["username", expect.any(Function)],
    ]);
  });

  it.each(["route", "account"] as const)(
    "returns null when %s ownership changes during generation",
    async () => {
      const pending = deferred<{ credential: string }>();
      let current = true;
      const adapter = new (RetainedCipherFormGenerationService as unknown as new (
        generator: RetainedLoginFormGenerator,
        owner: { capture(): object; isCurrent(token: object): boolean },
      ) => RetainedCipherFormGenerationService)(
        { generate: vi.fn(() => pending.promise) },
        { capture: () => ({}), isCurrent: () => current },
      );

      const generated = adapter.generateUsername("https://example.test");
      current = false;
      pending.resolve({ credential: "stale-generated-username" });

      await expect(generated).resolves.toBeNull();
    },
  );

  it("returns only the latest generation operation to the current form owner", async () => {
    const first = deferred<{ credential: string }>();
    const second = deferred<{ credential: string }>();
    const generator = {
      generate: vi.fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise),
    };
    const adapter = new (RetainedCipherFormGenerationService as unknown as new (
      generator: RetainedLoginFormGenerator,
      owner: { capture(): object; isCurrent(token: object): boolean },
    ) => RetainedCipherFormGenerationService)(
      generator,
      { capture: () => ({}), isCurrent: () => true },
    );

    const stale = adapter.generatePassword();
    const latest = adapter.generateUsername("");
    first.resolve({ credential: "stale-password" });
    second.resolve({ credential: "latest-username" });

    await expect(stale).resolves.toBeNull();
    await expect(latest).resolves.toBe("latest-username");
  });

  it("contains a current generator failure behind one fixed sanitized status", async () => {
    await new OfficialI18nService().setLocale("zh-CN");
    const status = { setStatus: vi.fn() };
    const Adapter = RetainedCipherFormGenerationService as unknown as new (
      generator: RetainedLoginFormGenerator,
      owner: null,
      destroyRef: null,
      status: RetainedLoginFormStatusStore,
    ) => RetainedCipherFormGenerationService;
    const adapter = new Adapter({
      generate: vi.fn().mockRejectedValue(new Error("private generator failure detail")),
    }, null, null, status);

    await expect(adapter.generatePassword()).resolves.toBeNull();

    expect(status.setStatus).toHaveBeenCalledOnce();
    expect(status.setStatus).toHaveBeenCalledWith("无法生成凭据。");
    expect(status.setStatus).not.toHaveBeenCalledWith(expect.stringContaining("private"));
    await new OfficialI18nService().setLocale("zh-CN");
  });

  it("silently discards a stale generator failure", async () => {
    const pending = deferred<{ credential: string }>();
    let current = true;
    const status = { setStatus: vi.fn() };
    const Adapter = RetainedCipherFormGenerationService as unknown as new (
      generator: RetainedLoginFormGenerator,
      owner: { capture(): object; isCurrent(token: object): boolean },
      destroyRef: null,
      status: RetainedLoginFormStatusStore,
    ) => RetainedCipherFormGenerationService;
    const adapter = new Adapter({ generate: vi.fn(() => pending.promise) }, {
      capture: () => ({}),
      isCurrent: () => current,
    }, null, status);

    const generated = adapter.generateUsername("https://example.test");
    current = false;
    pending.reject(new Error("stale private failure detail"));

    await expect(generated).resolves.toBeNull();
    expect(status.setStatus).not.toHaveBeenCalled();
  });

  it("normalizes the official CipherView result at the adapter boundary", () => {
    const result = retainedLoginSubmitToDraft({
      mode: "clone",
      value: loginView(),
    });

    expect(result).toEqual(
      expect.objectContaining({
        name: "Example Login",
        username: "user@example.test",
        password: "secret-value",
        totp: "JBSWY3DPEHPK3PXP",
        favorite: true,
        folderId: "folder-1",
        reprompt: true,
      }),
    );
    expect(result.uris).toEqual([
      { uri: "https://example.test/login", matchType: "default" },
      { uri: "https://admin.example.test", matchType: "1" },
    ]);
    expect(result.fields.map((field) => field.type)).toEqual([0, 1, 2]);
  });
});

function loginView(): CipherView {
  return CipherView.fromJSON({
    id: "login-1",
    type: CipherType.Login,
    name: "Example Login",
    folderId: "folder-1",
    favorite: true,
    reprompt: 1,
    attachments: [{ id: "attachment-1", fileName: "opaque.txt" }],
    fields: [
      { name: "Environment", value: "staging", type: FieldType.Text },
      { name: "PIN", value: "1234", type: FieldType.Hidden },
      { name: "Enabled", value: "true", type: FieldType.Boolean },
      {
        name: "Linked field",
        value: "",
        type: FieldType.Linked,
        linkedId: 100,
      },
      { name: "Unknown field", value: "opaque", type: 99 },
    ],
    login: {
      username: "user@example.test",
      password: "secret-value",
      totp: "JBSWY3DPEHPK3PXP",
      uris: [
        { uri: "https://example.test/login" },
        { uri: "https://admin.example.test", match: 1 },
      ],
      fido2Credentials: [{ credentialId: "opaque-passkey" }],
    },
  })!;
}

const _configContract: RetainedLoginFormConfig | undefined = undefined;
void _configContract;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
