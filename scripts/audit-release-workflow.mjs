import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RELEASE_SECRET_NAMES = [
  "BARWARDEN_UPDATER_PUBKEY",
  "TAURI_SIGNING_PRIVATE_KEY",
  "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
  "APPLE_CERTIFICATE",
  "APPLE_CERTIFICATE_PASSWORD",
  "APPLE_API_ISSUER",
  "APPLE_API_KEY",
  "APPLE_API_KEY_BASE64",
];
const REQUIRED_XCODE_DIR = "/Applications/Xcode_16.4.app/Contents/Developer";

function extractTopLevelBlock(source, key) {
  const lines = source.split(/\r?\n/u);
  const start = lines.findIndex((line) => line === `${key}:`);
  if (start < 0) return "";

  let end = start + 1;
  while (end < lines.length && (lines[end].startsWith(" ") || lines[end] === "")) {
    end += 1;
  }
  return lines.slice(start, end).join("\n");
}

function extractJob(source, jobName) {
  const jobsBlock = extractTopLevelBlock(source, "jobs");
  if (!jobsBlock) return "";
  const lines = jobsBlock.split("\n");
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  if (start < 0) return "";

  let end = start + 1;
  while (end < lines.length && !/^  [A-Za-z0-9_-]+:\s*(?:#.*)?$/u.test(lines[end])) {
    end += 1;
  }
  return lines.slice(start, end).join("\n");
}

function stepNameAtLine(lines, lineIndex) {
  let stepName = null;
  for (let index = 0; index <= lineIndex; index += 1) {
    const stepStart = lines[index].match(/^      - (?:name|uses|run):\s*(.*)$/u);
    if (!stepStart) continue;
    const namedStep = lines[index].match(/^      - name:\s*(.*?)\s*$/u);
    stepName = namedStep ? namedStep[1] : null;
  }
  return stepName;
}

function extractNamedStep(jobSource, stepName) {
  const lines = jobSource.split(/\r?\n/u);
  const start = lines.findIndex((line) => line === `      - name: ${stepName}`);
  if (start < 0) return "";

  let end = start + 1;
  while (end < lines.length && !/^      - (?:name|uses|run):/u.test(lines[end])) {
    end += 1;
  }
  return lines.slice(start, end).join("\n");
}

export function auditReleaseWorkflow(source) {
  const errors = [];
  const permissionsBlock = extractTopLevelBlock(source, "permissions");
  if (!/^  contents:\s*read\s*$/mu.test(permissionsBlock)) {
    errors.push("workflow permissions must set contents to read");
  }

  const verifyJob = extractJob(source, "verify");
  if (!verifyJob) {
    errors.push("verify job is required");
  } else {
    if (verifyJob.includes("secrets.")) {
      errors.push("verify job must not reference repository secrets");
    }
    if (/^      contents:\s*write\s*$/mu.test(verifyJob)) {
      errors.push("verify job must not receive contents write permission");
    }
    if (!verifyJob.includes(`DEVELOPER_DIR: ${REQUIRED_XCODE_DIR}`)) {
      errors.push("verify job must select the supported Xcode toolchain");
    }
    if (!verifyJob.includes("scripts/build-native-autofill.sh")) {
      errors.push("verify job must compile the unsigned native AutoFill components");
    }
  }

  const releaseJob = extractJob(source, "release");
  if (!releaseJob) {
    errors.push("release job is required");
  } else {
    if (!/^    needs:\s*verify\s*$/mu.test(releaseJob)) {
      errors.push("release job must depend on verify");
    }
    if (!/^    environment:\s*release\s*$/mu.test(releaseJob)) {
      errors.push("release job must use the release environment");
    }
    if (!/^      contents:\s*write\s*$/mu.test(releaseJob)) {
      errors.push("release job must receive contents write permission");
    }
  }

  for (const match of source.matchAll(/uses:\s*([^@\s]+)@([^\s#]+)/gu)) {
    const [, action, reference] = match;
    if (!/^[0-9a-f]{40}$/u.test(reference)) {
      errors.push(`${action} must use a full commit SHA`);
    }
  }

  const releaseLines = releaseJob.split(/\r?\n/u);
  for (const secretName of RELEASE_SECRET_NAMES) {
    let occurrenceCount = 0;
    for (let index = 0; index < releaseLines.length; index += 1) {
      const line = releaseLines[index];
      if (!line.includes(`secrets.${secretName}`)) continue;
      occurrenceCount += 1;
      if (stepNameAtLine(releaseLines, index) !== "Build signed update artifacts") {
        errors.push(
          `${secretName} must be scoped to the Build signed update artifacts step`,
        );
      }
    }
    if (occurrenceCount === 0) {
      errors.push(`${secretName} must be provided to the signed build step`);
    }
  }

  const signedBuildStep = extractNamedStep(releaseJob, "Build signed update artifacts");
  if (!signedBuildStep.includes("codesign --verify")) {
    errors.push("release build must verify Developer ID signing");
  }
  if (!signedBuildStep.includes("xcrun stapler validate")) {
    errors.push("release build must validate the stapled notarization ticket");
  }
  if (!signedBuildStep.includes("spctl -a")) {
    errors.push("release build must pass Gatekeeper assessment");
  }
  const gatekeeperLines = signedBuildStep
    .split(/\r?\n/u)
    .filter((line) => line.includes("spctl -a"));
  if (gatekeeperLines.some((line) => !line.includes(">/dev/null 2>&1"))) {
    errors.push("Gatekeeper verification output must be suppressed");
  }
  if (!signedBuildStep.includes("scripts/build-native-autofill-release.sh")) {
    errors.push("release build must use the complete native AutoFill builder");
  }
  if (!signedBuildStep.includes(`DEVELOPER_DIR: ${REQUIRED_XCODE_DIR}`)) {
    errors.push("release build must select the supported Xcode toolchain");
  }
  if (!signedBuildStep.includes("scripts/download-native-autofill-provider-profile.mjs")) {
    errors.push("release build must download the provider profile ephemerally");
  }
  if (!/scripts\/download-native-autofill-provider-profile\.mjs(?:\s*\\)?\s*"\$provider_profile_path"\s+"\$signer_certificate_path"/u.test(
    signedBuildStep,
  ) || !signedBuildStep.includes(
    'openssl x509 -outform der -out "$signer_certificate_path"',
  )) {
    errors.push("provider profile download must match the signing certificate");
  }
  if (!signedBuildStep.includes(
    'security list-keychains -d user -s "$signing_keychain" "${original_user_keychains[@]}"',
  )) {
    errors.push("release build must add the temporary signing keychain to the user search list");
  }
  if (!signedBuildStep.includes(
    'security list-keychains -d user -s "${original_user_keychains[@]}"',
  )) {
    errors.push("release cleanup must restore the original user keychain search list");
  }
  if (source.includes("NATIVE_AUTOFILL_PROVIDER_PROFILE_BASE64")) {
    errors.push("provider profile must not be stored as a GitHub secret");
  }

  return [...new Set(errors)].sort((left, right) => left.localeCompare(right, "en"));
}

function runCli() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const workflowPath = join(root, ".github/workflows/release.yml");
  const errors = auditReleaseWorkflow(readFileSync(workflowPath, "utf8"));
  if (errors.length > 0) {
    console.error("Release workflow security audit failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log("Release workflow security audit passed.");
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  runCli();
}
