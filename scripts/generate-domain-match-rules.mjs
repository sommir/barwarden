import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { domainToASCII } from "node:url";

const SOURCE_REVISION = "e1b8015c3b2f0f4f8c18659c2480fc1a22c07b20";
const SOURCE_LICENSE = "MPL-2.0";
const SOURCE_SHA256 = "fe6adc7fb8014f57d28d69b18d0aa3e581efb432544922e12131a5d4a87bd954";

const [sourcePath, outputPath] = process.argv.slice(2);
if (!sourcePath || !outputPath || process.argv.length !== 4) {
  throw new Error("usage: node scripts/generate-domain-match-rules.mjs <public_suffix_list.dat> <output.json>");
}

const sourceBytes = await readFile(sourcePath);
const sourceDigest = createHash("sha256").update(sourceBytes).digest("hex");
if (sourceDigest !== SOURCE_SHA256) {
  throw new Error(`PSL digest does not match pinned revision ${SOURCE_REVISION}`);
}
const source = sourceBytes.toString("utf8");
if (!source.includes("===BEGIN ICANN DOMAINS===") || !source.includes("===BEGIN PRIVATE DOMAINS===")) {
  throw new Error("input is not a complete Public Suffix List");
}

const publicSuffixRules = [];
const exceptionRules = [];
for (const sourceLine of source.split(/\r?\n/u)) {
  const line = sourceLine.trim();
  if (!line || line.startsWith("//")) {
    continue;
  }

  const exception = line.startsWith("!");
  const wildcard = !exception && line.startsWith("*.");
  const rawRule = line.slice(exception ? 1 : wildcard ? 2 : 0);
  const asciiRule = domainToASCII(rawRule).toLowerCase();
  if (!asciiRule || asciiRule.includes("/") || asciiRule.includes(" ")) {
    throw new Error(`invalid PSL rule: ${line}`);
  }

  if (exception) {
    exceptionRules.push(asciiRule);
  } else {
    publicSuffixRules.push(wildcard ? `*.${asciiRule}` : asciiRule);
  }
}

publicSuffixRules.sort();
exceptionRules.sort();
if (publicSuffixRules.length < 9_000 || exceptionRules.length < 1) {
  throw new Error("parsed PSL is unexpectedly incomplete");
}

await writeFile(outputPath, `${JSON.stringify({
  sourceRevision: SOURCE_REVISION,
  license: SOURCE_LICENSE,
  publicSuffixRules,
  exceptionRules,
}, null, 2)}\n`, "utf8");
