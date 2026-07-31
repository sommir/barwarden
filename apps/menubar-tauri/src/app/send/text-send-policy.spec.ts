import { PolicyType } from "@bitwarden/common/admin-console/enums";
import { describe, expect, it } from "vitest";

import { textSendPolicyFromSync } from "./text-send-policy";

describe("textSendPolicyFromSync", () => {
  it.each([
    ["legacy DisableSend", { Type: PolicyType.DisableSend, Enabled: true }, { disabled: true, hideEmailAllowed: true }],
    ["legacy SendOptions", { Type: PolicyType.SendOptions, Enabled: true, Data: { disableHideEmail: true } }, { disabled: false, hideEmailAllowed: false }],
    ["current SendControls disableSend", { Type: PolicyType.SendControls, Enabled: true, Data: { disableSend: true } }, { disabled: true, hideEmailAllowed: true }],
    ["current SendControls disableHideEmail", { Type: PolicyType.SendControls, Enabled: true, Data: { disableHideEmail: true } }, { disabled: false, hideEmailAllowed: false }],
    ["disabled policy", { Type: PolicyType.DisableSend, Enabled: false }, { disabled: false, hideEmailAllowed: true }],
    ["malformed policy", { Type: PolicyType.SendControls, Enabled: true, Data: "invalid" }, { disabled: false, hideEmailAllowed: true }],
  ])("projects %s", (_name, policy, expected) => {
    expect(textSendPolicyFromSync({ Policies: [policy] })).toEqual(expected);
  });

  it("defaults safely when sync has no policy records", () => {
    expect(textSendPolicyFromSync({})).toEqual({ disabled: false, hideEmailAllowed: true });
  });
});
