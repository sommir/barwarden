import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import * as artifactGenerator from "./generate-third-party-notices.mjs";
import {
  generateThirdPartyNotices,
  synchronizeNoticeFile,
} from "./generate-third-party-notices.mjs";

const npmLock = {
  packages: {
    "": { name: "fixture", version: "0.0.0", license: "GPL-3.0-only" },
    "node_modules/zeta": { version: "3.0.0", license: "MIT" },
    "node_modules/@scope/alpha": { version: "1.0.0", license: "Apache-2.0" },
    "node_modules/parent/node_modules/alpha": { version: "2.0.0", license: "BSD-3-Clause" },
    "node_modules/dev-only": { version: "4.0.0", license: "MIT", dev: true },
    "node_modules/linux-only": {
      version: "5.0.0",
      license: "MIT",
      os: ["linux"],
    },
  },
};

const cargoMetadata = {
  workspace_members: ["path+file:///fixture#fixture@0.0.0"],
  packages: [
    {
      id: "path+file:///fixture#fixture@0.0.0",
      name: "fixture",
      version: "0.0.0",
      license: "GPL-3.0-only",
      license_file: null,
      manifest_path: "/fixture/Cargo.toml",
    },
    {
      id: "registry+https://example.invalid#index#beta@2.0.0",
      name: "beta",
      version: "2.0.0",
      license: "Apache-2.0",
      license_file: null,
      manifest_path: "/fixture/beta/Cargo.toml",
    },
    {
      id: "registry+https://example.invalid#index#unused@9.0.0",
      name: "unused",
      version: "9.0.0",
      license: "MIT",
      license_file: null,
      manifest_path: "/fixture/unused/Cargo.toml",
    },
    {
      id: "registry+https://example.invalid#index#other-platform@3.0.0",
      name: "other-platform",
      version: "3.0.0",
      license: "MIT",
      license_file: null,
      manifest_path: "/fixture/other-platform/Cargo.toml",
    },
  ],
  resolve: {
    nodes: [
      { id: "path+file:///fixture#fixture@0.0.0" },
      { id: "registry+https://example.invalid#index#beta@2.0.0" },
      { id: "registry+https://example.invalid#index#other-platform@3.0.0" },
    ],
  },
};

const cargoTree = `fixture v0.0.0 (/fixture)
beta v2.0.0
beta v2.0.0 (*)
`;

test("generates a sorted inventory from locked npm and resolved Cargo packages", () => {
  const output = generateThirdPartyNotices({ npmLock, cargoMetadata, cargoTree });

  assert.match(output, /\| npm \| @scope\/alpha \| 1\.0\.0 \| Apache-2\.0 \|/);
  assert.match(output, /\| npm \| alpha \| 2\.0\.0 \| BSD-3-Clause \|/);
  assert.match(output, /\| npm \| zeta \| 3\.0\.0 \| MIT \|/);
  assert.match(output, /\| cargo \| beta \| 2\.0\.0 \| Apache-2\.0 \|/);
  assert.doesNotMatch(output, /\| npm \| dev-only \|/);
  assert.doesNotMatch(output, /\| npm \| linux-only \|/);
  assert.doesNotMatch(output, /\| cargo \| fixture \|/);
  assert.doesNotMatch(output, /\| cargo \| other-platform \|/);
  assert.doesNotMatch(output, /\| cargo \| unused \|/);
  assert.ok(output.indexOf("| npm | @scope/alpha") < output.indexOf("| npm | alpha"));
});

test("fails when a locked package has no license metadata", () => {
  const invalidNpmLock = structuredClone(npmLock);
  delete invalidNpmLock.packages["node_modules/zeta"].license;

  assert.throws(
    () => generateThirdPartyNotices({ npmLock: invalidNpmLock, cargoMetadata, cargoTree }),
    /npm package zeta@3\.0\.0 is missing license metadata/,
  );
});

test("uses a license-file reference when a resolved crate has no SPDX expression", () => {
  const metadata = structuredClone(cargoMetadata);
  metadata.packages[1].license = null;
  metadata.packages[1].license_file = "LICENSE.md";

  const output = generateThirdPartyNotices({
    npmLock,
    cargoMetadata: metadata,
    cargoTree,
  });

  assert.match(output, /\| cargo \| beta \| 2\.0\.0 \| LicenseRef-File \(LICENSE\.md\) \|/);
});

test("writes generated content and rejects stale content in check mode", () => {
  const root = mkdtempSync(join(tmpdir(), "barwarden-notices-"));
  const outputPath = join(root, "THIRD_PARTY_NOTICES.md");

  try {
    assert.equal(synchronizeNoticeFile(outputPath, "current\n", false), "written");
    assert.equal(readFileSync(outputPath, "utf8"), "current\n");
    assert.equal(synchronizeNoticeFile(outputPath, "current\n", true), "current");

    writeFileSync(outputPath, "stale\n");
    assert.throws(
      () => synchronizeNoticeFile(outputPath, "current\n", true),
      /THIRD_PARTY_NOTICES\.md is out of date/,
    );
    assert.equal(readFileSync(outputPath, "utf8"), "stale\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("deduplicates legal document bodies while preserving package mappings", () => {
  const root = mkdtempSync(join(tmpdir(), "barwarden-license-documents-"));
  const alphaDirectory = join(root, "alpha");
  const betaDirectory = join(root, "beta");

  try {
    mkdirSync(alphaDirectory);
    mkdirSync(betaDirectory);
    writeFileSync(join(alphaDirectory, "LICENSE"), "Shared license   \r\nSecond line\r\n");
    writeFileSync(join(alphaDirectory, "NOTICE.txt"), "Alpha notice\n");
    writeFileSync(join(betaDirectory, "LICENSE_MIT"), "Shared license\nSecond line\n");

    const generateArtifacts =
      artifactGenerator.generateThirdPartyArtifacts ??
      (() => ({
        componentsJson: '{"components":[]}\n',
        licensesText: "",
        noticesMarkdown: "",
      }));
    const artifacts = generateArtifacts({
      packages: [
        {
          ecosystem: "npm",
          name: "alpha",
          version: "1.0.0",
          license: "MIT",
          sourceDirectory: alphaDirectory,
        },
        {
          ecosystem: "cargo",
          name: "beta",
          version: "2.0.0",
          license: "MIT",
          sourceDirectory: betaDirectory,
        },
      ],
      overrides: [],
    });
    const manifest = JSON.parse(artifacts.componentsJson);

    assert.equal(manifest.components.length, 2);
    assert.equal(manifest.components[0].documents[0], manifest.components[1].documents[0]);
    assert.equal(artifacts.licensesText.match(/Shared license/gu)?.length, 1);
    assert.match(artifacts.licensesText, /Alpha notice/);
    assert.doesNotMatch(artifacts.componentsJson, new RegExp(root.replaceAll("\\", "\\\\"), "u"));
    assert.doesNotMatch(artifacts.licensesText, new RegExp(root.replaceAll("\\", "\\\\"), "u"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects a runtime package that has no legal document material", () => {
  const root = mkdtempSync(join(tmpdir(), "barwarden-missing-license-"));

  try {
    assert.throws(
      () =>
        artifactGenerator.generateThirdPartyArtifacts({
          packages: [
            {
              ecosystem: "npm",
              name: "missing",
              version: "1.0.0",
              license: "MIT",
              sourceDirectory: root,
            },
          ],
          overrides: [],
          overrideRoot: root,
        }),
      /npm package missing@1\.0\.0 has no retained legal documents/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("uses only an exact-version legal document override", () => {
  const root = mkdtempSync(join(tmpdir(), "barwarden-license-override-"));
  const packageDirectory = join(root, "package");
  const overrideDirectory = join(root, "override");

  try {
    mkdirSync(packageDirectory);
    mkdirSync(overrideDirectory);
    writeFileSync(join(overrideDirectory, "LICENSE"), "Version-locked license\n");
    const overrides = [
      {
        packages: [
          {
            ecosystem: "npm",
            name: "missing",
            versions: ["1.0.0"],
          },
        ],
        source: "https://example.invalid/missing/v1.0.0/LICENSE",
        documents: ["override/LICENSE"],
      },
    ];
    const packageRecord = {
      ecosystem: "npm",
      name: "missing",
      version: "1.0.0",
      license: "MIT",
      sourceDirectory: packageDirectory,
    };

    const artifacts = artifactGenerator.generateThirdPartyArtifacts({
      packages: [packageRecord],
      overrides,
      overrideRoot: root,
    });
    assert.match(artifacts.licensesText, /Version-locked license/);

    assert.throws(
      () =>
        artifactGenerator.generateThirdPartyArtifacts({
          packages: [{ ...packageRecord, version: "2.0.0" }],
          overrides,
          overrideRoot: root,
        }),
      /npm package missing@2\.0\.0 has no retained legal documents/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("writes and checks all generated disclosure artifacts", () => {
  const root = mkdtempSync(join(tmpdir(), "barwarden-license-artifacts-"));
  const artifacts = {
    noticesMarkdown: "notices\n",
    componentsJson: '{"schemaVersion":1}\n',
    licensesText: "licenses\n",
  };
  const synchronizeArtifacts =
    artifactGenerator.synchronizeArtifactFiles ?? (() => []);

  try {
    assert.deepEqual(synchronizeArtifacts(artifacts, { root, checkOnly: false }), [
      "THIRD_PARTY_COMPONENTS.json",
      "THIRD_PARTY_LICENSES.txt",
      "THIRD_PARTY_NOTICES.md",
    ]);
    assert.equal(readFileSync(join(root, "THIRD_PARTY_NOTICES.md"), "utf8"), "notices\n");
    assert.equal(
      readFileSync(join(root, "THIRD_PARTY_COMPONENTS.json"), "utf8"),
      '{"schemaVersion":1}\n',
    );
    assert.equal(
      readFileSync(join(root, "THIRD_PARTY_LICENSES.txt"), "utf8"),
      "licenses\n",
    );
    assert.deepEqual(synchronizeArtifacts(artifacts, { root, checkOnly: true }), [
      "THIRD_PARTY_COMPONENTS.json",
      "THIRD_PARTY_LICENSES.txt",
      "THIRD_PARTY_NOTICES.md",
    ]);

    writeFileSync(join(root, "THIRD_PARTY_LICENSES.txt"), "stale\n");
    assert.throws(
      () => synchronizeArtifacts(artifacts, { root, checkOnly: true }),
      /THIRD_PARTY_LICENSES\.txt is out of date/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
