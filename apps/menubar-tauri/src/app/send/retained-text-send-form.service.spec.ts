import { describe, expect, it } from "vitest";

import { RetainedTextSendFormService } from "./retained-text-send-form.service";

const now = new Date("2026-07-19T12:00:00.000Z");

describe("RetainedTextSendFormService", () => {
  it.each([1, 24, 48, 72, 168, 336, 720] as const)(
    "maps the official %s-hour deletion preset to an exact future ISO timestamp",
    (hours) => {
      const form = new RetainedTextSendFormService({ hideEmailAllowed: true });
      form.initialize({ ...validValue(), deletionPresetHours: hours });

      expect(form.draft(now).deletionDate).toBe(new Date(now.getTime() + hours * 3_600_000).toISOString());
    },
  );

  it("owns all retained Text Send values and only emits a policy-allowed draft", () => {
    const form = new RetainedTextSendFormService({ hideEmailAllowed: false });
    form.initialize({
      ...validValue(),
      name: "  Text Send  ",
      notes: "  local note  ",
      authType: "password",
      password: "  protected  ",
      maxAccessCount: "4",
      hidden: true,
      hideEmail: true,
    });

    expect(form.draft(now)).toEqual({
      name: "Text Send",
      text: "message",
      notes: "local note",
      authType: "password",
      hidden: true,
      hideEmail: false,
      deletionDate: "2026-07-20T12:00:00.000Z",
      maxAccessCount: 4,
      password: "  protected  ",
    });
  });

  it("emits an explicit none authorization when an existing protected Send is changed", () => {
    const form = new RetainedTextSendFormService({ hideEmailAllowed: true });
    form.initialize({ ...validValue(), authType: "password" });

    form.patch({ authType: "none" });

    expect(form.draft(now)).toMatchObject({ authType: "none" });
    expect(form.draft(now)).not.toHaveProperty("password");
  });

  it("rechecks hide-email policy when the draft is emitted", () => {
    let hideEmailAllowed = true;
    const form = new RetainedTextSendFormService(() => hideEmailAllowed);
    form.initialize({ ...validValue(), hideEmail: true });

    expect(form.draft(now).hideEmail).toBe(true);

    hideEmailAllowed = false;
    expect(form.draft(now).hideEmail).toBe(false);
  });

  it("preserves an existing server deletion date until the preset is explicitly changed", () => {
    const form = new RetainedTextSendFormService({ hideEmailAllowed: true });
    form.initialize(validValue(), "2026-08-19T09:17:23.456Z");
    form.patch({ name: "Changed without touching deletion" });

    expect(form.draft(now).deletionDate).toBe("2026-08-19T09:17:23.456Z");

    form.patch({ deletionPresetHours: 48 });
    expect(form.draft(now).deletionDate).toBe("2026-07-21T12:00:00.000Z");
  });

  it("rejects missing name or text and non-integer access limits below one", () => {
    const form = new RetainedTextSendFormService({ hideEmailAllowed: true });
    form.initialize(validValue());
    for (const patch of [{ name: "  " }, { text: "  " }, { maxAccessCount: "0" }, { maxAccessCount: "1.2" }]) {
      form.patch(patch);
      expect(form.valid()).toBe(false);
      expect(() => form.draft(now)).toThrow("Invalid Text Send form");
      form.patch(validValue());
    }
  });

  it("requires a password only when password protection is newly enabled", () => {
    const form = new RetainedTextSendFormService({ hideEmailAllowed: true });
    form.initialize(validValue());
    form.patch({ authType: "password" });

    expect(form.valid()).toBe(false);
    expect(() => form.draft(now)).toThrow("Invalid Text Send form");

    form.patch({ password: "new-password" });
    expect(form.valid()).toBe(true);

    form.initialize({ ...validValue(), authType: "password" });
    expect(form.valid()).toBe(true);
    expect(form.draft(now)).toMatchObject({ authType: "password" });
    expect(form.draft(now)).not.toHaveProperty("password");
  });

  it("resets plaintext on destroy", () => {
    const form = new RetainedTextSendFormService({ hideEmailAllowed: true });
    form.initialize({ ...validValue(), password: "plain-secret", text: "plain-text" });
    form.destroy();

    expect(form.value()).toMatchObject({ password: "", text: "", name: "" });
    expect(form.dirty()).toBe(false);
  });
});

function validValue() {
  return {
    name: "Text Send",
    text: "message",
    hidden: false,
    deletionPresetHours: 24 as const,
    authType: "none" as const,
    password: "",
    maxAccessCount: "",
    hideEmail: false,
    notes: "",
  };
}
