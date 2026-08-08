import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nativeRoot = path.join(root, "apps", "macos-autofill");
const projectPath = path.join(nativeRoot, "BarwardenAutoFill.xcodeproj");
const schemePath = path.join(
  projectPath,
  "xcshareddata",
  "xcschemes",
  "BarwardenNativeAutoFill.xcscheme",
);

function readPlistAt(plistPath) {
  return JSON.parse(execFileSync(
    "/usr/bin/plutil",
    ["-convert", "json", "-o", "-", plistPath],
    { encoding: "utf8" },
  ));
}

function readPlist(relativePath) {
  return readPlistAt(path.join(nativeRoot, relativePath));
}

function fullDeveloperDir() {
  const developerDir = process.env.DEVELOPER_DIR;
  assert.ok(developerDir, "DEVELOPER_DIR must point to the full Xcode used by this test run");
  assert.ok(
    existsSync(path.join(developerDir, "Platforms", "MacOSX.platform")),
    "DEVELOPER_DIR must contain the macOS platform",
  );
  return developerDir;
}

function runXcodebuild(arguments_) {
  const developerDir = fullDeveloperDir();
  return execFileSync(path.join(developerDir, "usr", "bin", "xcodebuild"), arguments_, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, DEVELOPER_DIR: developerDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const buildSettingsPromises = new Map();
async function parsedBuildSettings(configuration) {
  if (!buildSettingsPromises.has(configuration)) {
    buildSettingsPromises.set(configuration, (async () => {
    const derivedData = await mkdtemp(path.join(tmpdir(), "barwarden-settings-"));
    return JSON.parse(runXcodebuild([
      "-project", projectPath,
      "-scheme", "BarwardenNativeAutoFill",
      "-configuration", configuration,
      "-derivedDataPath", derivedData,
      "-showBuildSettings",
      "-json",
    ]));
    })());
  }
  return buildSettingsPromises.get(configuration);
}

function xpath(expression) {
  return execFileSync("/usr/bin/xmllint", ["--xpath", expression, schemePath], {
    encoding: "utf8",
  }).trim();
}

function projectTargets() {
  const inventory = JSON.parse(runXcodebuild([
    "-project", projectPath,
    "-list",
    "-json",
  ]));
  return inventory.project.targets.toSorted();
}

test("Xcode project inventory rejects every undeclared or browser-related target", () => {
  const targets = projectTargets();

  assert.deepEqual(targets, [
    "BarwardenAutoFillAgent",
    "BarwardenAutoFillTests",
    "BarwardenCredentialProvider",
  ]);
  for (const target of targets) {
    assert.doesNotMatch(target, /Safari|WebExtension|Chromium|NativeMessaging/i);
  }
});

test("shared scheme has only two deliverable native products and one test bundle", () => {
  assert.equal(xpath("string(count(/Scheme/BuildAction/BuildActionEntries/BuildActionEntry))"), "3");
  assert.equal(xpath("string(count(//BuildActionEntry[@buildForRunning='YES']/BuildableReference[@BlueprintName='BarwardenAutoFillAgent' and @BuildableName='BarwardenAutoFillAgent']))"), "1");
  assert.equal(xpath("string(count(//BuildActionEntry[@buildForRunning='YES']/BuildableReference[@BlueprintName='BarwardenCredentialProvider' and @BuildableName='BarwardenCredentialProvider.appex']))"), "1");
  assert.equal(xpath("string(count(//BuildActionEntry[@buildForRunning='NO']/BuildableReference[@BlueprintName='BarwardenAutoFillTests' and @BuildableName='BarwardenAutoFillTests.xctest']))"), "1");
  assert.equal(xpath("string(count(/Scheme/TestAction/Testables/TestableReference/BuildableReference[@BlueprintName='BarwardenAutoFillTests']))"), "1");
});

test("shared scheme archives only the Agent and Credential Provider", () => {
  assert.equal(xpath("string(count(//BuildActionEntry[@buildForArchiving='YES']))"), "2");
  assert.equal(xpath("string(count(//BuildActionEntry[@buildForArchiving='NO']))"), "1");
  assert.equal(xpath("string(count(//BuildActionEntry[@buildForArchiving='YES']/BuildableReference[@BlueprintName='BarwardenAutoFillAgent']))"), "1");
  assert.equal(xpath("string(count(//BuildActionEntry[@buildForArchiving='YES']/BuildableReference[@BlueprintName='BarwardenCredentialProvider']))"), "1");
  assert.equal(xpath("string(count(//BuildActionEntry[@buildForArchiving='NO']/BuildableReference[@BlueprintName='BarwardenAutoFillTests']))"), "1");
});

test("Xcode resolves exact target identities, entitlements, products, and macOS floor", async () => {
  for (const configuration of ["Debug", "Release"]) {
    const settings = await parsedBuildSettings(configuration);
    const byTarget = Object.fromEntries(settings.map((entry) => [entry.target, entry.buildSettings]));
    assert.deepEqual(Object.keys(byTarget).sort(), [
      "BarwardenAutoFillAgent",
      "BarwardenCredentialProvider",
    ], configuration);

    assert.equal(byTarget.BarwardenAutoFillAgent.PRODUCT_BUNDLE_IDENTIFIER, "com.sommir.barwarden.autofill-agent", configuration);
    assert.equal(byTarget.BarwardenAutoFillAgent.PRODUCT_TYPE, "com.apple.product-type.tool", configuration);
    assert.equal(byTarget.BarwardenAutoFillAgent.FULL_PRODUCT_NAME, "BarwardenAutoFillAgent", configuration);
    assert.equal(byTarget.BarwardenAutoFillAgent.CODE_SIGN_ENTITLEMENTS, "Agent/Entitlements.plist", configuration);
    assert.equal(byTarget.BarwardenAutoFillAgent.CREATE_INFOPLIST_SECTION_IN_BINARY, "YES", configuration);

    assert.equal(byTarget.BarwardenCredentialProvider.PRODUCT_BUNDLE_IDENTIFIER, "com.sommir.barwarden.credential-provider", configuration);
    assert.equal(byTarget.BarwardenCredentialProvider.PRODUCT_TYPE, "com.apple.product-type.app-extension", configuration);
    assert.equal(byTarget.BarwardenCredentialProvider.FULL_PRODUCT_NAME, "BarwardenCredentialProvider.appex", configuration);
    assert.equal(byTarget.BarwardenCredentialProvider.CODE_SIGN_ENTITLEMENTS, "CredentialProvider/Entitlements.plist", configuration);
    assert.equal(byTarget.BarwardenCredentialProvider.INFOPLIST_FILE, "CredentialProvider/Info.plist", configuration);
    assert.equal(byTarget.BarwardenCredentialProvider.PRODUCT_MODULE_NAME, "BarwardenCredentialProvider", configuration);
    assert.equal(byTarget.BarwardenCredentialProvider.ENABLE_APP_SANDBOX, "YES", configuration);

    for (const target of Object.values(byTarget)) {
      assert.equal(target.CONFIGURATION, configuration);
      assert.equal(target.DEVELOPMENT_TEAM, "K7LY92JY96", configuration);
      assert.equal(target.MACOSX_DEPLOYMENT_TARGET, "13.0", configuration);
      assert.equal(target.AUTOFILL_APP_GROUP, "group.com.sommir.barwarden.autofill", configuration);
    }
  }
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
  assert.deepEqual(
    info.NSExtension.NSExtensionAttributes.ASCredentialProviderExtensionCapabilities,
    { ProvidesOneTimeCodes: true, ProvidesPasswords: true },
  );
});

let unsignedBuildPromise;
async function unsignedBuild() {
  unsignedBuildPromise ??= (async () => {
    const derivedData = await mkdtemp(path.join(tmpdir(), "barwarden-native-products-"));
    runXcodebuild([
      "-project", projectPath,
      "-scheme", "BarwardenNativeAutoFill",
      "-configuration", "Debug",
      "-derivedDataPath", derivedData,
      "CODE_SIGNING_ALLOWED=NO",
      "build",
    ]);
    return path.join(derivedData, "Build", "Products", "Debug");
  })();
  return unsignedBuildPromise;
}

test("built products expose the exact Agent and provider runtime metadata", async () => {
  const products = await unsignedBuild();
  const agent = path.join(products, "BarwardenAutoFillAgent");
  const providerInfo = readPlistAt(path.join(
    products,
    "BarwardenCredentialProvider.appex",
    "Contents",
    "Info.plist",
  ));
  const sections = execFileSync("/usr/bin/otool", ["-s", "__TEXT", "__info_plist", agent], {
    encoding: "utf8",
  });
  const strings = execFileSync("/usr/bin/strings", ["-a", agent], { encoding: "utf8" });

  assert.match(sections, /Contents of \(__TEXT,__info_plist\) section/);
  assert.match(strings, /<string>com\.sommir\.barwarden\.autofill-agent<\/string>/);
  assert.equal(providerInfo.CFBundleIdentifier, "com.sommir.barwarden.credential-provider");
  assert.equal(
    providerInfo.NSExtension.NSExtensionPrincipalClass,
    "BarwardenCredentialProvider.CredentialProviderViewController",
  );
  assert.equal(providerInfo.LSMinimumSystemVersion, "13.0");
});

async function createFakeXcodebuild(directory, options = {}) {
  const {
    extraProductName,
    nestedProviderSymlink = false,
    symlinkedAgent = false,
  } = options;
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
mkdir -p "$products/BarwardenAutoFillAgent.dSYM" "$products/BarwardenAutoFillAgent.swiftmodule"
mkdir -p "$products/BarwardenCredentialProvider.appex.dSYM" "$products/BarwardenCredentialProvider.swiftmodule"
${nestedProviderSymlink
    ? "mkdir -p \"$products/BarwardenCredentialProvider.appex/Contents/Resources\"; ln -s /private/tmp \"$products/BarwardenCredentialProvider.appex/Contents/Resources/escape\""
    : ":"}
${symlinkedAgent
    ? "printf agent > \"$products/agent-source\"; chmod +x \"$products/agent-source\"; ln -s agent-source \"$products/BarwardenAutoFillAgent\""
    : "printf agent > \"$products/BarwardenAutoFillAgent\"; chmod +x \"$products/BarwardenAutoFillAgent\""}
${extraProductName ? `mkdir -p "$products/${extraProductName}"` : ":"}
`;
  await writeFile(executable, source, { mode: 0o755 });
  await chmod(executable, 0o755);
  return executable;
}

async function runBuildWrapper(options = {}) {
  // macOS exposes /var as a system symlink. Use its canonical /private/tmp
  // location so wrapper fixtures exercise only symlinks created by each case.
  const fixture = await mkdtemp("/private/tmp/barwarden-native-build-");
  const bin = path.join(fixture, "bin");
  let derivedData = path.join(fixture, "derived-data");
  let staging = path.join(fixture, "staging");
  await mkdir(bin);

  if (options.derivedDataSymlinkAncestor) {
    const real = path.join(fixture, "real-derived-parent");
    const linked = path.join(fixture, "linked-derived-parent");
    await mkdir(real);
    await symlink(real, linked, "dir");
    derivedData = path.join(linked, "derived-data");
  }
  if (options.stagingSymlinkAncestor) {
    const real = path.join(fixture, "real-staging-parent");
    const linked = path.join(fixture, "linked-staging-parent");
    await mkdir(real);
    await symlink(real, linked, "dir");
    staging = path.join(linked, "staging");
  }
  if (options.nonEmptyStaging) {
    await mkdir(staging, { recursive: true });
    await writeFile(path.join(staging, "existing"), "do not overwrite");
  }

  const xcodebuild = await createFakeXcodebuild(bin, options);
  const environment = {
    ...process.env,
    CONFIGURATION: "Release",
    DERIVED_DATA_PATH: derivedData,
    STAGING_DIR: staging,
    XCODEBUILD: xcodebuild,
  };
  if (options.omitDeveloperDir) {
    delete environment.DEVELOPER_DIR;
    const invalidDeveloperDir = path.join(fixture, "CommandLineTools");
    const xcodeSelect = path.join(bin, "xcode-select");
    await mkdir(invalidDeveloperDir);
    await writeFile(xcodeSelect, `#!/bin/sh\nprintf '%s\\n' '${invalidDeveloperDir}'\n`, { mode: 0o755 });
    environment.XCODE_SELECT = xcodeSelect;
  } else {
    environment.DEVELOPER_DIR = fullDeveloperDir();
  }

  const result = spawnSync(path.join(root, "scripts", "build-native-autofill.sh"), [], {
    cwd: root,
    encoding: "utf8",
    env: environment,
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

test("build wrapper obtains Xcode from xcode-select and rejects Command Line Tools", async () => {
  const result = await runBuildWrapper({ omitDeveloperDir: true });

  assert.equal(result.status, 78);
  assert.match(result.stderr, /full Xcode developer directory/i);
});

test("build wrapper rejects a symlink in derived-data or staging ancestors", async () => {
  const derived = await runBuildWrapper({ derivedDataSymlinkAncestor: true });
  assert.notEqual(derived.status, 0);
  assert.match(derived.stderr, /symbolic link/i);

  const staging = await runBuildWrapper({ stagingSymlinkAncestor: true });
  assert.notEqual(staging.status, 0);
  assert.match(staging.stderr, /symbolic link/i);
});

test("build wrapper rejects terminal and nested product symlinks", async () => {
  const agent = await runBuildWrapper({ symlinkedAgent: true });
  assert.notEqual(agent.status, 0);
  assert.match(agent.stderr, /symbolic link/i);

  const provider = await runBuildWrapper({ nestedProviderSymlink: true });
  assert.notEqual(provider.status, 0);
  assert.match(provider.stderr, /symbolic link/i);
});

test("build wrapper rejects every unexpected top-level product", async () => {
  for (const extraProductName of ["Unexpected.framework", "Unexpected.bundle", "arbitrary-entry"]) {
    const result = await runBuildWrapper({ extraProductName });
    assert.notEqual(result.status, 0, extraProductName);
    assert.match(result.stderr, /unexpected product/i, extraProductName);
  }
});

test("build wrapper refuses a non-empty staging directory", async () => {
  const result = await runBuildWrapper({ nonEmptyStaging: true });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be empty/i);
});
