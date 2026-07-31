import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

import { describe, expect, it, vi } from "vitest";

import { evidenceCapturePath } from "../../../e2e/evidence-path";

function testInfo(projectName: string) {
  return {
    outputPath: (fileName: string) => `/tmp/${projectName}/${fileName}`,
    project: { name: projectName },
  };
}

describe("M2 evidence capture policy", () => {
  it("isolates late WebKit Vault specs without allowing release retries", async () => {
    const { default: config } = await import("../../../../../playwright.config");
    const projects = config.projects ?? [];
    const fixture = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/e2e/isolated-webkit-page.fixture.ts"),
      "utf8",
    );

    for (const project of projects) {
      expect(project.retries ?? 0, project.name).toBe(0);
    }
    expect(config.forbidOnly).toBe(true);
    expect(fixture).toContain('browserName === "webkit"');
    expect(fixture).toContain("webkit.launch({ headless: true })");
    expect(fixture).toContain("closePageContext");
    for (const file of [
      "vault-folders.spec.ts",
      "vault-main.spec.ts",
      "vault-personal-cipher-workflows.spec.ts",
    ]) {
      expect(readFileSync(join(process.cwd(), "apps/menubar-tauri/e2e", file), "utf8"))
        .toContain('from "./isolated-webkit-page.fixture"');
    }
  });

  it("closes an isolated WebKit browser even when its context teardown fails", async () => {
    const { closePageContext } = await import("../../../e2e/isolated-webkit-page.fixture");
    const context = { close: vi.fn(async () => Promise.reject(new Error("context close failed"))) };
    const browser = { close: vi.fn(async () => undefined) };

    await expect(closePageContext(context, browser)).rejects.toThrow("context close failed");
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it("runs aggregate Playwright against one immutable bundle with one worker", () => {
    const playwrightConfig = readFileSync(join(process.cwd(), "playwright.config.ts"), "utf8");
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(playwrightConfig).toMatch(/workers:\s*1,/);
    expect(playwrightConfig).toContain(
      "VITE_BW_VAULT_EVIDENCE=true npm run build:web && VITE_BW_VAULT_EVIDENCE=true npx vite preview --config apps/menubar-tauri/vite.config.ts --host 127.0.0.1 --port 1420 --strictPort",
    );
    expect(playwrightConfig).not.toContain("npm run dev:web");
    expect(packageJson.scripts?.["test:playwright:release"]).toBe(
      "UPDATE_EVIDENCE=false playwright test --reporter=./scripts/m14-safe-playwright-reporter.mjs",
    );
    for (const projectName of [
      "chromium",
      "chromium-read-only",
      "webkit-read-only",
      "webkit",
      "webkit-official",
      "webkit-retained",
    ]) {
      expect(playwrightConfig).toContain(`name: "${projectName}"`);
    }
    expect(playwrightConfig).toContain('"**/m16-release-visual-accessibility.spec.ts"');
  });

  it("permits only Chromium to update authoritative screenshots", () => {
    const authority = "/evidence/vault-light-480x600.png";
    const environment = { UPDATE_EVIDENCE: "true" } as NodeJS.ProcessEnv;

    expect(evidenceCapturePath(testInfo("chromium"), authority, environment)).toBe(authority);
    expect(evidenceCapturePath(testInfo("webkit"), authority, environment)).toBe(
      "/tmp/webkit/vault-light-480x600.png",
    );
  });

  it("exposes one Chromium writer predicate and an edge-constrained pixel comparison", () => {
    const pathSource = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/e2e/evidence-path.ts"),
      "utf8",
    );
    const integritySource = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/e2e/evidence-integrity.ts"),
      "utf8",
    );
    const playwrightConfig = readFileSync(join(process.cwd(), "playwright.config.ts"), "utf8");

    expect(pathSource).toContain("isAuthoritativeEvidenceWriter");
    expect(integritySource).toContain("compareEvidenceScreenshotPixels");
    expect(integritySource).toContain("authority.equals(fresh)");
    expect(integritySource).toContain("differentPixels");
    expect(integritySource).toContain("nonEdgeDifferentPixels");
    expect(integritySource).toContain("isNearImageEdge");
    expect(integritySource).toContain("isNearImageEdge(freshImage.pixels");
    expect(integritySource).toContain("neighborX === x && neighborY === y");
    expect(integritySource).not.toMatch(/mask|alternateHash|threshold\s*=\s*(?:9|[1-9][0-9]+)/i);
    expect(playwrightConfig).toContain("deterministicChromiumLaunchOptions");
    expect(playwrightConfig).toContain('"--disable-gpu"');
    expect(playwrightConfig).toContain('"--disable-font-subpixel-positioning"');
    expect(playwrightConfig).toContain('"--disable-lcd-text"');
    expect(playwrightConfig).toContain('"--disable-skia-runtime-opts"');
    expect(playwrightConfig).toContain('"--run-all-compositor-stages-before-draw"');
  });

  it("selects an immutable copy of fresh canonical evidence bytes", async () => {
    const integrity = await import("../../../e2e/evidence-integrity");
    const bindFresh = (integrity as Record<string, unknown>)[
      "bindFreshCanonicalEvidence"
    ] as ((fresh: Uint8Array, runtimeIdentitySha256: string) => {
      bytes: Buffer;
      runtimeIdentitySha256: string;
    }) | undefined;
    const fresh = Buffer.from("fresh canonical bytes");
    const expected = Buffer.from(fresh);

    expect(bindFresh).toBeTypeOf("function");
    const canonical = bindFresh!(fresh, "1".repeat(64));
    fresh.fill(0);

    expect(canonical.bytes).toEqual(expected);
    expect(canonical.bytes).not.toBe(fresh);
    expect(canonical.runtimeIdentitySha256).toBe("1".repeat(64));
  });

  it("returns the second fresh PNG from an exact consecutive pair", async () => {
    const integrity = await import("../../../e2e/evidence-integrity");
    const captureStable = (integrity as Record<string, unknown>)[
      "captureConsecutiveStableScreenshot"
    ] as ((
      page: { evaluate: () => Promise<void>; screenshot: () => Promise<Buffer> },
      options: Record<string, unknown>,
      maximumCaptures: number,
    ) => Promise<Buffer>) | undefined;
    const first = Buffer.from("first frame");
    const stableFirst = Buffer.from("stable frame");
    const stableSecond = Buffer.from("stable frame");
    const frames = [first, stableFirst, stableSecond];
    const evaluations: string[] = [];
    const page = {
      evaluate: vi.fn().mockImplementation(async (callback: () => unknown) => {
        evaluations.push(callback.toString());
      }),
      screenshot: vi.fn().mockImplementation(async () => frames.shift()!),
    };

    expect(captureStable).toBeTypeOf("function");
    await expect(captureStable!(page, { animations: "disabled" }, 5)).resolves.toEqual(stableSecond);
    expect(page.screenshot).toHaveBeenCalledTimes(3);
    expect(page.evaluate).toHaveBeenCalledTimes(4);
    expect(evaluations[0]).toContain("data-m13-evidence-capture-freeze");
    expect(evaluations[0]).toContain("animation: none !important");
    expect(evaluations[0]).toContain("transition: none !important");
    expect(evaluations[0]).toContain("caret-color: transparent !important");
    expect(evaluations[0]).toContain("document.activeElement");
    expect(evaluations[0]).toContain("activeElement.blur()");
  });

  it("fails closed at the bounded fresh screenshot capture limit", async () => {
    const integrity = await import("../../../e2e/evidence-integrity");
    const captureStable = (integrity as Record<string, unknown>)[
      "captureConsecutiveStableScreenshot"
    ] as ((
      page: { evaluate: () => Promise<void>; screenshot: () => Promise<Buffer> },
      options: Record<string, unknown>,
      maximumCaptures: number,
    ) => Promise<Buffer>) | undefined;
    const frames = Array.from({ length: 5 }, (_, index) => Buffer.from(`frame ${index}`));
    const page = {
      evaluate: vi.fn().mockResolvedValue(undefined),
      screenshot: vi.fn().mockImplementation(async () => frames.shift()!),
    };

    expect(captureStable).toBeTypeOf("function");
    await expect(captureStable!(page, { animations: "disabled" }, 5)).rejects.toThrow(
      "Fresh screenshot did not stabilize within 5 captures",
    );
    expect(page.screenshot).toHaveBeenCalledTimes(5);
    expect(page.evaluate).toHaveBeenCalledTimes(6);
  });

  it("rolls canonical evidence binding with the current runtime identity", async () => {
    const integrity = await import("../../../e2e/evidence-integrity");
    const bindFresh = (integrity as Record<string, unknown>)[
      "bindFreshCanonicalEvidence"
    ] as ((fresh: Uint8Array, runtimeIdentitySha256: string) => {
      bytes: Buffer;
      runtimeIdentitySha256: string;
    }) | undefined;
    const bytes = Buffer.from("same deterministic render");

    expect(bindFresh).toBeTypeOf("function");
    const previous = bindFresh!(bytes, "1".repeat(64));
    const current = bindFresh!(bytes, "2".repeat(64));

    expect(current.bytes).toEqual(previous.bytes);
    expect(current.runtimeIdentitySha256).toBe("2".repeat(64));
    expect(current.runtimeIdentitySha256).not.toBe(previous.runtimeIdentitySha256);
  });

  it("preserves historical authority bytes and identity for tolerated fresh edge drift", async () => {
    const integrity = await import("../../../e2e/evidence-integrity");
    const preserve = (integrity as Record<string, unknown>)[
      "preserveCanonicalEvidenceAuthority"
    ] as ((
      historical: {
        bytes: Uint8Array;
        canonicalSourceRevision: string;
        canonicalRuntimeIdentitySha256: string;
        canonicalAttestationRevision: string;
      },
      fresh: Uint8Array,
      comparison: {
        differentPixels: number;
        maxChannelDelta?: number;
        nonEdgeDifferentPixels?: number;
      },
      limits: { maximumDifferentPixels: number; maximumChannelDelta: number },
    ) => {
      bytes: Buffer;
      canonicalSourceRevision: string;
      canonicalRuntimeIdentitySha256: string;
      canonicalAttestationRevision: string;
    }) | undefined;
    const historicalBytes = Buffer.from("historical canonical bytes");
    const historical = {
      bytes: historicalBytes,
      canonicalSourceRevision: "1".repeat(40),
      canonicalRuntimeIdentitySha256: "2".repeat(64),
      canonicalAttestationRevision: "3".repeat(40),
    };

    expect(preserve).toBeTypeOf("function");
    const selected = preserve!(
      historical,
      Buffer.from("fresh edge-only bytes"),
      { differentPixels: 2, maxChannelDelta: 1, nonEdgeDifferentPixels: 0 },
      { maximumDifferentPixels: 256, maximumChannelDelta: 8 },
    );
    historicalBytes.fill(0);

    expect(selected.bytes).toEqual(Buffer.from("historical canonical bytes"));
    expect(selected.bytes).not.toBe(historicalBytes);
    expect(selected).toMatchObject({
      canonicalSourceRevision: "1".repeat(40),
      canonicalRuntimeIdentitySha256: "2".repeat(64),
      canonicalAttestationRevision: "3".repeat(40),
    });
  });

  it.each([
    ["non-edge mutation", { differentPixels: 1, maxChannelDelta: 1, nonEdgeDifferentPixels: 1 }],
    ["edge-count mutation", { differentPixels: 257, maxChannelDelta: 1, nonEdgeDifferentPixels: 0 }],
    ["channel-delta mutation", { differentPixels: 1, maxChannelDelta: 9, nonEdgeDifferentPixels: 0 }],
  ])("rejects historical authority preservation beyond limits for %s", async (_name, comparison) => {
    const integrity = await import("../../../e2e/evidence-integrity");
    const preserve = (integrity as Record<string, unknown>)[
      "preserveCanonicalEvidenceAuthority"
    ] as ((...arguments_: unknown[]) => unknown) | undefined;

    expect(preserve).toBeTypeOf("function");
    expect(() => preserve!(
      {
        bytes: Buffer.from("historical"),
        canonicalSourceRevision: "1".repeat(40),
        canonicalRuntimeIdentitySha256: "2".repeat(64),
        canonicalAttestationRevision: "3".repeat(40),
      },
      Buffer.from("fresh"),
      comparison,
      { maximumDifferentPixels: 256, maximumChannelDelta: 8 },
    )).toThrow("Fresh evidence exceeds historical authority preservation limits");
  });

  it("rejects incomplete historical authority comparisons", async () => {
    const integrity = await import("../../../e2e/evidence-integrity");
    const preserve = (integrity as Record<string, unknown>)[
      "preserveCanonicalEvidenceAuthority"
    ] as ((...arguments_: unknown[]) => unknown) | undefined;

    expect(() => preserve!(
      {
        bytes: Buffer.from("historical"),
        canonicalSourceRevision: "1".repeat(40),
        canonicalRuntimeIdentitySha256: "2".repeat(64),
        canonicalAttestationRevision: "3".repeat(40),
      },
      Buffer.from("fresh"),
      { differentPixels: 1 },
      { maximumDifferentPixels: 256, maximumChannelDelta: 8 },
    )).toThrow("Fresh evidence comparison is incomplete");
  });

  it("validates and measures selected M13 canonical bytes before staging provenance", () => {
    const workflow = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/e2e/official-settings-workflows.spec.ts"),
      "utf8",
    );

    expect(workflow).toContain("captureConsecutiveStableScreenshot(page");
    expect(workflow).not.toContain('animations: "disabled"');
    expect(workflow).toContain("preserveCanonicalEvidenceAuthority");
    expect(workflow).toContain("inspectPixels(page, selected.bytes)");
    expect(workflow).toContain("canonicalRuntimeIdentitySha256");
    expect(workflow).toContain("canonicalAttestationRevision");
    expect(workflow).toContain("prepareEvidenceWriterPreflight(");
    expect(workflow).not.toContain("mkdirSync(evidenceDirectory");
    expect(workflow).not.toContain("selectStableAuthorityBytes");
    expect(workflow).not.toContain("opaque: true as const");
    expect(workflow).not.toContain("mostlyBlank: false as const");
    expect(workflow).not.toContain("horizontallyClipped: false as const");
  });

  it("publishes M11 authorities only after all serial assertions and validates read-only provenance", () => {
    const workflow = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/e2e/official-generator-workflows.spec.ts"),
      "utf8",
    );
    const transaction = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/e2e/evidence-directory-transaction.ts"),
      "utf8",
    );

    expect(workflow).not.toContain("test.afterAll(");
    expect(workflow).toContain('test("publishes authorities only after all workflow assertions pass"');
    expect(workflow).toContain("assertCleanEvidenceWriterTree");
    expect(workflow).toContain("validateRecordedSourceRevision");
    expect(workflow).toContain("validateProvenanceHashes");
    expect(workflow).toContain("readPinnedVendorRevision");
    expect(workflow).toContain("comparison.nonEdgeDifferentPixels");
    assertRecoveryBeforeCleanTree(workflow);
    const renamedRecovery = workflow.replace(
      "recoverEvidenceDirectoryTransaction(evidenceDirectory, validateAuthoritySet)",
      "renamedRecoverEvidenceDirectoryTransaction(evidenceDirectory, validateAuthoritySet)",
    );
    expect(() => assertRecoveryBeforeCleanTree(renamedRecovery)).toThrow();
    const publication = workflow.slice(workflow.indexOf(
      'test("publishes authorities only after all workflow assertions pass"',
    ));
    expect(publication).toContain(
      "(stageDirectory) => assertCleanEvidenceWriterTree(",
    );
    expect(publication).toContain("stageDirectory,");
    expect(transaction.indexOf("beforeCanonicalInstall(stage);"))
      .toBeLessThan(transaction.indexOf("renameSync(authorityDirectory, backup)"));
    expect(workflow).toContain('"vendor/bitwarden-clients"');
    expect(workflow).toContain("assertOfficialGeneratorHeader(page, fileName)");
    expect(workflow).toContain('querySelectorAll<HTMLElement>("button, input, a[href]")');
    expect(workflow).toContain("renderedControls.filter((element) => (");
    expect(workflow).toContain("!isNormalOffscreenScrollContent(element) && isClipped(element)");
    expect(workflow).toContain("settleCaptureScrollOwnerAtTop(page)");
    expect(workflow).toContain("assertFullyPaintedHeaderElement");
    expect(workflow).not.toContain("document.elementFromPoint(bounds.left + bounds.width / 2");
    expect(workflow).toContain("elementsFromPoint");
    expect(workflow).toContain("opacity");
    expect(workflow).toContain("history back action");
    expect(workflow).toContain("M11 provenance authority rows must be one-to-one");
  });

  it.each([
    ["tEXt", textChunk("Fixture", "card-hidden-example")],
    ["zTXt", ztxtChunk("Fixture", "identity.example.test")],
    ["compressed iTXt", itxtChunk("Fixture", "note-hidden-example", true)],
  ])("rejects a secret in %s PNG metadata without scanning image bytes", async (_name, chunk) => {
    const integrity = await import("../../../e2e/evidence-integrity");
    const assertMetadata = (integrity as Record<string, unknown>)[
      "assertPngTextMetadataDoesNotContain"
    ] as ((png: Uint8Array, forbidden: readonly string[]) => void) | undefined;

    expect(assertMetadata).toBeTypeOf("function");
    expect(() => assertMetadata!(png(chunk), [
      "card-hidden-example",
      "identity.example.test",
      "note-hidden-example",
    ]))
      .toThrow("PNG text metadata contains a forbidden value");
  });

  it("parses uncompressed iTXt and accepts secret-free compressed PNG metadata", async () => {
    const integrity = await import("../../../e2e/evidence-integrity");
    const readMetadata = (integrity as Record<string, unknown>)["readPngTextMetadata"] as
      ((png: Uint8Array) => readonly string[]) | undefined;

    expect(readMetadata).toBeTypeOf("function");
    expect(readMetadata!(png(
      itxtChunk("Description", "Synthetic example.test authority", false),
      ztxtChunk("Source", "reserved fixture"),
    ))).toEqual([
      "Description\0Synthetic example.test authority",
      "Source\0reserved fixture",
    ]);
  });

  it("rejects extra stale PNG names from an authority inventory", async () => {
    const integrity = await import("../../../e2e/evidence-integrity");
    const assertInventory = (integrity as Record<string, unknown>)[
      "assertExactPngEvidenceInventory"
    ] as ((actual: readonly string[], expected: readonly string[]) => void) | undefined;

    expect(assertInventory).toBeTypeOf("function");
    expect(() => assertInventory!(
      ["card-detail-480x600.png", "stale-authority-480x600.png"],
      ["card-detail-480x600.png"],
    )).toThrow("PNG authority inventory differs from the expected state set");
  });

  it("accepts only nine PNG authorities plus provenance for a canonical M13 inventory", async () => {
    const assertInventory = await completeInventoryAssertion();
    const authorities = Array.from({ length: 9 }, (_, index) => `settings-${index}.png`);

    expect(() => assertInventory([...authorities, "provenance.json"], authorities, true)).not.toThrow();
    expect(() => assertInventory(authorities, authorities, false)).not.toThrow();
  });

  it.each(["unexpected.json", "notes.txt", "unexpected-directory"])(
    "rejects extra canonical M13 inventory entry %s",
    async (extraEntry) => {
      const assertInventory = await completeInventoryAssertion();
      const authorities = Array.from({ length: 9 }, (_, index) => `settings-${index}.png`);

      expect(() => assertInventory(
        [...authorities, "provenance.json", extraEntry],
        authorities,
        true,
      )).toThrow("Evidence directory inventory differs from the expected state set");
    },
  );

  it("rejects provenance and other extras from the M13 writer pre-provenance stage", async () => {
    const assertInventory = await completeInventoryAssertion();
    const authorities = Array.from({ length: 9 }, (_, index) => `settings-${index}.png`);

    expect(() => assertInventory([...authorities, "provenance.json"], authorities, false))
      .toThrow("Evidence directory inventory differs from the expected state set");
    expect(() => assertInventory([...authorities, "notes.txt"], authorities, false))
      .toThrow("Evidence directory inventory differs from the expected state set");
  });

  it("keeps M10 Chromium-writer and WebKit assertion-only evidence strict", () => {
    const workflow = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/e2e/official-recovery-workflows.spec.ts"),
      "utf8",
    );
    const playwright = readFileSync(join(process.cwd(), "playwright.config.ts"), "utf8");

    expect(workflow).toContain("const states = [");
    expect(workflow).toContain("const screenshotFiles = states.map((state) => `${state}-480x600.png`)");
    expect(workflow).toContain("isAuthoritativeEvidenceWriter");
    expect(workflow).toContain("differentPixels).toBe(0)");
    expect(workflow).toContain("validateExistingAuthoritySet");
    expect(workflow).toContain("test.beforeAll(() =>");
    expect(workflow).toContain("authorityRefreshPhase");
    expect(workflow).toContain("settleSemanticPaint");
    expect(workflow).toContain("replaceEvidenceDirectoryTransactionally");
    expect(workflow).toContain('"M10-CVC-731"');
    expect(workflow).toContain("document.documentElement.outerHTML");
    expect(workflow).toContain("sessionStorage");
    expect(workflow).toContain("requestFailures");
    expect(workflow).not.toContain('process.env.UPDATE_EVIDENCE !== "true"');
    expect(workflow).not.toContain("mkdirSync(evidenceDirectory");
    for (const forbidden of [
      "waitFor" + "Timeout",
      "set" + "Timeout",
      "requestAnimation" + "Frame",
      "mask" + ":",
      "alternate" + "Hash",
    ]) {
      expect(workflow).not.toContain(forbidden);
    }
    expect(playwright).toContain("official-recovery-workflows.spec.ts");
  });
});

function assertRecoveryBeforeCleanTree(workflow: string): void {
  const recoveryIndex = workflow.indexOf(
    "recoverEvidenceDirectoryTransaction(evidenceDirectory, validateAuthoritySet)",
  );
  expect(recoveryIndex).toBeGreaterThanOrEqual(0);
  expect(recoveryIndex).toBeLessThan(workflow.indexOf("assertCleanEvidenceWriterTree()"));
}

async function completeInventoryAssertion(): Promise<(
  actual: readonly string[],
  expectedPngs: readonly string[],
  requireProvenance: boolean,
) => void> {
  const integrity = await import("../../../e2e/evidence-integrity");
  const assertion = (integrity as Record<string, unknown>)[
    "assertExactEvidenceDirectoryInventory"
  ];
  expect(assertion).toBeTypeOf("function");
  return assertion as (
    actual: readonly string[],
    expectedPngs: readonly string[],
    requireProvenance: boolean,
  ) => void;
}

function png(...chunks: readonly Buffer[]): Buffer {
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    ...chunks,
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function ztxtChunk(keyword: string, value: string): Buffer {
  return pngChunk("zTXt", Buffer.concat([
    Buffer.from(keyword, "latin1"),
    Buffer.from([0, 0]),
    deflateSync(Buffer.from(value, "latin1")),
  ]));
}

function textChunk(keyword: string, value: string): Buffer {
  return pngChunk("tEXt", Buffer.concat([
    Buffer.from(keyword, "latin1"),
    Buffer.from([0]),
    Buffer.from(value, "latin1"),
  ]));
}

function itxtChunk(keyword: string, value: string, compressed: boolean): Buffer {
  return pngChunk("iTXt", Buffer.concat([
    Buffer.from(keyword, "latin1"),
    Buffer.from([0, compressed ? 1 : 0, 0, 0, 0]),
    compressed ? deflateSync(Buffer.from(value, "utf8")) : Buffer.from(value, "utf8"),
  ]));
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, Buffer.from(type, "ascii"), data, Buffer.alloc(4)]);
}
