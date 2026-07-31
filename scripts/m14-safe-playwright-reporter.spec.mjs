import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import SafePlaywrightReporter, {
  readSafePlaywrightDiagnostic,
} from "./m14-safe-playwright-reporter.mjs";

test("writes only a validated project, repo-relative static spec file, and line", (t) => {
  const root = mkdtempSync(join(tmpdir(), "m14-safe-reporter-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "apps/menubar-tauri/e2e/synthetic.spec.ts");
  const outputPath = join(root, "diagnostic.json");
  mkdirSync(join(root, "apps/menubar-tauri/e2e"), { recursive: true });
  writeFileSync(file, "line one\nline two\n");
  const reporter = new SafePlaywrightReporter({ root, outputPath });
  const testCase = {
    id: "webkit-synthetic",
    location: { file, line: 2, column: 7 },
    parent: { project: () => ({ name: "webkit" }) },
    expectedStatus: "passed",
    title: "synthetic user title",
  };

  reporter.onTestEnd(testCase, {
    status: "failed",
    error: { message: "private reporter output" },
  });
  reporter.onEnd();

  assert.deepEqual(JSON.parse(readFileSync(outputPath, "utf8")), {
    schema: "m14-playwright-diagnostic-v1",
    failure: {
      project: "webkit",
      file: "apps/menubar-tauri/e2e/synthetic.spec.ts",
      line: 2,
    },
  });
  const source = readFileSync(outputPath, "utf8");
  assert.doesNotMatch(source, /synthetic user title|private reporter output|column/);
});

test("does not write an artifact for expected outcomes", (t) => {
  const root = mkdtempSync(join(tmpdir(), "m14-safe-reporter-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "apps/menubar-tauri/e2e/synthetic.spec.ts");
  const outputPath = join(root, "diagnostic.json");
  mkdirSync(join(root, "apps/menubar-tauri/e2e"), { recursive: true });
  writeFileSync(file, "line one\n");
  const reporter = new SafePlaywrightReporter({ root, outputPath });

  reporter.onTestEnd({
    id: "webkit-synthetic",
    location: { file, line: 1 },
    parent: { project: () => ({ name: "webkit" }) },
    expectedStatus: "passed",
  }, { status: "passed" });
  reporter.onEnd();

  assert.throws(() => readFileSync(outputPath, "utf8"), { code: "ENOENT" });
});

test("does not retain a failed retry that later reaches its expected outcome", (t) => {
  const root = mkdtempSync(join(tmpdir(), "m14-safe-reporter-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "apps/menubar-tauri/e2e/synthetic.spec.ts");
  const outputPath = join(root, "diagnostic.json");
  mkdirSync(join(root, "apps/menubar-tauri/e2e"), { recursive: true });
  writeFileSync(file, "line one\n");
  const reporter = new SafePlaywrightReporter({ root, outputPath });
  const testCase = {
    id: "webkit-synthetic",
    location: { file, line: 1 },
    parent: { project: () => ({ name: "webkit" }) },
    expectedStatus: "passed",
  };

  reporter.onTestEnd(testCase, { status: "failed" });
  reporter.onTestEnd(testCase, { status: "passed" });
  reporter.onEnd();

  assert.throws(() => readFileSync(outputPath, "utf8"), { code: "ENOENT" });
});

test("prints only aggregate final-outcome counts for controller parsing", () => {
  const output = [];
  const reporter = new SafePlaywrightReporter({
    outputPath: null,
    writeSummary: (value) => output.push(value),
  });
  const testCase = (id, expectedStatus = "passed") => ({
    id,
    expectedStatus,
    title: `private title ${id}`,
  });

  reporter.onTestEnd(testCase("retry"), {
    status: "failed",
    error: { message: "private failed attempt" },
  });
  reporter.onTestEnd(testCase("retry"), { status: "passed" });
  reporter.onTestEnd(testCase("passed"), { status: "passed" });
  reporter.onTestEnd(testCase("skipped", "skipped"), { status: "skipped" });
  reporter.onTestEnd(testCase("expected-failure", "failed"), { status: "failed" });
  reporter.onTestEnd(testCase("unexpected"), {
    status: "timedOut",
    error: { message: "private timeout" },
  });
  reporter.onEnd({ status: "failed" });

  assert.deepEqual(output, ["3 passed, 1 skipped, 1 failed\n"]);
  assert.doesNotMatch(output.join(""), /private|retry|timeout|title/);
});

test("rejects an absolute artifact path even when it resolves inside the repository", (t) => {
  const root = mkdtempSync(join(tmpdir(), "m14-safe-reporter-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "apps/menubar-tauri/e2e/synthetic.spec.ts");
  const outputPath = join(root, "diagnostic.json");
  mkdirSync(join(root, "apps/menubar-tauri/e2e"), { recursive: true });
  writeFileSync(file, "line one\n");
  writeFileSync(outputPath, JSON.stringify({
    schema: "m14-playwright-diagnostic-v1",
    failure: { project: "webkit", file, line: 1 },
  }));

  assert.throws(
    () => readSafePlaywrightDiagnostic(outputPath, root),
    /spec file|diagnostic/i,
  );
});
