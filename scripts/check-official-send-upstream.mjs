import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const vendorRoot = resolve(root, "vendor/bitwarden-clients");
const upstreamRoot = "/tmp/bitwarden-clients-m12";
const pinnedRevision = "f47b6946e01aed474875789081966d311d5b8289";
const sendUiRoot = "libs/tools/send/send-ui";
const checkedSendAuthorities = [
  "../../vendor/bitwarden-clients/libs/tools/send/send-ui/src/send-form/abstractions/send-form-generation.service.ts",
  "official-send-upstream.compatibility.ts",
];
const browserAuthorities = new Map([
  ["apps/browser/src/tools/popup/send-v2/send-v2.component.ts", "84544c71f1eba031a1e1e9867e95836b89f01c9b9fa03f758365394b19834ef3"],
  ["apps/browser/src/tools/popup/send-v2/send-v2.component.html", "43e955124658d0c0b4d7683557ac119950c63df500b854e73da83a022ffb2e82"],
  ["apps/browser/src/tools/popup/send-v2/add-edit/send-add-edit.component.ts", "5da4021ac7001642173b7e7ae8771adf67b8e50590ca7d6c88d720d67f9823de"],
  ["apps/browser/src/tools/popup/send-v2/add-edit/send-add-edit.component.html", "a2730a0d91b19ac28e272471d02c6a1244d1c0bfff2399e3881ba78b63c3f803"],
  ["apps/browser/src/tools/popup/send-v2/send-created/send-created.component.ts", "84f5fa48f78a9b9d52189fb43812ed7bd638f17e9f9f0f77d057a0911e27e5ae"],
  ["apps/browser/src/tools/popup/send-v2/send-created/send-created.component.html", "9770325116224a4b10722b54ceb001ea6e1436223d56ebd527190b1e24eb9e88"],
]);

const revision = readFileSync(resolve(vendorRoot, "UI_SOURCE_COMMIT"), "utf8").trim();
if (revision !== pinnedRevision) {
  throw new Error(`Pinned Bitwarden revision drift: ${revision}`);
}

const manifestEntries = readManifest(resolve(vendorRoot, "UI_SOURCE_SHA256SUMS"));
const sendUiEntries = manifestEntries.filter(({ path }) => path.startsWith(`${sendUiRoot}/`));
const sendUiPaths = sendUiEntries.map(({ path }) => path);
const sortedSendUiPaths = [...sendUiPaths].sort();
const actualSendUiPaths = filesBelow(resolve(vendorRoot, sendUiRoot))
  .map((path) => relative(vendorRoot, path))
  .sort();

if (
  sendUiPaths.length === 0
  || JSON.stringify(sendUiPaths) !== JSON.stringify(sortedSendUiPaths)
  || JSON.stringify(sendUiPaths) !== JSON.stringify(actualSendUiPaths)
) {
  throw new Error("Pinned Send UI manifest does not exactly match the vendored source tree");
}

for (const { path, hash } of sendUiEntries) {
  verifyHash(path, hash);
}
for (const [path, hash] of browserAuthorities) {
  verifyHash(path, hash);
}

if (existsSync(upstreamRoot)) {
  const upstreamRevision = execFileSync("git", ["-C", upstreamRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  if (upstreamRevision !== pinnedRevision) {
    throw new Error(`Temporary Bitwarden checkout drift: ${upstreamRevision}`);
  }
  for (const path of [...sendUiPaths, ...browserAuthorities.keys()]) {
    const vendorBytes = readFileSync(resolve(vendorRoot, path));
    const upstreamBytes = readFileSync(resolve(upstreamRoot, path));
    if (!vendorBytes.equals(upstreamBytes)) {
      throw new Error(`Pinned upstream Send byte drift: ${path}`);
    }
  }
}

const upstreamConfig = JSON.parse(
  readFileSync(resolve(root, "apps/menubar-tauri/tsconfig.official-send-upstream.json"), "utf8"),
);
if (upstreamConfig.extends !== "../../vendor/bitwarden-clients/libs/tools/send/send-ui/tsconfig.json") {
  throw new Error("Upstream Send source check no longer extends the official config");
}
if ("strict" in (upstreamConfig.compilerOptions ?? {})) {
  throw new Error("Upstream Send source check must not relabel the official strict setting");
}
if (upstreamConfig.compilerOptions?.noCheck === true) {
  throw new Error("Upstream Send typecheck must retain semantic source diagnostics");
}
if (JSON.stringify(upstreamConfig.files) !== JSON.stringify(checkedSendAuthorities)) {
  throw new Error("Upstream Send typecheck authority inventory drift");
}

console.log(`Pinned upstream Send source check passed at ${pinnedRevision}`);

function readManifest(path) {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line) => {
      const match = line.match(/^([a-f0-9]{64})  (.+)$/);
      if (!match) throw new Error(`Invalid checksum manifest entry: ${line}`);
      return { hash: match[1], path: match[2] };
    });
}

function verifyHash(path, expected) {
  const actual = createHash("sha256").update(readFileSync(resolve(vendorRoot, path))).digest("hex");
  if (actual !== expected) throw new Error(`Pinned upstream Send source drift: ${path}`);
}

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}
