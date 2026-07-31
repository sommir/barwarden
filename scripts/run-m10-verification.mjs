#!/usr/bin/env node

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  extractVerificationFailure,
  extractVerificationSummary,
  stripAnsi,
} from "./verification-summary.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultOutput = resolve(
  root,
  "docs/superpowers/specs/2026-07-18-m10-machine-verification.json",
);
const gates = [
  gate("vitest", "npm", ["test"]),
  playwrightGate("recovery-chromium-writer", "true", "chromium"),
  playwrightGate("recovery-chromium-read-only", "false", "chromium"),
  playwrightGate("recovery-webkit-read-only", "false", "webkit"),
  gate("playwright-full-read-only", "caffeinate", [
    "-dimsu", "npx", "playwright", "test", "--workers=1", "--reporter=line",
  ], { UPDATE_EVIDENCE: "false" }),
  gate("typecheck-official-components", "npm", ["run", "typecheck:official-components"]),
  gate("typecheck-official-login", "npm", ["run", "typecheck:official-login"]),
  gate("typecheck-official-personal", "npm", ["run", "typecheck:official-personal"]),
  gate("typecheck-official-recovery", "npm", ["run", "typecheck:official-recovery"]),
  gate("web-production-build", "npm", ["run", "build:web"]),
  gate("production-bundle-audit-fixtures", "npm", ["run", "test:audit-production-bundle"]),
  gate("production-bundle-audit", "npm", ["run", "audit:production-bundle"]),
  gate("rust-tests", "cargo", [
    "test", "--manifest-path", "apps/menubar-tauri/src-tauri/Cargo.toml",
  ]),
  gate("tauri-release-build", "npm", ["run", "tauri:build"]),
  gate("diff-check", "git", ["diff", "--check"]),
  gate("vendor-unchanged", "git", ["diff", "--exit-code", "--", "vendor/bitwarden-clients"]),
];

function gate(name, command, args, env = {}) {
  return { name, command, args, env };
}

function playwrightGate(name, updateEvidence, project) {
  return gate(name, "caffeinate", [
    "-dimsu",
    "npx",
    "playwright",
    "test",
    "apps/menubar-tauri/e2e/official-recovery-workflows.spec.ts",
    `--project=${project}`,
    "--workers=1",
    "--reporter=line",
  ], { UPDATE_EVIDENCE: updateEvidence });
}

function run() {
  const outputPath = resolve(root, process.argv[2] ?? defaultOutput);
  const sourceCommit = commandOutput("git", ["rev-parse", "HEAD"]);
  const initialStatus = commandOutput("git", ["status", "--porcelain"]);
  if (initialStatus) {
    throw new Error("M10 machine verification requires a clean committed worktree");
  }

  const records = [];
  for (const current of gates) {
    process.stdout.write(`[M10 gate] ${current.name}\n`);
    const started = Date.now();
    const result = spawnSync(current.command, current.args, {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, ...current.env },
      maxBuffer: 512 * 1024 * 1024,
      timeout: 30 * 60 * 1000,
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    const record = {
      name: current.name,
      command: [current.command, ...current.args].join(" "),
      environment: current.env,
      exitCode: result.status,
      signal: result.signal,
      durationMs: Date.now() - started,
      outputSha256: createHash("sha256").update(output).digest("hex"),
      summary: extractVerificationSummary(output),
    };
    records.push(record);
    process.stdout.write(`${JSON.stringify(record)}\n`);
    if (result.error || result.status !== 0) {
      const failure = extractVerificationFailure(output);
      if (failure.length > 0) {
        process.stderr.write(`[M10 failure context]\n${failure.join("\n")}\n`);
      }
      const tail = stripAnsi(output).split(/\r?\n/).slice(-80).join("\n");
      process.stderr.write(`${tail}\n`);
      throw result.error ?? new Error(`M10 gate failed: ${current.name}`);
    }
  }

  const finalStatus = commandOutput("git", ["status", "--porcelain"]);
  if (finalStatus) {
    throw new Error(`M10 verification changed the committed worktree:\n${finalStatus}`);
  }
  const artifact = {
    schemaVersion: 1,
    sourceCommit,
    vendorCommit: commandOutput("git", ["show", "HEAD:vendor/bitwarden-clients/UI_SOURCE_COMMIT"]),
    generatedAt: new Date().toISOString(),
    cleanWorktreeBefore: true,
    cleanWorktreeAfter: true,
    gates: records,
  };
  writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  process.stdout.write(`[M10 artifact] ${outputPath}\n`);
}

function commandOutput(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run();
}
