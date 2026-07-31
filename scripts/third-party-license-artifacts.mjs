import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

function compareText(left, right) {
  const normalizedLeft = left.toLowerCase();
  const normalizedRight = right.toLowerCase();
  if (normalizedLeft < normalizedRight) return -1;
  if (normalizedLeft > normalizedRight) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function escapeMarkdownCell(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function npmPackageName(lockPath) {
  const nestedMarker = "/node_modules/";
  const nestedIndex = lockPath.lastIndexOf(nestedMarker);
  if (nestedIndex >= 0) {
    return lockPath.slice(nestedIndex + nestedMarker.length);
  }

  const rootMarker = "node_modules/";
  if (lockPath.startsWith(rootMarker)) {
    return lockPath.slice(rootMarker.length);
  }

  return lockPath;
}

function supportsPlatform(values, current) {
  if (!Array.isArray(values) || values.length === 0) {
    return true;
  }
  if (values.includes(`!${current}`)) {
    return false;
  }

  const allowed = values.filter((value) => !value.startsWith("!"));
  return allowed.length === 0 || allowed.includes(current);
}

export function selectNpmRuntimePackages(
  npmLock,
  {
    root = process.cwd(),
    platform = "darwin",
    arch = "arm64",
  } = {},
) {
  const rows = [];
  for (const [lockPath, descriptor] of Object.entries(npmLock.packages ?? {})) {
    if (
      lockPath === "" ||
      descriptor.dev === true ||
      !supportsPlatform(descriptor.os, platform) ||
      !supportsPlatform(descriptor.cpu, arch)
    ) {
      continue;
    }

    const name = npmPackageName(lockPath);
    const version = descriptor.version;
    const license = descriptor.license;
    if (!name || !version || typeof license !== "string" || !license.trim()) {
      throw new Error(
        `npm package ${name || lockPath}@${version || "unknown"} is missing license metadata`,
      );
    }

    rows.push({
      ecosystem: "npm",
      name,
      version,
      license: license.trim(),
      sourceDirectory: resolve(root, lockPath),
    });
  }
  return rows;
}

export function parseCargoRuntimeTree(cargoTree) {
  const packages = new Map();
  const lines = cargoTree.split(/\r?\n/u).filter((line) => line.trim());

  for (const line of lines.slice(1)) {
    const normalized = line.replace(/ \(\*\)$/u, "");
    const match = normalized.match(/^(\S+) v(\S+)/u);
    if (!match) {
      throw new Error(`Unable to parse Cargo tree package: ${line}`);
    }
    packages.set(`${match[1]}\0${match[2]}`, {
      name: match[1],
      version: match[2],
    });
  }

  return [...packages.values()];
}

export function selectCargoRuntimePackages(cargoMetadata, cargoTree) {
  const workspaceMembers = new Set(cargoMetadata.workspace_members ?? []);
  const packagesByNameVersion = new Map();
  for (const descriptor of cargoMetadata.packages ?? []) {
    if (workspaceMembers.has(descriptor.id)) {
      continue;
    }
    const key = `${descriptor.name}\0${descriptor.version}`;
    const descriptors = packagesByNameVersion.get(key) ?? [];
    descriptors.push(descriptor);
    packagesByNameVersion.set(key, descriptors);
  }
  const rows = [];

  for (const packageReference of parseCargoRuntimeTree(cargoTree)) {
    const key = `${packageReference.name}\0${packageReference.version}`;
    const descriptors = packagesByNameVersion.get(key) ?? [];
    if (descriptors.length !== 1) {
      throw new Error(
        `Cargo tree package ${packageReference.name}@${packageReference.version} matched ${descriptors.length} metadata packages`,
      );
    }
    const [descriptor] = descriptors;

    let license = typeof descriptor.license === "string" ? descriptor.license.trim() : "";
    if (!license && descriptor.license_file) {
      license = `LicenseRef-File (${basename(descriptor.license_file)})`;
    }
    if (!license) {
      throw new Error(
        `Cargo package ${descriptor.name}@${descriptor.version} is missing license metadata`,
      );
    }

    rows.push({
      ecosystem: "cargo",
      name: descriptor.name,
      version: descriptor.version,
      license,
      sourceDirectory: dirname(descriptor.manifest_path),
      licenseFile: descriptor.license_file,
    });
  }

  return rows;
}

function deduplicateAndSort(rows) {
  const uniqueRows = new Map();
  for (const row of rows) {
    const key = `${row.ecosystem}\0${row.name}\0${row.version}\0${row.license}`;
    uniqueRows.set(key, row);
  }

  return [...uniqueRows.values()].sort(
    (left, right) =>
      compareText(left.name, right.name) ||
      compareText(left.version, right.version) ||
      compareText(left.license, right.license),
  );
}

function renderTable(rows) {
  return [
    "| Ecosystem | Package | Version | License expression or reference |",
    "| --- | --- | --- | --- |",
    ...rows.map(
      (row) =>
        `| ${row.ecosystem} | ${escapeMarkdownCell(row.name)} | ${escapeMarkdownCell(row.version)} | ${escapeMarkdownCell(row.license)} |`,
    ),
  ].join("\n");
}

function normalizeDocumentContents(contents) {
  return `${contents.replace(/\r\n?/gu, "\n").replace(/[ \t]+$/gmu, "").trimEnd()}\n`;
}

function documentId(contents) {
  return `DOC-${createHash("sha256").update(contents, "utf8").digest("hex").slice(0, 12)}`;
}

function packageDisplayName(packageRecord) {
  return `${packageRecord.ecosystem}:${packageRecord.name}@${packageRecord.version}`;
}

function readLegalDocument(path, filename) {
  const contents = normalizeDocumentContents(readFileSync(path, "utf8"));
  return {
    filename,
    contents,
    id: documentId(contents),
  };
}

function packageLegalDocuments(packageRecord, overrides, overrideRoot) {
  const legalFilename = /^(licen[cs]e|copying|notice|copyright)([._-]|$)/iu;
  const documents = readdirSync(packageRecord.sourceDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && legalFilename.test(entry.name))
    .map((entry) =>
      readLegalDocument(join(packageRecord.sourceDirectory, entry.name), entry.name),
    );

  if (packageRecord.licenseFile && existsSync(packageRecord.licenseFile)) {
    documents.push(
      readLegalDocument(packageRecord.licenseFile, basename(packageRecord.licenseFile)),
    );
  }

  for (const override of overrides ?? []) {
    const applies = override.packages?.some(
      (candidate) =>
        candidate.ecosystem === packageRecord.ecosystem &&
        candidate.name === packageRecord.name &&
        candidate.versions?.includes(packageRecord.version),
    );
    if (!applies) {
      continue;
    }
    if (typeof override.source !== "string" || !override.source.startsWith("https://")) {
      throw new Error(
        `${packageDisplayName(packageRecord)} legal override must have an HTTPS source`,
      );
    }
    for (const documentPath of override.documents ?? []) {
      const absolutePath = resolve(overrideRoot, documentPath);
      const relativePath = relative(resolve(overrideRoot), absolutePath);
      if (relativePath.startsWith("..") || relativePath === "") {
        throw new Error(
          `${packageDisplayName(packageRecord)} legal override path is outside its root`,
        );
      }
      if (!existsSync(absolutePath)) {
        throw new Error(
          `${packageDisplayName(packageRecord)} legal override is missing ${documentPath}`,
        );
      }
      documents.push(readLegalDocument(absolutePath, basename(documentPath)));
    }
  }

  const uniqueDocuments = new Map(
    documents.map((document) => [`${document.filename}\0${document.id}`, document]),
  );
  const result = [...uniqueDocuments.values()].sort((left, right) =>
    compareText(left.filename, right.filename),
  );
  if (result.length === 0) {
    throw new Error(
      `${packageRecord.ecosystem} package ${packageRecord.name}@${packageRecord.version} has no retained legal documents`,
    );
  }
  return result;
}

export function generateThirdPartyArtifacts({
  packages,
  overrides = [],
  overrideRoot = process.cwd(),
}) {
  const sortedPackages = [...packages].sort(
    (left, right) =>
      compareText(left.ecosystem, right.ecosystem) ||
      compareText(left.name, right.name) ||
      compareText(left.version, right.version),
  );
  const documentsById = new Map();
  const components = sortedPackages.map((packageRecord) => {
    const documents = packageLegalDocuments(packageRecord, overrides, overrideRoot);
    for (const document of documents) {
      const retained = documentsById.get(document.id) ?? {
        ...document,
        packages: [],
      };
      retained.packages.push(packageDisplayName(packageRecord));
      documentsById.set(document.id, retained);
    }
    return {
      ecosystem: packageRecord.ecosystem,
      name: packageRecord.name,
      version: packageRecord.version,
      license: packageRecord.license,
      documents: documents.map((document) => document.id),
    };
  });
  const counts = {
    npm: components.filter((component) => component.ecosystem === "npm").length,
    cargo: components.filter((component) => component.ecosystem === "cargo").length,
    total: components.length,
  };
  const licenseCounts = new Map();
  for (const component of components) {
    licenseCounts.set(component.license, (licenseCounts.get(component.license) ?? 0) + 1);
  }
  const licenseGroups = [...licenseCounts.entries()]
    .map(([expression, count]) => ({ expression, count }))
    .sort(
      (left, right) =>
        right.count - left.count || compareText(left.expression, right.expression),
    );
  const manifest = {
    schemaVersion: 1,
    target: "aarch64-apple-darwin",
    counts,
    licenseGroups,
    components,
  };
  const documentSections = [...documentsById.values()]
    .sort((left, right) => compareText(left.id, right.id))
    .map(
      (document) => `${"=".repeat(80)}
${document.id} — ${document.filename}
Applies to:
${document.packages.sort(compareText).map((name) => `- ${name}`).join("\n")}
${"-".repeat(80)}
${document.contents}`,
    )
    .join("\n");
  const packageIndex = components
    .map(
      (component) =>
        `${packageDisplayName(component)} | ${component.license} | ${component.documents.join(", ")}`,
    )
    .join("\n");
  const noticesMarkdown = `# Third-Party Open-Source Notices

This disclosure covers runtime components distributed in the Barwarden macOS
application. Development, test, build-only, procedural-macro, and
other-platform dependencies are excluded.

- npm runtime components: ${counts.npm}
- Cargo runtime components: ${counts.cargo}
- Total runtime components: ${counts.total}

Complete package mappings and retained legal texts are provided in
\`THIRD_PARTY_LICENSES.txt\`.
`;
  const licensesText = `THIRD-PARTY OPEN-SOURCE LICENSES

PACKAGE INDEX
${"=".repeat(80)}
${packageIndex}

LEGAL DOCUMENTS
${"=".repeat(80)}
${documentSections}`;

  return {
    noticesMarkdown,
    componentsJson: `${JSON.stringify(manifest, null, 2)}\n`,
    licensesText,
  };
}

export function generateThirdPartyNotices({ npmLock, cargoMetadata, cargoTree }) {
  const npm = deduplicateAndSort(selectNpmRuntimePackages(npmLock));
  const cargo = deduplicateAndSort(selectCargoRuntimePackages(cargoMetadata, cargoTree));

  return `# Third-Party Dependency Notices

This inventory is generated from \`package-lock.json\` and the resolved
\`Cargo.lock\` graph. Do not edit it manually. Regenerate it with
\`npm run licenses:generate\` and verify it with \`npm run licenses:check\`.

The inventory records declared license metadata for locked dependencies,
including build and development tooling. It is provided for attribution and
review; the dependency distributions and retained source trees contain their
complete license and copyright texts.

## npm dependencies (${npm.length})

${renderTable(npm)}

## Cargo dependencies (${cargo.length})

${renderTable(cargo)}
`;
}

export function synchronizeNoticeFile(outputPath, contents, checkOnly) {
  if (checkOnly) {
    const current = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : null;
    if (current !== contents) {
      throw new Error(`${basename(outputPath)} is out of date; run npm run licenses:generate`);
    }
    return "current";
  }

  writeFileSync(outputPath, contents);
  return "written";
}

export function synchronizeArtifactFiles(artifacts, { root, checkOnly }) {
  const files = [
    ["THIRD_PARTY_COMPONENTS.json", artifacts.componentsJson],
    ["THIRD_PARTY_LICENSES.txt", artifacts.licensesText],
    ["THIRD_PARTY_NOTICES.md", artifacts.noticesMarkdown],
  ];

  for (const [filename, contents] of files) {
    const outputPath = join(root, filename);
    if (checkOnly) {
      const current = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : null;
      if (current !== contents) {
        throw new Error(`${filename} is out of date; run npm run licenses:generate`);
      }
    } else {
      writeFileSync(outputPath, contents);
    }
  }

  return files.map(([filename]) => filename);
}
