import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nativeRoot = path.join(root, "apps", "macos-autofill");

function readPlist(relativePath) {
  return JSON.parse(execFileSync(
    "/usr/bin/plutil",
    ["-convert", "json", "-o", "-", path.join(nativeRoot, relativePath)],
    { encoding: "utf8" },
  ));
}

test("declares only the native Agent, Credential Provider, and unit-test targets", async () => {
  const project = await readFile(
    path.join(nativeRoot, "BarwardenAutoFill.xcodeproj", "project.pbxproj"),
    "utf8",
  );

  assert.match(project, /productType = "com\.apple\.product-type\.tool";/);
  assert.match(project, /productType = "com\.apple\.product-type\.app-extension";/);
  assert.match(project, /productType = "com\.apple\.product-type\.bundle\.unit-test";/);
  assert.equal((project.match(/productType = /g) ?? []).length, 3);
  assert.doesNotMatch(project, /Safari|WebExtension|Chromium|NativeMessaging/i);
});

test("pins native identities, Team ID, App Group, and macOS 13", async () => {
  const config = await readFile(path.join(nativeRoot, "Config", "Native.xcconfig"), "utf8");
  const project = await readFile(
    path.join(nativeRoot, "BarwardenAutoFill.xcodeproj", "project.pbxproj"),
    "utf8",
  );

  assert.match(config, /^DEVELOPMENT_TEAM = K7LY92JY96$/m);
  assert.match(config, /^MACOSX_DEPLOYMENT_TARGET = 13\.0$/m);
  assert.match(config, /^AUTOFILL_APP_GROUP = group\.com\.sommir\.barwarden\.autofill$/m);
  assert.match(config, /^AGENT_BUNDLE_IDENTIFIER = com\.sommir\.barwarden\.autofill-agent$/m);
  assert.match(config, /^CREDENTIAL_PROVIDER_BUNDLE_IDENTIFIER = com\.sommir\.barwarden\.credential-provider$/m);
  assert.match(project, /CREATE_INFOPLIST_SECTION_IN_BINARY = YES;/);
});

test("assigns exact entitlements to each native product", () => {
  const agent = readPlist("Agent/Entitlements.plist");
  const provider = readPlist("CredentialProvider/Entitlements.plist");

  assert.deepEqual(agent, {
    "com.apple.security.application-groups": ["group.com.sommir.barwarden.autofill"],
  });
  assert.deepEqual(provider, {
    "com.apple.developer.authentication-services.autofill-credential-provider": true,
    "com.apple.security.app-sandbox": true,
    "com.apple.security.application-groups": ["group.com.sommir.barwarden.autofill"],
  });
  assert.equal("keychain-access-groups" in agent, false);
  assert.equal("keychain-access-groups" in provider, false);
});

test("declares the macOS AutoFill Credential Provider extension point", () => {
  const info = readPlist("CredentialProvider/Info.plist");

  assert.equal(info.CFBundleIdentifier, "$(PRODUCT_BUNDLE_IDENTIFIER)");
  assert.equal(
    info.NSExtension.NSExtensionPointIdentifier,
    "com.apple.authentication-services-credential-provider-ui",
  );
  assert.equal(
    info.NSExtension.NSExtensionPrincipalClass,
    "$(PRODUCT_MODULE_NAME).CredentialProviderViewController",
  );
});

async function createFakeXcodebuild(directory, { extraProduct = false, symlinkedAgent = false } = {}) {
  const executable = path.join(directory, "xcodebuild");
  const source = `#!/bin/sh
set -eu
derived=""
configuration=""
scheme=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -derivedDataPath) derived="$2"; shift 2 ;;
    -configuration) configuration="$2"; shift 2 ;;
    -scheme) scheme="$2"; shift 2 ;;
    *) shift ;;
  esac
done
[ "$scheme" = "BarwardenNativeAutoFill" ]
products="$derived/Build/Products/$configuration"
[ ! -e "$derived/xcodebuild-invoked" ]
mkdir -p "$derived"
: > "$derived/xcodebuild-invoked"
mkdir -p "$products/BarwardenCredentialProvider.appex/Contents/MacOS"
printf provider > "$products/BarwardenCredentialProvider.appex/Contents/MacOS/BarwardenCredentialProvider"
chmod +x "$products/BarwardenCredentialProvider.appex/Contents/MacOS/BarwardenCredentialProvider"
${symlinkedAgent
    ? "printf agent > \"$products/agent-source\"; chmod +x \"$products/agent-source\"; ln -s agent-source \"$products/BarwardenAutoFillAgent\""
    : "printf agent > \"$products/BarwardenAutoFillAgent\"; chmod +x \"$products/BarwardenAutoFillAgent\""}
${extraProduct ? "mkdir -p \"$products/UnexpectedSafari.appex\"" : ":"}
`;
  await writeFile(executable, source, { mode: 0o755 });
  await chmod(executable, 0o755);
  return executable;
}

async function runBuildWrapper(options = {}) {
  const fixture = await mkdtemp(path.join(tmpdir(), "barwarden-native-build-"));
  const bin = path.join(fixture, "bin");
  const derivedData = path.join(fixture, "derived-data");
  const staging = path.join(fixture, "staging");
  await mkdir(bin);
  const xcodebuild = await createFakeXcodebuild(bin, options);
  const result = spawnSync(path.join(root, "scripts", "build-native-autofill.sh"), [], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      CONFIGURATION: "Release",
      DERIVED_DATA_PATH: derivedData,
      STAGING_DIR: staging,
      XCODEBUILD: xcodebuild,
    },
  });
  return { ...result, derivedData, staging };
}

test("build wrapper stages exactly the Agent and Credential Provider", async () => {
  const result = await runBuildWrapper();

  assert.equal(result.status, 0, result.stderr);
  const staged = execFileSync("/bin/ls", ["-1", result.staging], { encoding: "utf8" })
    .trim()
    .split("\n");
  assert.deepEqual(staged, ["BarwardenAutoFillAgent", "BarwardenCredentialProvider.appex"]);
});

test("build wrapper rejects unexpected or symlinked products", async () => {
  const unexpected = await runBuildWrapper({ extraProduct: true });
  assert.notEqual(unexpected.status, 0);
  assert.match(unexpected.stderr, /unexpected product/i);

  const symlinked = await runBuildWrapper({ symlinkedAgent: true });
  assert.notEqual(symlinked.status, 0);
  assert.match(symlinked.stderr, /symbolic link/i);
});
