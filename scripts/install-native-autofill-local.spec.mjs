import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = new URL("../", import.meta.url).pathname.replace(/\/$/u, "");
const installer = join(root, "scripts/install-native-autofill-local.sh");

function run(args, env = {}) {
  return spawnSync(installer, args, {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

test("package.json exposes one stable local native AutoFill installer", () => {
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(
    packageJson.scripts?.["install:macos-local"],
    "scripts/install-native-autofill-local.sh",
  );
  assert.equal(
    packageJson.scripts?.["test:install:macos-local"],
    "node --test scripts/install-native-autofill-local.spec.mjs",
  );
});

test("installer publishes a fixed native build and install plan", () => {
  const result = run(["--print-plan"], { NATIVE_AUTOFILL_INSTALL_TEST_MODE: "1" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split("\n"), [
    "validate-local-inputs",
    "install-public-verification-chain",
    "create-temporary-signing-keychain",
    "build-native-autofill-local",
    "verify-staged-native-inventory",
    "stop-installed-app",
    "install-native-bundle",
    "delete-temporary-signing-keychain",
    "verify-installed-signatures",
    "launch-installed-app",
    "verify-agent-registration",
    "cleanup-temporary-signing-keychain",
  ]);
});

test("installer resolves the pinned verification chain outside the repository", () => {
  const source = readFileSync(installer, "utf8");
  assert.match(source, /read_local_install_preference VerificationCertificate/u);
  assert.match(source, /DEVELOPER_ID_INTERMEDIATE_SHA256/u);
  assert.doesNotMatch(source, /\$SCRIPT_DIR\/certificates/u);
});

test("installer cannot fall back to a plain Tauri package", () => {
  const source = readFileSync(installer, "utf8");
  assert.match(source, /build-native-autofill-local-smoke\.sh/u);
  assert.doesNotMatch(source, /(?:npx\s+)?tauri\s+build/u);
  for (const requiredPath of [
    "Contents/Helpers/BarwardenAutoFillAgent",
    "Contents/PlugIns/BarwardenCredentialProvider.appex",
    "Contents/Library/LaunchAgents/com.sommir.barwarden.autofill-agent.plist",
    "Contents/Resources/BarwardenAutoFill/AppPresets.json",
    "Contents/Resources/BarwardenAutoFill/DomainMatchRules.json",
  ]) {
    assert.ok(source.includes(requiredPath), requiredPath);
  }
});

test("installer keeps machine-specific packaging values out of source", () => {
  const source = readFileSync(installer, "utf8");
  assert.match(source, /defaults read/u);
  assert.doesNotMatch(source, /\/Users\//u);
  assert.doesNotMatch(source, /Library\/CloudStorage/u);
  assert.doesNotMatch(source, /Developer ID Application: [^(\n]+/u);
  assert.doesNotMatch(source, /SIGNING_DIR/u);
});

test("installer uses an isolated keychain and transactionally replaces only Barwarden.app", () => {
  const source = readFileSync(installer, "utf8");
  assert.match(source, /security create-keychain/u);
  assert.match(source, /security delete-keychain/u);
  assert.match(source, /trap cleanup EXIT/u);
  assert.match(source, /Barwarden\.previous\.app/u);
  assert.match(source, /restore_previous_app/u);
  assert.match(source, /INSTALL_PATH="\/Applications\/Barwarden\.app"/u);
  assert.doesNotMatch(source, /rm\s+-rf\s+["']?\$HOME|rm\s+-rf\s+~\//u);
});

test("installer persists only the public chain before creating its private signing keychain", () => {
  const source = readFileSync(installer, "utf8");
  const publicChainInstall = source.indexOf("\nensure_public_verification_chain\n");
  const signingKeychainCreate = source.indexOf("security create-keychain");
  const signingSearchListAdd = source.indexOf(
    'security list-keychains -d user -s "$SIGNING_KEYCHAIN"',
  );
  const signingSearchListRestore = source.lastIndexOf(
    "restore_user_keychain_search_list ||",
  );
  const signingKeychainDelete = source.lastIndexOf('security delete-keychain "$SIGNING_KEYCHAIN"');
  const finalVerification = source.lastIndexOf(
    'codesign --verify --deep --strict --verbose=2 "$INSTALL_PATH"',
  );
  assert.ok(publicChainInstall >= 0, "public verification chain must be installed");
  assert.ok(signingKeychainCreate >= 0, "temporary keychain must be created");
  assert.ok(signingSearchListAdd > signingKeychainCreate, "temporary keychain must join the signing search list");
  assert.ok(signingSearchListRestore > signingSearchListAdd, "the original keychain search list must be restored");
  assert.ok(signingKeychainDelete >= 0, "temporary keychain must be deleted");
  assert.ok(
    publicChainInstall < signingKeychainCreate,
    "public chain installs before the temporary keychain can shadow it",
  );
  assert.ok(finalVerification > signingKeychainDelete, "final verification must use only the public chain");
  assert.ok(signingKeychainDelete > signingSearchListRestore, "the search list must be restored before deletion");
  assert.match(source, /LEGACY_PUBLIC_CERTIFICATES_KEYCHAIN/u);
  assert.match(source, /USER_KEYCHAIN/u);
  assert.match(source, /ORIGINAL_USER_KEYCHAINS/u);
  assert.match(source, /restore_user_keychain_search_list \|\| true/u);
  assert.match(
    source,
    /security import "\$DEVELOPER_ID_INTERMEDIATE"[^\n]*"\$SIGNING_KEYCHAIN"/u,
  );
  assert.match(source, /installed_certificates=/u);
  assert.doesNotMatch(source, /security import "\$SIGNING_CERT"[^\n]*"\$USER_KEYCHAIN"/u);
  assert.doesNotMatch(source, /security delete-certificate/u);
  assert.doesNotMatch(source, /security import "\$SIGNING_KEY"[^\n]*"\$USER_KEYCHAIN"/u);
});

test("installer prefers full Xcode and verifies the installed agent-backed bundle", () => {
  const source = readFileSync(installer, "utf8");
  assert.match(source, /\/Applications\/Xcode\.app\/Contents\/Developer/u);
  assert.match(source, /--register-autofill-agent/u);
  assert.match(source, /codesign --verify --deep --strict/u);
  assert.match(source, /launchctl.*com\.sommir\.barwarden\.autofill-agent/u);
  assert.match(source, /agent-v1\.sock/u);
});
