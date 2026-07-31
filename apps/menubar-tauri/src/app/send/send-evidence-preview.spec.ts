import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PopupStateStore } from "../popup-state";
import { applySendEvidenceState, createSendEvidenceActionPort } from "./send-evidence-preview";
import {
  parseSendEvidenceState,
  resolveSendEvidenceState,
  sendEvidenceStates,
} from "./send-evidence-state";

describe("Send evidence state", () => {
  const expectedStates = [
    "list-populated",
    "list-loading",
    "list-empty",
    "list-no-results",
    "list-disabled",
    "view",
    "form-add",
    "form-edit",
    "created",
    "mutation-error",
    "row-actions",
  ] as const;

  it("accepts exactly the eleven M12 Send evidence states and a single query value", () => {
    expect(sendEvidenceStates).toEqual(expectedStates);
    for (const state of sendEvidenceStates) {
      expect(parseSendEvidenceState(state)).toBe(state);
    }
    expect(resolveSendEvidenceState(false, "?sendEvidence=list-populated")).toBeNull();
    expect(resolveSendEvidenceState(true, "?sendEvidence=list-loading")).toBe("list-loading");
    expect(() => resolveSendEvidenceState(true, "?sendEvidence=list-populated&token=value")).toThrow(
      "Invalid Send evidence query",
    );
    expect(() => parseSendEvidenceState("https://private.example.test")).toThrow(
      "Invalid Send evidence state",
    );
  });

  it("applies deterministic Text-only state without reading live credential fields", () => {
    for (const state of sendEvidenceStates) {
      const store = new PopupStateStore();
      applySendEvidenceState(store, state);
      const snapshot = store.snapshot();
      expect(snapshot.serverUrl).toBe("https://send-fixture.invalid");
      expect(snapshot.activeSession?.token).toEqual({
        accessToken: "",
        refreshToken: "",
        tokenType: "",
        expiresIn: 0,
      });
      expect(snapshot.activeSession?.crypto.userKeyB64).toBe("opaque-local-session-material");
      expect(JSON.stringify(snapshot)).not.toMatch(/process\.env|keychain|credential|https?:\/\/(?!send-fixture\.invalid)/i);
      if (state === "list-empty" || state === "list-loading" || state === "form-add") {
        expect(snapshot.sends).toEqual([]);
      } else {
        expect(snapshot.sends).toHaveLength(1);
        expect(snapshot.sends[0]).toMatchObject({ id: "m12-text-send", type: "text" });
      }
      expect(snapshot.isSyncing).toBe(state === "list-loading");
      expect(snapshot.isSendDisabled).toBe(state === "list-disabled");
    }
  });

  it("reconciles password add and remove through the deterministic action port", async () => {
    const store = new PopupStateStore();
    applySendEvidenceState(store, "form-add");
    const session = store.snapshot().activeSession;
    if (!session) throw new Error("missing deterministic evidence session");
    const actions = createSendEvidenceActionPort("form-add");
    const draft = {
      name: "Created local Send",
      text: "Local mutation body",
      notes: "",
      deletionDate: "2026-07-26T04:00:00.000Z",
    };

    const created = await actions.createTextSend(session, draft);
    expect(created.hasPassword).toBe(false);
    const protectedSend = await actions.updateTextSend(session, created, {
      ...draft,
      name: "Updated local Send",
      password: "reserved-local-password",
    });
    expect(protectedSend.hasPassword).toBe(true);
    await actions.removePassword(session, protectedSend);
    expect(await actions.refreshTextSend(session, protectedSend.id)).toMatchObject({
      id: protectedSend.id,
      hasPassword: false,
    });
  });

  it("keeps the production Send evidence shim empty and fixture-free", () => {
    const previewSource = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/app/send/send-evidence-preview.production.ts"),
      "utf8",
    );
    const providerSource = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/app/evidence/evidence-providers.production.ts"),
      "utf8",
    );
    const viteSource = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/vite.config.ts"),
      "utf8",
    );
    expect(providerSource).toContain("return []");
    expect(viteSource).toContain("evidence-providers.production.ts");
    expect(previewSource).not.toMatch(/m12-text-send|Synthetic Text Send evidence|send-mutation-error|send-row-actions/);
  });

  it("contains no credential-shaped fixture values or raw Error failure text", () => {
    const source = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/src/app/send/send-evidence-preview.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/m12-local-fixture-(?:token|refresh)|bTEyLWxvY2Fs|Synthetic Text Send evidence mutation failure/);
    expect(source).not.toMatch(/throw new Error\(/);
  });
});
