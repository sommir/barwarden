import { readFileSync } from "node:fs";

const EXPECTED_TEAM_ID = "K7LY92JY96";
const EXPECTED_APP_GROUP = "K7LY92JY96.com.sommir.barwarden.autofill";
const EXPECTED_MINIMUM_MACOS = "13.0";
const EXPECTED_PRODUCT_VERSION = "0.1.2";
const EXPECTED_COMPONENTS = new Map([
  ["app", { path: ".", bundleId: "com.sommir.barwarden" }],
  [
    "credential-provider",
    {
      path: "Contents/PlugIns/BarwardenCredentialProvider.appex",
      bundleId: "com.sommir.barwarden.credential-provider",
    },
  ],
  [
    "agent",
    {
      path: "Contents/Helpers/BarwardenAutoFillAgent",
      bundleId: "com.sommir.barwarden.autofill-agent",
    },
  ],
]);

export class NativeAutoFillReleasePolicyError extends Error {
  constructor(code) {
    super(code);
    this.name = "NativeAutoFillReleasePolicyError";
    this.code = code;
  }
}

function reject(code) {
  throw new NativeAutoFillReleasePolicyError(code);
}

function exactStringArray(value, expected) {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((entry, index) => entry === expected[index])
  );
}

const EXPECTED_ENTITLEMENT_KEYS = new Map([
  ["app", ["com.apple.security.application-groups"]],
  [
    "credential-provider",
    [
      "com.apple.application-identifier",
      "com.apple.developer.authentication-services.autofill-credential-provider",
      "com.apple.developer.team-identifier",
      "com.apple.security.app-sandbox",
      "com.apple.security.application-groups",
    ],
  ],
  ["agent", ["com.apple.security.application-groups"]],
]);
const REQUIRED_PROFILE_ENTITLEMENT_KEYS = [
  "com.apple.application-identifier",
  "com.apple.developer.authentication-services.autofill-credential-provider",
  "com.apple.developer.team-identifier",
  "com.apple.security.app-sandbox",
];
const ALLOWED_PROFILE_ENTITLEMENT_KEYS = new Set([
  ...REQUIRED_PROFILE_ENTITLEMENT_KEYS,
  "com.apple.security.application-groups",
  "get-task-allow",
  "keychain-access-groups",
]);

function validProfileEntitlementInventory(value) {
  return Array.isArray(value) && new Set(value).size === value.length
    && REQUIRED_PROFILE_ENTITLEMENT_KEYS.every((key) => value.includes(key))
    && value.every((key) => ALLOWED_PROFILE_ENTITLEMENT_KEYS.has(key));
}

export function verifyNativeAutoFillInspection(inspection) {
  if (!inspection || inspection.schemaVersion !== 1 || !Array.isArray(inspection.inventory)) {
    reject("NATIVE_AUTOFILL_INSPECTION_INVALID");
  }
  if (
    inspection.teamId !== EXPECTED_TEAM_ID ||
    inspection.appGroup !== EXPECTED_APP_GROUP ||
    inspection.minimumMacOS !== EXPECTED_MINIMUM_MACOS
  ) {
    reject("NATIVE_AUTOFILL_CONTRACT_MISMATCH");
  }
  if (inspection.productVersion !== EXPECTED_PRODUCT_VERSION) {
    reject("NATIVE_AUTOFILL_VERSION_MISMATCH");
  }

  const byRole = new Map();
  for (const component of inspection.inventory) {
    if (!EXPECTED_COMPONENTS.has(component?.role)) {
      reject("NATIVE_AUTOFILL_INVENTORY_UNEXPECTED");
    }
    if (byRole.has(component.role)) {
      reject("NATIVE_AUTOFILL_INVENTORY_DUPLICATE");
    }
    byRole.set(component.role, component);
  }
  if ([...EXPECTED_COMPONENTS.keys()].some((role) => !byRole.has(role))) {
    reject("NATIVE_AUTOFILL_INVENTORY_MISSING");
  }
  if (!Array.isArray(inspection.unexpectedNestedCode) || inspection.unexpectedNestedCode.length !== 0) {
    reject("NATIVE_AUTOFILL_INVENTORY_UNEXPECTED");
  }
  if (!Array.isArray(inspection.unexpectedSymlinks) || inspection.unexpectedSymlinks.length !== 0) {
    reject("NATIVE_AUTOFILL_SYMLINK_FORBIDDEN");
  }
  if (
    !Array.isArray(inspection.unexpectedMachO) || inspection.unexpectedMachO.length !== 0 ||
    !Array.isArray(inspection.unexpectedDylibs) || inspection.unexpectedDylibs.length !== 0
  ) {
    reject("NATIVE_AUTOFILL_INVENTORY_UNEXPECTED");
  }

  for (const [role, expected] of EXPECTED_COMPONENTS) {
    const component = byRole.get(role);
    if (component.relativePath !== expected.path) {
      reject("NATIVE_AUTOFILL_INVENTORY_UNEXPECTED");
    }
    if (component.teamId !== EXPECTED_TEAM_ID) {
      reject("NATIVE_AUTOFILL_TEAM_MISMATCH");
    }
    if (component.bundleId !== expected.bundleId) {
      reject("NATIVE_AUTOFILL_BUNDLE_ID_MISMATCH");
    }
    if (!exactStringArray(component.appGroups, [EXPECTED_APP_GROUP])) {
      if (Array.isArray(component.appGroups) && component.appGroups.length === 0) {
        reject("NATIVE_AUTOFILL_APP_GROUP_MISSING");
      }
      reject("NATIVE_AUTOFILL_APP_GROUP_UNEXPECTED");
    }
    if (!Array.isArray(component.keychainGroups) || component.keychainGroups.length !== 0) {
      reject("NATIVE_AUTOFILL_KEYCHAIN_GROUP_FORBIDDEN");
    }
    if (!exactStringArray(component.entitlementKeys, EXPECTED_ENTITLEMENT_KEYS.get(role))) {
      reject("NATIVE_AUTOFILL_ENTITLEMENT_INVENTORY_INVALID");
    }
    if (role !== "app" && (component.signatureKind !== "developer-id" || component.signatureValid !== true)) {
      reject("NATIVE_AUTOFILL_INNER_UNSIGNED");
    }
    if (role === "app" && (component.signatureKind !== "developer-id" || component.signatureValid !== true)) {
      reject("NATIVE_AUTOFILL_OUTER_SIGNATURE_INVALID");
    }
    if (component.designatedRequirementValid !== true) {
      reject("NATIVE_AUTOFILL_DESIGNATED_REQUIREMENT_INVALID");
    }
    if (component.hardenedRuntime !== true) {
      reject("NATIVE_AUTOFILL_HARDENED_RUNTIME_MISSING");
    }
    if (component.minimumMacOS !== EXPECTED_MINIMUM_MACOS) {
      reject("NATIVE_AUTOFILL_MACOS_FLOOR_INVALID");
    }
  }

  const app = byRole.get("app");
  const provider = byRole.get("credential-provider");
  const agent = byRole.get("agent");
  if (provider.credentialProvider !== true) {
    reject("NATIVE_AUTOFILL_PROVIDER_ENTITLEMENT_INVALID");
  }
  if (app.credentialProvider !== false || agent.credentialProvider !== false) {
    reject("NATIVE_AUTOFILL_PROVIDER_ENTITLEMENT_UNEXPECTED");
  }
  if (provider.appSandbox !== true) {
    reject("NATIVE_AUTOFILL_PROVIDER_SANDBOX_INVALID");
  }
  if (app.appSandbox !== false || agent.appSandbox !== false) {
    reject("NATIVE_AUTOFILL_SANDBOX_UNEXPECTED");
  }
  if (
    provider.applicationIdentifier !== `${EXPECTED_TEAM_ID}.com.sommir.barwarden.credential-provider` ||
    provider.developerTeamIdentifier !== EXPECTED_TEAM_ID
  ) {
    reject("NATIVE_AUTOFILL_PROVIDER_ENTITLEMENT_INVALID");
  }
  for (const component of [app, agent]) {
    if (
      component.applicationIdentifier !== null ||
      component.developerTeamIdentifier !== null ||
      component.profileApplicationIdentifierKey !== null ||
      !exactStringArray(component.profileEntitlementKeys, []) ||
      component.profileCertificateMatchesSigner !== null
    ) {
      reject("NATIVE_AUTOFILL_ENTITLEMENT_INVENTORY_INVALID");
    }
  }
  if (inspection.insideOutSigning !== true) {
    reject("NATIVE_AUTOFILL_SIGN_ORDER_INVALID");
  }
  if (inspection.signingUsedDeep !== false) {
    reject("NATIVE_AUTOFILL_SIGN_DEEP_FORBIDDEN");
  }
  if (inspection.outerSealValid !== true) {
    reject("NATIVE_AUTOFILL_OUTER_SEAL_INVALID");
  }
  if (inspection.providerProfileValid !== true) {
    reject("NATIVE_AUTOFILL_PROVIDER_PROFILE_INVALID");
  }
  if (provider.profileApplicationIdentifierKey !== "com.apple.application-identifier") {
    reject("NATIVE_AUTOFILL_PROVIDER_PROFILE_INVALID");
  }
  if (
    !validProfileEntitlementInventory(provider.profileEntitlementKeys) ||
    provider.profileCertificateMatchesSigner !== true
  ) {
    reject("NATIVE_AUTOFILL_PROVIDER_PROFILE_INVALID");
  }
  if (inspection.launchAgentValid !== true) {
    reject("NATIVE_AUTOFILL_LAUNCH_AGENT_INVALID");
  }
  if (inspection.registrationCommandSurfaceValid !== true) {
    reject("NATIVE_AUTOFILL_AGENT_REGISTRATION_SURFACE_MISSING");
  }
  if (inspection.dmgInventoryValid !== true) {
    reject("NATIVE_AUTOFILL_DMG_INVENTORY_INVALID");
  }
  if (inspection.dmgSignatureValid !== true) {
    reject("NATIVE_AUTOFILL_DMG_SIGNATURE_INVALID");
  }
  if (inspection.notarized !== true) {
    reject("NATIVE_AUTOFILL_NOTARIZATION_MISSING");
  }
  if (inspection.dmgNotarized !== true) {
    reject("NATIVE_AUTOFILL_NOTARIZATION_MISSING");
  }
  if (inspection.appStapled !== true) {
    reject("NATIVE_AUTOFILL_APP_STAPLE_MISSING");
  }
  if (inspection.dmgStapled !== true) {
    reject("NATIVE_AUTOFILL_DMG_STAPLE_MISSING");
  }
  if (inspection.appGatekeeperAccepted !== true) {
    reject("NATIVE_AUTOFILL_APP_GATEKEEPER_REJECTED");
  }
  if (inspection.dmgGatekeeperAccepted !== true) {
    reject("NATIVE_AUTOFILL_DMG_GATEKEEPER_REJECTED");
  }
  if (
    inspection.attestedAppManifestSha256 !== inspection.artifacts?.appSha256 ||
    inspection.builderPolicyHashValid !== true
  ) {
    reject("NATIVE_AUTOFILL_ATTESTATION_INVALID");
  }
  return "NATIVE_AUTOFILL_RELEASE_GATE_PASS";
}

export function loadAndVerifyNativeAutoFillInspection(path) {
  let inspection;
  try {
    inspection = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    reject("NATIVE_AUTOFILL_INSPECTION_INVALID");
  }
  return verifyNativeAutoFillInspection(inspection);
}
