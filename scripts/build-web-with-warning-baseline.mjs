import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const baselinePath = resolve(root, "apps/menubar-tauri/build-web-warning-baseline.txt");
const vitePath = resolve(root, "node_modules/vite/bin/vite.js");
const build = spawnSync(
  process.execPath,
  [vitePath, "build", "--config", "apps/menubar-tauri/vite.config.ts"],
  { cwd: root, encoding: "utf8", env: process.env },
);
const rawOutput = `${build.stdout ?? ""}${build.stderr ?? ""}`;
process.stdout.write(rawOutput);
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

const actual = warningBaseline(rawOutput);
const expected = readFileSync(baselinePath, "utf8").trimEnd();
if (actual !== expected) {
  process.stderr.write("\nBuild warning baseline changed.\n\nExpected:\n");
  process.stderr.write(`${expected}\n\nActual:\n${actual}\n`);
  process.exit(1);
}

function warningBaseline(output) {
  const normalized = output
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\r/g, "")
    .replaceAll(root, "<ROOT>");
  const warnings = normalized.split("\n")
    .map((line) => line.replace(/^\s+|\s+$/g, ""))
    .filter((line) =>
      line.includes("externalized for browser compatibility")
      || line.includes("Unknown at rule:")
      || line.includes("Some chunks are larger than")
      || /\bNG\d{4,}\b/.test(line),
    )
    .map((line) => line.replace(/^\(!\)\s*/, ""));
  const counts = new Map();
  for (const warning of warnings) counts.set(warning, (counts.get(warning) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([warning, count]) => `${count} ${warning}`)
    .join("\n");
}
