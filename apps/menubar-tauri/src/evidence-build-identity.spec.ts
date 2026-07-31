import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertEvidenceBuildIdentityUnchanged,
  computeEvidenceSetSha256,
  deriveChromiumRuntimeRoot,
  sha256ChromiumRuntimeTree,
  sha256DirectoryTree,
  type EvidenceBuildIdentity,
} from "../e2e/evidence-build-identity";
import { replaceEvidenceDirectoryTransactionally } from "../e2e/evidence-directory-transaction";

describe("M12 evidence build identity", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("hashes a production artifact tree deterministically and includes paths and bytes", () => {
    const left = createTree([
      ["assets/app.js", "application"],
      ["index.html", "document"],
    ]);
    const right = createTree([
      ["index.html", "document"],
      ["assets/app.js", "application"],
    ]);

    expect(sha256DirectoryTree(left)).toBe(sha256DirectoryTree(right));

    writeFileSync(join(right, "assets/app.js"), "changed application");
    expect(sha256DirectoryTree(left)).not.toBe(sha256DirectoryTree(right));

    writeFileSync(join(right, "assets/app.js"), "application");
    mkdirSync(join(right, "renamed"));
    writeFileSync(join(right, "renamed/app.js"), "application");
    rmSync(join(right, "assets/app.js"));
    expect(sha256DirectoryTree(left)).not.toBe(sha256DirectoryTree(right));
  });

  it("binds authority hashes to the complete production and browser runtime identity", () => {
    const identity = fixtureIdentity();
    const authorities = [
      { fileName: "send-view.png", sha256: "a".repeat(64) },
      { fileName: "send-list.png", sha256: "b".repeat(64) },
    ];
    const digest = computeEvidenceSetSha256(identity, authorities);

    expect(computeEvidenceSetSha256(identity, [...authorities].reverse())).toBe(digest);
    expect(computeEvidenceSetSha256({
      ...identity,
      runtimeIdentitySha256: "c".repeat(64),
    }, authorities)).not.toBe(digest);
    expect(computeEvidenceSetSha256(identity, [{
      ...authorities[0]!,
      sha256: "d".repeat(64),
    }, authorities[1]!])).not.toBe(digest);
  });

  it("derives the complete Chromium runtime root across supported platforms", () => {
    expect(deriveChromiumRuntimeRoot(
      "/cache/chromium-1181/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
      "darwin",
      "139.0.7258.5",
    )).toBe("/cache/chromium-1181/chrome-mac/Chromium.app/Contents/Frameworks/Chromium Framework.framework/Versions/139.0.7258.5");
    expect(deriveChromiumRuntimeRoot("/cache/chromium-1181/chrome-linux/chrome", "linux", "139.0.7258.5"))
      .toBe("/cache/chromium-1181/chrome-linux");
    expect(deriveChromiumRuntimeRoot("C:\\cache\\chromium-1181\\chrome-win\\chrome.exe", "win32", "139.0.7258.5"))
      .toBe("C:\\cache\\chromium-1181\\chrome-win");
  });

  it("rejects identity drift immediately before canonical evidence install", () => {
    const before = fixtureIdentity();
    expect(() => assertEvidenceBuildIdentityUnchanged(before, { ...before })).not.toThrow();
    expect(() => assertEvidenceBuildIdentityUnchanged(before, {
      ...before,
      productionBundleTreeSha256: "f".repeat(64),
    })).toThrow(/identity changed.*productionBundleTreeSha256/i);

    const authority = createTree([["PROVENANCE.md", "old authority"]]);
    expect(() => replaceEvidenceDirectoryTransactionally(
      authority,
      (stage) => writeFileSync(join(stage, "PROVENANCE.md"), "new authority"),
      () => assertEvidenceBuildIdentityUnchanged(before, {
        ...before,
        authorityBrowserRuntimeTreeSha256: "e".repeat(64),
      }),
    )).toThrow(/identity changed.*authorityBrowserRuntimeTreeSha256/i);
    expect(readFileSync(join(authority, "PROVENANCE.md"), "utf8")).toBe("old authority");
  });

  it("changes the Chromium runtime tree digest when any runtime file changes", () => {
    const installation = createTree([
      ["chrome-linux/chrome", "launcher"],
      ["chrome-linux/resources.pak", "runtime resources"],
      ["chrome-linux/locales/en-US.pak", "locale"],
    ]);
    const executable = join(installation, "chrome-linux/chrome");
    const initial = sha256ChromiumRuntimeTree(executable, "linux", "139.0.7258.5");
    writeFileSync(join(installation, "chrome-linux/resources.pak"), "mutated runtime resources");
    expect(sha256ChromiumRuntimeTree(executable, "linux", "139.0.7258.5")).not.toBe(initial);
  });

  it("rejects symbolic links in a hashed runtime tree", () => {
    const tree = createTree([["runtime/chrome", "browser"]]);
    symlinkSync("chrome", join(tree, "runtime/chrome-link"));
    expect(() => sha256ChromiumRuntimeTree(
      join(tree, "runtime/chrome"),
      "linux",
      "139.0.7258.5",
    )).toThrow(/symbolic link/i);
  });

  it("keeps final runtime results controller-owned and guards root build inputs", () => {
    const workflow = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/e2e/official-send-workflows.spec.ts"),
      "utf8",
    );
    expect(workflow).not.toContain("runtimeResultPath");
    expect(workflow).not.toContain("buildRuntimeResult");
    expect(workflow).not.toContain("Chromium read-only | passed");
    expect(workflow).not.toContain("WebKit | passed");
    expect(workflow.match(/"postcss\.config\.cjs"/g)).toHaveLength(2);
    expect(workflow.match(/"tailwind\.config\.cjs"/g)).toHaveLength(2);
    expect(workflow).toContain("assertEvidenceBuildIdentityUnchanged");
    expect(workflow).toContain("Chromium runtime tree SHA-256");
    expect(workflow).toMatch(
      /assertCleanEvidenceWriterTree\([\s\S]+const finalIdentity = collectEvidenceBuildIdentity\([\s\S]+assertEvidenceBuildIdentityUnchanged\(buildIdentity, finalIdentity\)/,
    );
  });

  function createTree(files: readonly (readonly [string, string])[]): string {
    const directory = mkdtempSync(join(tmpdir(), "m12-build-identity-"));
    temporaryDirectories.push(directory);
    for (const [relativePath, contents] of files) {
      const parent = join(directory, relativePath, "..");
      mkdirSync(parent, { recursive: true });
      writeFileSync(join(directory, relativePath), contents);
    }
    return directory;
  }
});

function fixtureIdentity(): EvidenceBuildIdentity {
  return {
    productionBundleTreeSha256: "1".repeat(64),
    packageLockSha256: "2".repeat(64),
    playwrightVersion: "1.54.2",
    nodeVersion: "v22.19.0",
    platform: "darwin",
    architecture: "arm64",
    authorityBrowserName: "Chromium",
    authorityBrowserVersion: "139.0.7258.5",
    authorityBrowserExecutableSha256: "3".repeat(64),
    authorityBrowserRuntimeTreeSha256: "5".repeat(64),
    runtimeIdentitySha256: "4".repeat(64),
  };
}
