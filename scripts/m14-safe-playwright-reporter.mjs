import {
  existsSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const playwrightDiagnosticEnvironmentName =
  "BARWARDEN_M14_PLAYWRIGHT_DIAGNOSTIC_PATH";

const allowedProjects = new Set([
  "chromium",
  "chromium-read-only",
  "webkit-read-only",
  "webkit",
  "webkit-official",
  "webkit-retained",
]);
const diagnosticSchema = "m14-playwright-diagnostic-v1";
const maxDiagnosticBytes = 4096;
const staticSpecPattern = /^apps\/menubar-tauri\/e2e\/[A-Za-z0-9._/-]+\.spec\.ts$/;

export default class SafePlaywrightReporter {
  constructor(options = {}) {
    this.root = resolve(options.root ?? process.cwd());
    this.outputPath = options.outputPath ?? process.env[playwrightDiagnosticEnvironmentName];
    this.writeSummary = options.writeSummary ?? ((value) => process.stdout.write(value));
    this.failures = new Map();
    this.outcomes = new Map();
  }

  onTestEnd(testCase, result) {
    if (typeof testCase.id === "string") {
      const outcome = result.status === "skipped"
        ? "skipped"
        : result.status === testCase.expectedStatus
          ? "passed"
          : "failed";
      this.outcomes.set(testCase.id, outcome);
    }
    if (!this.outputPath || typeof testCase.id !== "string") return;
    if (result.status === testCase.expectedStatus) {
      this.failures.delete(testCase.id);
      return;
    }
    try {
      const project = testCase.parent?.project?.()?.name;
      const failure = validateFailure(this.root, {
        project,
        file: testCase.location?.file,
        line: testCase.location?.line,
      }, true);
      this.failures.set(testCase.id, failure);
    } catch {
      // Invalid runtime metadata is deliberately omitted rather than reflected.
    }
  }

  onEnd(result) {
    if (this.outputPath && !existsSync(this.outputPath) && this.failures.size > 0) {
      const failure = this.failures.values().next().value;
      writeDiagnostic(this.outputPath, { schema: diagnosticSchema, failure });
    }
    if (result) {
      const counts = { passed: 0, skipped: 0, failed: 0 };
      for (const outcome of this.outcomes.values()) counts[outcome] += 1;
      this.writeSummary(`${counts.passed} passed, ${counts.skipped} skipped, ${counts.failed} failed\n`);
    }
  }
}

export function readSafePlaywrightDiagnostic(path, root, privateInputs = []) {
  if (!existsSync(path)) throw new Error("Playwright diagnostic is missing");
  const source = readFileSync(path, "utf8");
  if (Buffer.byteLength(source) > maxDiagnosticBytes) {
    throw new Error("Playwright diagnostic is oversized");
  }
  assertNoPrivateValues(source, privateInputs);
  let diagnostic;
  try {
    diagnostic = JSON.parse(source);
  } catch {
    throw new Error("Playwright diagnostic is invalid");
  }
  assertExactKeys(diagnostic, ["failure", "schema"]);
  if (diagnostic.schema !== diagnosticSchema) throw new Error("Playwright diagnostic is invalid");
  return validateFailure(resolve(root), diagnostic.failure);
}

function validateFailure(root, failure, allowAbsoluteFile = false) {
  assertExactKeys(failure, ["file", "line", "project"]);
  if (!allowedProjects.has(failure.project)) throw new Error("Playwright project is invalid");
  if (typeof failure.file !== "string" || typeof failure.line !== "number") {
    throw new Error("Playwright location is invalid");
  }
  if (!allowAbsoluteFile && isAbsolute(failure.file)) {
    throw new Error("Playwright spec file is invalid");
  }
  const absoluteFile = isAbsolute(failure.file) ? resolve(failure.file) : resolve(root, failure.file);
  const repoRelative = relative(root, absoluteFile).split(sep).join("/");
  if (
    repoRelative.startsWith("../") ||
    isAbsolute(repoRelative) ||
    !staticSpecPattern.test(repoRelative) ||
    repoRelative.split("/").includes("..") ||
    !existsSync(absoluteFile)
  ) {
    throw new Error("Playwright spec file is invalid");
  }
  const realRelative = relative(realpathSync(root), realpathSync(absoluteFile)).split(sep).join("/");
  if (realRelative !== repoRelative) throw new Error("Playwright spec file is invalid");
  const lineCount = readFileSync(absoluteFile, "utf8").split(/\r?\n/).length;
  if (!Number.isSafeInteger(failure.line) || failure.line < 1 || failure.line > lineCount) {
    throw new Error("Playwright line is invalid");
  }
  return { project: failure.project, file: repoRelative, line: failure.line };
}

function writeDiagnostic(path, diagnostic) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(diagnostic)}\n`, { flag: "wx", mode: 0o600 });
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function assertExactKeys(value, expectedKeys) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Playwright diagnostic is invalid");
  }
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...expectedKeys].sort())) {
    throw new Error("Playwright diagnostic is invalid");
  }
}

function assertNoPrivateValues(source, privateInputs) {
  for (const value of privateInputs) {
    if (typeof value === "string" && value !== "" && source.includes(value)) {
      throw new Error("Playwright diagnostic contains private input");
    }
  }
}
