import { describe, expect, it } from "vitest";

import { demoVaultItems } from "../vault-demo";
import {
  toRecoveryPopupCipherView,
  toRetainedPopupCipherView,
} from "./popup-cipher-view.adapter";

describe("toRetainedPopupCipherView", () => {
  it("projects only the retained list fields", () => {
    const source = demoVaultItems[0];
    const view = toRetainedPopupCipherView(source);

    expect(view).not.toBeNull();
    expect(Object.keys(view!)).toEqual([
      "id",
      "type",
      "name",
      "subtitle",
      "favorite",
      "folderId",
      "folderName",
      "reprompt",
      "edit",
      "viewPassword",
      "organizationId",
      "collectionIds",
      "hasAttachments",
      "hasPasskeys",
      "hasSshKey",
      "canLaunch",
      "uri",
      "fields",
    ]);
    expect(view?.fields).toBe(source.fields);
    expect(view).toMatchObject({
      folderId: "work",
      folderName: "Work",
      reprompt: false,
      edit: true,
      viewPassword: true,
      organizationId: undefined,
      collectionIds: [],
      hasAttachments: false,
      hasPasskeys: false,
      hasSshKey: false,
    });
  });

  it("keeps organization items viewable while failing closed for unsupported mutations", () => {
    const source = {
      ...demoVaultItems[0],
      organizationId: "organization-1",
      collectionIds: ["collection-1"],
      attachmentCount: 2,
      reprompt: true,
    };

    expect(toRetainedPopupCipherView(source)).toMatchObject({
      reprompt: true,
      edit: false,
      viewPassword: false,
      organizationId: undefined,
      collectionIds: [],
      hasAttachments: false,
      hasPasskeys: false,
      hasSshKey: false,
    });
  });

  it("rejects SSH items from the retained list boundary", () => {
    const ssh = demoVaultItems.find((item) => item.type === "ssh-key")!;

    expect(toRetainedPopupCipherView(ssh)).toBeNull();
  });

  it("keeps recovery projections free of public source and reachable secret graphs", () => {
    const secretGraph = { token: "recovery-secret-sentinel" };
    const source = {
      ...demoVaultItems[0],
      uri: "https://recovery-secret-sentinel.example.test",
      fields: [{ id: "secret", label: "Secret", value: "recovery-secret-sentinel" }],
      opaquePayload: secretGraph,
    };

    const view = toRecoveryPopupCipherView(source);
    const reachable = reachableObjects(view);

    expect(view).not.toBeNull();
    expect(Reflect.ownKeys(view!)).not.toContain("source");
    expect(Reflect.ownKeys(view!)).not.toContain("fields");
    expect(Reflect.ownKeys(view!)).not.toContain("uri");
    expect(reachable).not.toContain(source);
    expect(reachable).not.toContain(secretGraph);
    expect(JSON.stringify(view)).not.toContain("recovery-secret-sentinel");
  });
});

function reachableObjects(root: unknown): unknown[] {
  const pending = [root];
  const seen = new Set<unknown>();

  while (pending.length > 0) {
    const value = pending.pop();
    if ((typeof value !== "object" && typeof value !== "function") || value === null || seen.has(value)) {
      continue;
    }
    seen.add(value);
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && "value" in descriptor) {
        pending.push(descriptor.value);
      }
    }
  }

  return [...seen];
}
