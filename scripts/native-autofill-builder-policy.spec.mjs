import assert from "node:assert/strict";
import test from "node:test";

import {
  verifyCodesignCommandPolicy,
  verifyNativeAutoFillBuilderPolicy,
} from "./native-autofill-builder-policy.mjs";
import { sanitizeNativeAutoFillCode } from "./native-autofill-release-codes.mjs";

test("accepts deep verification and ordinary inside-out signing", () => {
  assert.doesNotThrow(() => verifyCodesignCommandPolicy(`
    /usr/bin/codesign --force --timestamp --options runtime --sign "$IDENTITY" "$AGENT"
    /usr/bin/codesign --verify --deep --strict "$APP"
  `));
});

test("sanitizes every unknown outward diagnostic to one fixed internal code", () => {
  assert.equal(
    sanitizeNativeAutoFillCode("NATIVE_AUTOFILL_PROVIDER_PROFILE_MISSING"),
    "NATIVE_AUTOFILL_PROVIDER_PROFILE_MISSING",
  );
  assert.equal(
    sanitizeNativeAutoFillCode("NATIVE_AUTOFILL_MADE_UP_FAILURE"),
    "NATIVE_AUTOFILL_INTERNAL_ERROR",
  );
  assert.equal(sanitizeNativeAutoFillCode("/secret/path"), "NATIVE_AUTOFILL_INTERNAL_ERROR");
});

test("rejects deep signing regardless of argument order or line continuation", () => {
  for (const source of [
    "/usr/bin/codesign --deep --sign identity app",
    "/usr/bin/codesign --sign identity --deep app",
    "/usr/bin/codesign --force " + String.fromCharCode(92, 10) +
      "      --deep " + String.fromCharCode(92, 10) +
      "      --sign identity app",
  ]) {
    assert.throws(
      () => verifyCodesignCommandPolicy(source),
      /NATIVE_AUTOFILL_SIGN_DEEP_FORBIDDEN/,
    );
  }
});

test("release builder policy requires exactly Agent then Provider then app then DMG signing", () => {
  const command = (code, target) =>
    `run_or_fail ${code} ${String.fromCharCode(92, 10)}` +
    `    /usr/bin/codesign "\${SIGNING_ARGS[@]}" ${target}`;
  const agent = command("NATIVE_AUTOFILL_AGENT_SIGN_FAILED", '--identifier "com.sommir.barwarden.autofill-agent" "$APP/Contents/Helpers/$AGENT"');
  const provider = command("NATIVE_AUTOFILL_PROVIDER_SIGN_FAILED", '"$APP/Contents/PlugIns/$PROVIDER"');
  const app = command("NATIVE_AUTOFILL_MAIN_APP_SIGN_FAILED", '"$APP"');
  const dmg = command("NATIVE_AUTOFILL_DMG_SIGN_FAILED", '"$DMG"');
  const signingArguments = 'SIGNING_ARGS=(--force --options runtime --sign "$IDENTITY")';

  assert.doesNotThrow(() =>
    verifyNativeAutoFillBuilderPolicy([signingArguments, agent, provider, app, dmg].join("\n")));
  assert.throws(
    () => verifyNativeAutoFillBuilderPolicy([signingArguments, provider, agent, app, dmg].join("\n")),
    /NATIVE_AUTOFILL_SIGN_ORDER_INVALID/,
  );
  assert.throws(
    () => verifyNativeAutoFillBuilderPolicy([
      signingArguments,
      agent.replace('--identifier "com.sommir.barwarden.autofill-agent" ', ""),
      provider,
      app,
      dmg,
    ].join("\n")),
    /NATIVE_AUTOFILL_AGENT_IDENTIFIER_INVALID/,
  );
  assert.throws(
    () => verifyNativeAutoFillBuilderPolicy([
      signingArguments,
      agent,
      provider.replace('"$APP', '--identifier "com.sommir.wrong" "$APP'),
      app,
      dmg,
    ].join("\n")),
    /NATIVE_AUTOFILL_AGENT_IDENTIFIER_INVALID/,
  );
  assert.throws(
    () => verifyNativeAutoFillBuilderPolicy([signingArguments, agent, provider, app, dmg, agent].join("\n")),
    /NATIVE_AUTOFILL_SIGN_ORDER_INVALID/,
  );
  assert.throws(
    () => verifyNativeAutoFillBuilderPolicy([
      signingArguments,
      agent,
      provider,
      app,
      dmg,
      '/usr/bin/codesign --force --sign "$IDENTITY" "$APP/Contents/Helpers/Unexpected"',
    ].join("\n")),
    /NATIVE_AUTOFILL_SIGN_ORDER_INVALID/,
  );
});

test("release builder policy requires both notarization submissions to use the isolated Keychain", () => {
  const source = `
    SIGNING_ARGS=(--force --options runtime --sign "$IDENTITY")
    run_or_fail NATIVE_AUTOFILL_AGENT_SIGN_FAILED /usr/bin/codesign "\${SIGNING_ARGS[@]}" --identifier "com.sommir.barwarden.autofill-agent" "$AGENT"
    run_or_fail NATIVE_AUTOFILL_PROVIDER_SIGN_FAILED /usr/bin/codesign "\${SIGNING_ARGS[@]}" "$PROVIDER"
    run_or_fail NATIVE_AUTOFILL_MAIN_APP_SIGN_FAILED /usr/bin/codesign "\${SIGNING_ARGS[@]}" "$APP"
    run_or_fail NATIVE_AUTOFILL_DMG_SIGN_FAILED /usr/bin/codesign "\${SIGNING_ARGS[@]}" "$DMG"
    NOTARY_ARGS=(--keychain-profile "$PROFILE" --keychain "$KEYCHAIN")
    run_or_fail NATIVE_AUTOFILL_APP_NOTARIZATION_FAILED /usr/bin/xcrun notarytool submit "$ZIP" --wait "\${NOTARY_ARGS[@]}"
    run_or_fail NATIVE_AUTOFILL_DMG_NOTARIZATION_FAILED /usr/bin/xcrun notarytool submit "$DMG" --wait "\${NOTARY_ARGS[@]}"
  `;
  assert.doesNotThrow(() => verifyNativeAutoFillBuilderPolicy(source));
  assert.throws(
    () => verifyNativeAutoFillBuilderPolicy(source.replace(' --keychain "$KEYCHAIN"', "")),
    /NATIVE_AUTOFILL_NOTARY_KEYCHAIN_MISSING/,
  );
});
