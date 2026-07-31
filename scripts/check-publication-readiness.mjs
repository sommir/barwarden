import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_DISCLOSURES = [
  "LICENSE",
  "NOTICE.md",
  "PRIVACY.md",
  "THIRD_PARTY_LICENSES.txt",
  "THIRD_PARTY_NOTICES.md",
];

const EXCLUDED_DIRECTORY_NAMES = new Set([
  ".git",
  ".agents",
  ".superpowers",
  ".worktrees",
  "logs",
  "node_modules",
  "output",
  "target",
  "test-results",
  "dist",
]);

const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024;
const PROHIBITED_LEGACY_KEYWORD = ["wha", "le"].join("");
const CREDENTIAL_FILE_SUFFIXES = [
  ".cer",
  ".crt",
  ".key",
  ".mobileprovision",
  ".p12",
  ".p8",
  ".pem",
  ".pfx",
];

function normalizeRelativePath(path) {
  return path.split("\\").join("/");
}

function isExcludedDirectory(relativePath, name) {
  if (EXCLUDED_DIRECTORY_NAMES.has(name)) {
    return true;
  }

  return (
    relativePath === "docs/superpowers" ||
    relativePath.startsWith("docs/superpowers/")
  );
}

function collectFiles(root, currentDirectory = root, files = []) {
  for (const entry of readdirSync(currentDirectory, { withFileTypes: true })) {
    const absolutePath = resolve(currentDirectory, entry.name);
    const relativePath = normalizeRelativePath(relative(root, absolutePath));

    if (entry.isDirectory()) {
      if (!isExcludedDirectory(relativePath, entry.name)) {
        collectFiles(root, absolutePath, files);
      }
      continue;
    }

    if (entry.isFile() && !lstatSync(absolutePath).isSymbolicLink()) {
      files.push({ absolutePath, relativePath });
    }
  }

  return files;
}

function readTextFile(path) {
  if (statSync(path).size > MAX_TEXT_FILE_BYTES) {
    return null;
  }

  const contents = readFileSync(path);
  if (contents.includes(0)) {
    return null;
  }

  return contents.toString("utf8");
}

function hasSuperpowersIgnoreRule(root) {
  const ignorePath = resolve(root, ".gitignore");
  if (!existsSync(ignorePath)) {
    return false;
  }

  return readFileSync(ignorePath, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .some((line) => line === "docs/superpowers/" || line === "/docs/superpowers/");
}

export function checkPublicationReadiness(root) {
  const resolvedRoot = resolve(root);
  const errors = [];

  if (!hasSuperpowersIgnoreRule(resolvedRoot)) {
    errors.push(".gitignore: must ignore docs/superpowers/");
  }

  for (const requiredPath of REQUIRED_DISCLOSURES) {
    if (!existsSync(resolve(resolvedRoot, requiredPath))) {
      errors.push(`${requiredPath}: required public disclosure is missing`);
    }
  }

  const files = collectFiles(resolvedRoot);
  for (const { absolutePath, relativePath } of files) {
    const lowerRelativePath = relativePath.toLocaleLowerCase("en");
    if (CREDENTIAL_FILE_SUFFIXES.some((suffix) => lowerRelativePath.endsWith(suffix))) {
      errors.push(`${relativePath}: credential files must not be published`);
    }

    const contents = readTextFile(absolutePath);
    if (contents === null) {
      continue;
    }

    if (/\/Users\/[^/\s"'`]+(?:\/|$)/u.test(contents)) {
      errors.push(`${relativePath}: contains a macOS home-directory path`);
    }

    if (/-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/u.test(contents)) {
      errors.push(`${relativePath}: contains a private-key header`);
    }

    if (contents.toLocaleLowerCase("en").includes(PROHIBITED_LEGACY_KEYWORD)) {
      errors.push(`${relativePath}: contains a prohibited legacy keyword`);
    }
  }

  return {
    errors: errors.sort((left, right) => left.localeCompare(right, "en")),
    scannedFiles: files.length,
  };
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  const result = checkPublicationReadiness(process.cwd());
  if (result.errors.length > 0) {
    console.error("Publication readiness check failed:");
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`Publication readiness check passed (${result.scannedFiles} files scanned).`);
  }
}
