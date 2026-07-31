import { PolicyType } from "@bitwarden/common/admin-console/enums";

export interface TextSendPolicy {
  readonly disabled: boolean;
  readonly hideEmailAllowed: boolean;
}

export function textSendPolicyFromSync(response: unknown): TextSendPolicy {
  const policies = arrayProperty(response, "Policies").filter(enabledPolicy);
  return {
    disabled: policies.some(disablesSend),
    hideEmailAllowed: !policies.some(disablesHideEmail),
  };
}

function enabledPolicy(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && (value["Enabled"] === true || value["enabled"] === true);
}

function disablesSend(policy: Record<string, unknown>): boolean {
  const type = policyType(policy);
  return type === PolicyType.DisableSend ||
    (type === PolicyType.SendControls && policyData(policy)?.["disableSend"] === true);
}

function disablesHideEmail(policy: Record<string, unknown>): boolean {
  const type = policyType(policy);
  return (type === PolicyType.SendOptions || type === PolicyType.SendControls) &&
    policyData(policy)?.["disableHideEmail"] === true;
}

function policyType(policy: Record<string, unknown>): PolicyType | undefined {
  const value = policy["Type"] ?? policy["type"];
  return typeof value === "number" ? value as PolicyType : undefined;
}

function policyData(policy: Record<string, unknown>): Record<string, unknown> | undefined {
  const value = policy["Data"] ?? policy["data"];
  if (isRecord(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function arrayProperty(value: unknown, key: string): readonly unknown[] {
  return isRecord(value) && Array.isArray(value[key]) ? value[key] : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
