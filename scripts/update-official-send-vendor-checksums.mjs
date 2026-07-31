import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const vendorRoot = resolve(root, "vendor/bitwarden-clients");
const manifestPath = resolve(vendorRoot, "UI_SOURCE_SHA256SUMS");
const sendUiPrefix = "libs/tools/send/send-ui/";

const retainedLines = readFileSync(manifestPath, "utf8")
  .trimEnd()
  .split("\n")
  .filter((line) => !line.slice(66).startsWith(sendUiPrefix));
const sendUiLines = filesBelow(resolve(vendorRoot, sendUiPrefix))
  .map((path) => {
    const source = readFileSync(path);
    const hash = createHash("sha256").update(source).digest("hex");
    return { hash, path: relative(vendorRoot, path) };
  })
  .sort((left, right) => left.path.localeCompare(right.path))
  .map(({ hash, path }) => `${hash}  ${path}`);

writeFileSync(manifestPath, `${[...retainedLines, ...sendUiLines].join("\n")}\n`);

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}
