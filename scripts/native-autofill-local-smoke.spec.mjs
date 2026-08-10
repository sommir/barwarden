import assert from "node:assert/strict";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const root = new URL("../", import.meta.url).pathname.replace(/\/$/u, "");
const builder = join(root, "scripts/build-native-autofill-local-smoke.sh");
const policy = join(root, "scripts/native-autofill-local-smoke-policy.mjs");
const smoke = join(root, "scripts/run-native-autofill-local-smoke.sh");
const execFileAsync = promisify(execFile);

function run(command, args, env = {}) {
  return spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

test("local builder is rejected without the explicit local-smoke-only gate", () => {
  const result = run(builder, ["--preflight"]);
  assert.equal(result.status, 1);
  assert.equal(result.stderr.trim(), "NATIVE_AUTOFILL_LOCAL_SMOKE_MODE_REQUIRED");
});

test("local and release builders package the Agent matching catalogs beside the raw helper", () => {
  for (const path of [builder, join(root, "scripts/build-native-autofill-release.sh")]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /Contents\/Resources\/BarwardenAutoFill/u, basename(path));
    assert.match(source, /Agent\/AppPresets\.json/u, basename(path));
    assert.match(source, /Agent\/DomainMatchRules\.json/u, basename(path));
  }
});

test("local builder preflight accepts only explicit external references and warns on a missing Provider profile", () => {
  const directory = mkdtempSync("/private/tmp/barwarden-local-smoke-preflight-");
  try {
    const keychain = join(directory, "signing.keychain-db");
    const output = join(directory, "output");
    writeFileSync(keychain, "keychain-reference", { mode: 0o600 });
    mkdirSync(output, { mode: 0o700 });
    const result = run(builder, ["--preflight"], {
      NATIVE_AUTOFILL_LOCAL_SMOKE_ONLY: "1",
      NATIVE_AUTOFILL_SIGNING_IDENTITY: "external-reference",
      NATIVE_AUTOFILL_SIGNING_KEYCHAIN: keychain,
      NATIVE_AUTOFILL_LOCAL_OUTPUT_DIR: output,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stderr.trim().split("\n"), [
      "NATIVE_AUTOFILL_LOCAL_PROVIDER_PROFILE_MISSING",
    ]);
    assert.equal(result.stdout.trim(), "NATIVE_AUTOFILL_LOCAL_SMOKE_PREFLIGHT_PASS");
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /\/(?:Users|private|tmp)\//u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("static local policy cannot be confused with release or deep signing", () => {
  const source = readFileSync(builder, "utf8");
  const providerEqualsIdentifier = source.replace(
    /(NATIVE_AUTOFILL_LOCAL_PROVIDER_SIGN_FAILED[\s\S]*?\/usr\/bin\/codesign "\$\{SIGNING_ARGS\[@\]\}")/u,
    "$1 --identifier=com.sommir.wrong",
  );
  const inlineCommentBypass = source
    .replace(/^SIGNING_CERTIFICATES=.*?^\/bin\/rm -f "\$SIGNING_CERTIFICATES"\n/msu, "")
    .replace(/^SIGNATURE_DETAILS=.*?^unset AUTHORITY_COUNT LEAF_AUTHORITY AUTHORITY_TAIL EXPECTED_AUTHORITY_TAIL\n/msu, "")
    .replace(/^SIGNER_PREFIX=.*?^unset INTERMEDIATE_SHA1 ROOT_SHA1 SIGNER_PREFIX\n/msu, "")
    .concat(`
: # security find-certificate -a -Z
: # SHA-1 hash: 5B45F61068B29FCC8FFFF1A7E99B78DA9E9C4635
: # AUTHORITY_COUNT="$(/usr/bin/grep -c
: # LEAF_AUTHORITY="$(/usr/bin/awk
: # EXPECTED_AUTHORITY_TAIL='Authority=Developer ID Certification Authority
: # Authority=Developer ID Certification Authority
: # Authority=Apple Root CA'
: # [[ "$AUTHORITY_COUNT" == 3 ]]
: # [[ "$LEAF_AUTHORITY" == 'Authority=Developer ID Application: '*" ($TEAM_ID)" ]]
: # [[ "$AUTHORITY_TAIL" == "$EXPECTED_AUTHORITY_TAIL" ]]
: # /usr/bin/codesign -d --extract-certificates="$SIGNER_PREFIX" "$OUTPUT_APP"
: # [[ -f "\${SIGNER_PREFIX}0" && -f "\${SIGNER_PREFIX}1" && -f "\${SIGNER_PREFIX}2" && ! -e "\${SIGNER_PREFIX}3" ]]
: # /usr/bin/openssl x509 -inform DER -in "\${SIGNER_PREFIX}1"
: # [[ "$INTERMEDIATE_SHA1" == 5B45F61068B29FCC8FFFF1A7E99B78DA9E9C4635 ]]
: # /usr/bin/openssl x509 -inform DER -in "\${SIGNER_PREFIX}2"
: # [[ "$ROOT_SHA1" == 611E5B662C593A08FF58D14AE22452D198DF6C60 ]]
`);
  const valid = run(process.execPath, [policy, builder]);
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(valid.stdout.trim(), "NATIVE_AUTOFILL_LOCAL_SMOKE_POLICY_PASS");

  const directory = mkdtempSync(join(tmpdir(), "barwarden-local-smoke-policy-"));
  try {
    const mutations = [
      ["release", `${source}\n/usr/bin/xcrun notarytool submit artifact\n`, "NATIVE_AUTOFILL_LOCAL_SMOKE_RELEASE_OPERATION_FORBIDDEN"],
      ["release-verifier", `${source}\nscripts/verify-native-autofill-bundle.sh --app artifact\n`, "NATIVE_AUTOFILL_LOCAL_SMOKE_RELEASE_OPERATION_FORBIDDEN"],
      ["deep", `${source}\n/usr/bin/codesign --deep --sign identity app\n`, "NATIVE_AUTOFILL_SIGN_DEEP_FORBIDDEN"],
      ["gate", source.replace('NATIVE_AUTOFILL_LOCAL_SMOKE_ONLY:-0}" == 1', 'NATIVE_AUTOFILL_LOCAL_SMOKE_ONLY:-0}" == 0'), "NATIVE_AUTOFILL_LOCAL_SMOKE_GATE_INVALID"],
      ["release-name", source.replace('LOCAL_APP_NAME="Barwarden Local Smoke.app"', 'LOCAL_APP_NAME="Barwarden.app"'), "NATIVE_AUTOFILL_LOCAL_OUTPUT_CONTRACT_INVALID"],
      ["output-verify", source.replace('/usr/bin/codesign --verify --deep --strict --verbose=2 "$OUTPUT_APP"', '# output verification removed'), "NATIVE_AUTOFILL_LOCAL_OUTPUT_VERIFY_MISSING"],
      ["signing-chain", source.replace('Authority=Developer ID Certification Authority', 'Authority=Missing Intermediate'), "NATIVE_AUTOFILL_LOCAL_OUTPUT_VERIFY_MISSING"],
      ["root-fingerprint", source.replace('611E5B662C593A08FF58D14AE22452D198DF6C60', '0000000000000000000000000000000000000000'), "NATIVE_AUTOFILL_LOCAL_OUTPUT_VERIFY_MISSING"],
      [
        "comment-only-signing-chain",
        source
          .replace(/^SIGNING_CERTIFICATES=.*?^\/bin\/rm -f "\$SIGNING_CERTIFICATES"\n/msu, '# SHA-1 hash: 5B45F61068B29FCC8FFFF1A7E99B78DA9E9C4635\n')
          .replace(/^SIGNATURE_DETAILS=.*?^\/bin\/rm -f "\$SIGNATURE_DETAILS"\n/msu, '# Authority=Developer ID Certification Authority\n'),
        "NATIVE_AUTOFILL_LOCAL_OUTPUT_VERIFY_MISSING",
      ],
      ["inline-comment-signing-chain", inlineCommentBypass, "NATIVE_AUTOFILL_LOCAL_OUTPUT_VERIFY_MISSING"],
      ["temp-template", source.replace('.tauri-native-autofill-local.json.XXXXXX', '.tauri-native-autofill-local.XXXXXX.json'), "NATIVE_AUTOFILL_LOCAL_TEMP_CONTRACT_INVALID"],
      ["temp-failure", source.replace('2>/dev/null)" || fail NATIVE_AUTOFILL_LOCAL_TEMP_CREATE_FAILED', ')"'), "NATIVE_AUTOFILL_LOCAL_TEMP_CONTRACT_INVALID"],
      ["agent-identifier", source.replace('--identifier "com.sommir.barwarden.autofill-agent"', ''), "NATIVE_AUTOFILL_AGENT_IDENTIFIER_INVALID"],
      ["shared-identifier", source.replace('SIGNING_ARGS=(--force', 'SIGNING_ARGS=(--identifier "com.sommir.shared" --force'), "NATIVE_AUTOFILL_SIGNING_ARGS_IDENTIFIER_FORBIDDEN"],
      ["shared-identifier-equals", source.replace('SIGNING_ARGS=(--force', 'SIGNING_ARGS=(--identifier=com.sommir.shared --force'), "NATIVE_AUTOFILL_SIGNING_ARGS_IDENTIFIER_FORBIDDEN"],
      ["provider-identifier-equals", providerEqualsIdentifier, "NATIVE_AUTOFILL_AGENT_IDENTIFIER_INVALID"],
      ["requirement-command", source.replace('/usr/bin/codesign --verify -R="anchor apple generic', '/usr/bin/codesign -R "=designated => anchor apple generic'), "NATIVE_AUTOFILL_DESIGNATED_REQUIREMENT_COMMAND_INVALID"],
    ];
    for (const [name, mutation, code] of mutations) {
      const path = join(directory, `${name}.sh`);
      writeFileSync(path, mutation);
      const result = run(process.execPath, [policy, path]);
      assert.equal(result.status, 1, name);
      assert.equal(result.stderr.trim(), code, name);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("trailing-X overlay template is collision-safe with stale and concurrent files", async () => {
  const directory = mkdtempSync("/private/tmp/barwarden-local-overlay-");
  const template = join(directory, ".tauri-native-autofill-local.json.XXXXXX");
  try {
    const stale = (await execFileAsync("/usr/bin/mktemp", [template])).stdout.trim();
    const created = await Promise.all(
      Array.from({ length: 8 }, () => execFileAsync("/usr/bin/mktemp", [template])),
    );
    const paths = [stale, ...created.map(({ stdout }) => stdout.trim())];
    assert.equal(new Set(paths).size, paths.length);
    for (const path of paths) {
      assert.equal(existsSync(path), true);
      assert.match(basename(path), /^\.tauri-native-autofill-local\.json\.[A-Za-z0-9]{6}$/u);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("raw Agent signing needs an explicit stable identifier", () => {
  const directory = mkdtempSync("/private/tmp/barwarden-agent-identifier-");
  const agent = join(directory, "BarwardenAutoFillAgent");
  copyFileSync("/usr/bin/true", agent);
  try {
    const inferredSign = run("/usr/bin/codesign", ["--force", "--sign", "-", agent]);
    assert.equal(inferredSign.status, 0, inferredSign.stderr);
    const inferred = run("/usr/bin/codesign", ["-d", "--verbose=4", agent]);
    assert.doesNotMatch(inferred.stderr, /^Identifier=com\.sommir\.barwarden\.autofill-agent$/mu);

    const explicitSign = run("/usr/bin/codesign", [
      "--force", "--sign", "-", "--identifier", "com.sommir.barwarden.autofill-agent", agent,
    ]);
    assert.equal(explicitSign.status, 0, explicitSign.stderr);
    const explicit = run("/usr/bin/codesign", ["-d", "--verbose=4", agent]);
    assert.match(explicit.stderr, /^Identifier=com\.sommir\.barwarden\.autofill-agent$/mu);

    const incorrectRequirement = run("/usr/bin/codesign", [
      "-R", '=designated => identifier "com.sommir.barwarden.autofill-agent"', agent,
    ]);
    assert.notEqual(incorrectRequirement.status, 0);
    const correctRequirement = run("/usr/bin/codesign", [
      "--verify", '-R=identifier "com.sommir.barwarden.autofill-agent"', agent,
    ]);
    assert.equal(correctRequirement.status, 0, correctRequirement.stderr);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("bounded helper rejects an ordinary release-named app", () => {
  const directory = mkdtempSync(join(tmpdir(), "barwarden-local-smoke-name-"));
  const app = join(directory, "Barwarden.app");
  mkdirSync(join(app, "Contents/MacOS"), { recursive: true });
  mkdirSync(join(app, "Contents/PlugIns/BarwardenCredentialProvider.appex"), { recursive: true });
  writeFileSync(join(app, "Contents/MacOS/barwarden"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  try {
    const result = run(smoke, ["--app", app], { NATIVE_AUTOFILL_LOCAL_SMOKE_ONLY: "1" });
    assert.equal(result.status, 1);
    assert.equal(result.stderr.trim(), "NATIVE_AUTOFILL_LOCAL_APP_NAME_INVALID");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("bounded current-mac helper emits fixed codes only and probes no secret", () => {
  const directory = mkdtempSync(join(tmpdir(), "barwarden-local-smoke-helper-"));
  const app = join(directory, "Barwarden Local Smoke.app");
  const bin = join(directory, "bin");
  const socket = join(directory, "agent-v1.sock");
  mkdirSync(join(app, "Contents/MacOS"), { recursive: true });
  mkdirSync(join(app, "Contents/PlugIns/BarwardenCredentialProvider.appex"), { recursive: true });
  mkdirSync(bin);
  writeFileSync(join(app, "Contents/MacOS/barwarden"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  for (const command of ["open", "pgrep", "launchctl", "socket-test"]) {
    writeFileSync(join(bin, command), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    chmodSync(join(bin, command), 0o700);
  }
  writeFileSync(
    join(bin, "pluginkit"),
    "#!/bin/sh\nif [ \"$1\" = -m ]; then printf '%s\\n' com.sommir.barwarden.credential-provider; fi\n",
    { mode: 0o700 },
  );
  writeFileSync(join(bin, "osascript"), "#!/bin/sh\nprintf 'true\\n'\n", { mode: 0o700 });
  try {
    const result = run(smoke, ["--app", app], {
      NATIVE_AUTOFILL_LOCAL_SMOKE_ONLY: "1",
      NATIVE_AUTOFILL_LOCAL_AGENT_SOCKET: socket,
      NATIVE_AUTOFILL_OPEN_COMMAND: join(bin, "open"),
      NATIVE_AUTOFILL_PGREP_COMMAND: join(bin, "pgrep"),
      NATIVE_AUTOFILL_LAUNCHCTL_COMMAND: join(bin, "launchctl"),
      NATIVE_AUTOFILL_PLUGINKIT_COMMAND: join(bin, "pluginkit"),
      NATIVE_AUTOFILL_OSASCRIPT_COMMAND: join(bin, "osascript"),
      NATIVE_AUTOFILL_SOCKET_TEST_COMMAND: join(bin, "socket-test"),
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split("\n"), [
      "NATIVE_AUTOFILL_LOCAL_APP_LAUNCH_PASS",
      "NATIVE_AUTOFILL_LOCAL_AGENT_STATUS_PASS",
      "NATIVE_AUTOFILL_LOCAL_AGENT_PROBE_PASS",
      "NATIVE_AUTOFILL_LOCAL_PROVIDER_REGISTRATION_PASS",
      "NATIVE_AUTOFILL_LOCAL_PROVIDER_DISCOVERY_PASS",
      "NATIVE_AUTOFILL_LOCAL_AX_STATUS_PASS",
      "NATIVE_AUTOFILL_LOCAL_SMOKE_COMPLETE",
    ]);
    assert.equal(result.stderr, "");
    assert.doesNotMatch(result.stdout, /secret|password|token|\/(?:Users|private|tmp)\//iu);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("bounded helper never forces a second local app instance", () => {
  const source = readFileSync(smoke, "utf8");
  assert.doesNotMatch(source, /"[$]OPEN_COMMAND"\s+-n\s+"[$]APP_PATH"/u);
  assert.match(source, /"[$]OPEN_COMMAND"\s+"[$]APP_PATH"/u);
});

test("profileless provider rejection remains a fixed local-only incomplete result", () => {
  const directory = mkdtempSync(join(tmpdir(), "barwarden-local-smoke-reject-"));
  const app = join(directory, "Barwarden Local Smoke.app");
  const bin = join(directory, "bin");
  mkdirSync(join(app, "Contents/MacOS"), { recursive: true });
  mkdirSync(join(app, "Contents/PlugIns/BarwardenCredentialProvider.appex"), { recursive: true });
  mkdirSync(bin);
  writeFileSync(join(app, "Contents/MacOS/barwarden"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  for (const command of ["pass", "osascript"]) {
    writeFileSync(join(bin, command), "#!/bin/sh\nprintf 'true\\n'\n", { mode: 0o700 });
  }
  writeFileSync(join(bin, "reject"), "#!/bin/sh\nexit 1\n", { mode: 0o700 });
  try {
    const result = run(smoke, ["--app", app], {
      NATIVE_AUTOFILL_LOCAL_SMOKE_ONLY: "1",
      NATIVE_AUTOFILL_OPEN_COMMAND: join(bin, "pass"),
      NATIVE_AUTOFILL_PGREP_COMMAND: join(bin, "pass"),
      NATIVE_AUTOFILL_LAUNCHCTL_COMMAND: join(bin, "pass"),
      NATIVE_AUTOFILL_SOCKET_TEST_COMMAND: join(bin, "pass"),
      NATIVE_AUTOFILL_PLUGINKIT_COMMAND: join(bin, "reject"),
      NATIVE_AUTOFILL_OSASCRIPT_COMMAND: join(bin, "osascript"),
    });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /^NATIVE_AUTOFILL_(?:LOCAL_[A-Z_]+|APP_ARTIFACT_INVALID)(?:\n|$)+/u);
    assert.match(result.stdout, /NATIVE_AUTOFILL_LOCAL_PROVIDER_REGISTRATION_FAILED/u);
    assert.match(result.stdout, /NATIVE_AUTOFILL_LOCAL_PROVIDER_DISCOVERY_FAILED/u);
    assert.match(result.stdout, /NATIVE_AUTOFILL_LOCAL_SMOKE_INCOMPLETE/u);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /secret|password|token|\/Users\//iu);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
