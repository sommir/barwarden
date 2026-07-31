import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

import type { Page } from "@playwright/test";

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const maxPngTextMetadataBytes = 1024 * 1024;

interface PngTextMetadata {
  keyword: string;
  language: string;
  translatedKeyword: string;
  text: string;
}

export interface FreshCanonicalEvidence {
  bytes: Buffer;
  runtimeIdentitySha256: string;
}

export interface HistoricalCanonicalEvidence {
  bytes: Uint8Array;
  canonicalSourceRevision: string;
  canonicalRuntimeIdentitySha256: string;
  canonicalAttestationRevision: string;
}

export interface EvidencePixelComparison {
  differentPixels: number;
  maxChannelDelta?: number;
  nonEdgeDifferentPixels?: number;
}

export async function captureConsecutiveStableScreenshot(
  page: Pick<Page, "evaluate" | "screenshot">,
  options: NonNullable<Parameters<Page["screenshot"]>[0]>,
  maximumCaptures = 6,
): Promise<Buffer> {
  if (!Number.isInteger(maximumCaptures) || maximumCaptures < 2) {
    throw new Error("Fresh screenshot capture limit must be an integer of at least 2");
  }
  await page.evaluate(() => {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) activeElement.blur();
    if (document.head.querySelector("style[data-m13-evidence-capture-freeze]")) return;
    const style = document.createElement("style");
    style.setAttribute("data-m13-evidence-capture-freeze", "");
    style.textContent = `
      *, *::before, *::after {
        animation: none !important;
        caret-color: transparent !important;
        scroll-behavior: auto !important;
        transition: none !important;
      }
    `;
    document.head.append(style);
  });
  let previous: Buffer | undefined;
  for (let capture = 0; capture < maximumCaptures; capture += 1) {
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    const current = Buffer.from(await page.screenshot(options));
    if (previous?.equals(current)) return current;
    previous = current;
  }
  throw new Error(`Fresh screenshot did not stabilize within ${maximumCaptures} captures`);
}

export function bindFreshCanonicalEvidence(
  fresh: Uint8Array,
  runtimeIdentitySha256: string,
): FreshCanonicalEvidence {
  if (!/^[0-9a-f]{64}$/.test(runtimeIdentitySha256)) {
    throw new Error("Canonical evidence runtime identity must be a SHA-256 digest");
  }
  return {
    bytes: Buffer.from(fresh),
    runtimeIdentitySha256,
  };
}

export function preserveCanonicalEvidenceAuthority(
  historical: HistoricalCanonicalEvidence,
  fresh: Uint8Array,
  comparison: EvidencePixelComparison,
  limits: { maximumDifferentPixels: number; maximumChannelDelta: number },
): Omit<HistoricalCanonicalEvidence, "bytes"> & { bytes: Buffer } {
  if (!/^[0-9a-f]{40}$/.test(historical.canonicalSourceRevision)) {
    throw new Error("Historical authority source revision must be a full Git commit");
  }
  if (!/^[0-9a-f]{64}$/.test(historical.canonicalRuntimeIdentitySha256)) {
    throw new Error("Historical authority runtime identity must be a SHA-256 digest");
  }
  if (!/^[0-9a-f]{40}$/.test(historical.canonicalAttestationRevision)) {
    throw new Error("Historical authority attestation revision must be a full Git commit");
  }
  if (!Number.isInteger(limits.maximumDifferentPixels) || limits.maximumDifferentPixels < 0
    || !Number.isInteger(limits.maximumChannelDelta) || limits.maximumChannelDelta < 0) {
    throw new Error("Historical authority preservation limits must be non-negative integers");
  }

  const historicalBytes = Buffer.from(historical.bytes);
  const freshBytes = Buffer.from(fresh);
  const exact = historicalBytes.equals(freshBytes);
  const completeComparison = Number.isInteger(comparison.differentPixels)
    && comparison.differentPixels >= 0
    && (exact || (
      Number.isInteger(comparison.maxChannelDelta)
      && comparison.maxChannelDelta! > 0
      && Number.isInteger(comparison.nonEdgeDifferentPixels)
      && comparison.nonEdgeDifferentPixels! >= 0
    ));
  if (!completeComparison) {
    throw new Error("Fresh evidence comparison is incomplete");
  }
  if ((exact && comparison.differentPixels !== 0)
    || (!exact && comparison.differentPixels === 0)) {
    throw new Error("Fresh evidence comparison does not match the supplied bytes");
  }
  if (
    comparison.differentPixels > limits.maximumDifferentPixels
    || (comparison.maxChannelDelta ?? 0) > limits.maximumChannelDelta
    || (comparison.nonEdgeDifferentPixels ?? 0) !== 0
  ) {
    throw new Error("Fresh evidence exceeds historical authority preservation limits");
  }

  return {
    bytes: historicalBytes,
    canonicalSourceRevision: historical.canonicalSourceRevision,
    canonicalRuntimeIdentitySha256: historical.canonicalRuntimeIdentitySha256,
    canonicalAttestationRevision: historical.canonicalAttestationRevision,
  };
}

export function assertExactEvidenceBytes(
  authoritative: Uint8Array,
  fresh: Uint8Array,
): string {
  const authoritativeHash = createHash("sha256").update(authoritative).digest("hex");
  const freshHash = createHash("sha256").update(fresh).digest("hex");
  if (
    authoritative.byteLength !== fresh.byteLength ||
    authoritativeHash !== freshHash ||
    !Buffer.from(authoritative).equals(Buffer.from(fresh))
  ) {
    throw new Error("Fresh evidence does not match the authoritative bytes");
  }
  return authoritativeHash;
}

export async function compareEvidenceScreenshotPixels(
  page: Page,
  authority: Buffer,
  fresh: Buffer,
): Promise<{
  width?: number;
  height?: number;
  differentPixels: number;
  maxChannelDelta?: number;
  nonEdgeDifferentPixels?: number;
}> {
  if (authority.equals(fresh)) {
    return { differentPixels: 0 };
  }
  return page.evaluate(async ({ authoritySource, freshSource }) => {
    const decode = async (source: string) => {
      const image = new Image();
      image.src = `data:image/png;base64,${source}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas unavailable");
      context.drawImage(image, 0, 0);
      return {
        width: canvas.width,
        height: canvas.height,
        pixels: context.getImageData(0, 0, canvas.width, canvas.height).data,
      };
    };
    const [authorityImage, freshImage] = await Promise.all([
      decode(authoritySource),
      decode(freshSource),
    ]);
    if (authorityImage.width !== freshImage.width || authorityImage.height !== freshImage.height) {
      throw new Error("Authority and fresh evidence dimensions differ");
    }
    let differentPixels = 0;
    let maxChannelDelta = 0;
    let nonEdgeDifferentPixels = 0;
    const isNearImageEdge = (
      pixels: Uint8ClampedArray,
      width: number,
      height: number,
      pixelIndex: number,
    ): boolean => {
      const pixelOffset = pixelIndex / 4;
      const x = pixelOffset % width;
      const y = Math.floor(pixelOffset / width);
      for (let channel = 0; channel < 4; channel += 1) {
        let minimum = 255;
        let maximum = 0;
        let sampledNeighbor = false;
        for (let neighborY = Math.max(0, y - 1); neighborY <= Math.min(height - 1, y + 1); neighborY += 1) {
          for (let neighborX = Math.max(0, x - 1); neighborX <= Math.min(width - 1, x + 1); neighborX += 1) {
            if (neighborX === x && neighborY === y) continue;
            const value = pixels[(neighborY * width + neighborX) * 4 + channel]!;
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
            sampledNeighbor = true;
          }
        }
        if (sampledNeighbor && maximum - minimum >= 8) return true;
      }
      return false;
    };
    for (let index = 0; index < authorityImage.pixels.length; index += 4) {
      if (
        authorityImage.pixels[index] !== freshImage.pixels[index] ||
        authorityImage.pixels[index + 1] !== freshImage.pixels[index + 1] ||
        authorityImage.pixels[index + 2] !== freshImage.pixels[index + 2] ||
        authorityImage.pixels[index + 3] !== freshImage.pixels[index + 3]
      ) {
        differentPixels += 1;
        if (
          !isNearImageEdge(freshImage.pixels, freshImage.width, freshImage.height, index)
        ) {
          nonEdgeDifferentPixels += 1;
        }
        for (let channel = 0; channel < 4; channel += 1) {
          maxChannelDelta = Math.max(
            maxChannelDelta,
            Math.abs(authorityImage.pixels[index + channel]! - freshImage.pixels[index + channel]!),
          );
        }
      }
    }
    return {
      width: freshImage.width,
      height: freshImage.height,
      differentPixels,
      maxChannelDelta,
      nonEdgeDifferentPixels,
    };
  }, {
    authoritySource: authority.toString("base64"),
    freshSource: fresh.toString("base64"),
  });
}

export function readPngTextMetadata(png: Uint8Array): readonly string[] {
  return readPngTextMetadataRecords(png).map(({ keyword, text }) => `${keyword}\0${text}`);
}

export function assertPngTextMetadataDoesNotContain(
  png: Uint8Array,
  forbiddenValues: readonly string[],
): void {
  const metadata = readPngTextMetadataRecords(png);
  const forbidden = forbiddenValues.filter((value) => value.length > 0);
  if (metadata.some((record) =>
    [record.keyword, record.language, record.translatedKeyword, record.text]
      .some((value) => forbidden.some((secret) => value.includes(secret))))) {
    throw new Error("PNG text metadata contains a forbidden value");
  }
}

export function assertExactPngEvidenceInventory(
  actualFileNames: readonly string[],
  expectedFileNames: readonly string[],
): void {
  const actual = [...actualFileNames].sort();
  const expected = [...expectedFileNames].sort();
  if (actual.length !== expected.length || actual.some((fileName, index) => fileName !== expected[index])) {
    throw new Error("PNG authority inventory differs from the expected state set");
  }
}

export function assertExactEvidenceDirectoryInventory(
  actualEntries: readonly string[],
  expectedPngFileNames: readonly string[],
  requireProvenance: boolean,
): void {
  const actual = [...actualEntries].sort();
  const expected = [
    ...expectedPngFileNames,
    ...(requireProvenance ? ["provenance.json"] : []),
  ].sort();
  if (actual.length !== expected.length || actual.some((entry, index) => entry !== expected[index])) {
    throw new Error("Evidence directory inventory differs from the expected state set");
  }
}

function readPngTextMetadataRecords(png: Uint8Array): readonly PngTextMetadata[] {
  const source = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  if (source.length < pngSignature.length || !source.subarray(0, pngSignature.length).equals(pngSignature)) {
    throw new Error("Invalid PNG signature");
  }

  const metadata: PngTextMetadata[] = [];
  let offset = pngSignature.length;
  let reachedEnd = false;
  while (offset < source.length) {
    if (offset + 12 > source.length) throw new Error("Invalid PNG chunk bounds");
    const length = source.readUInt32BE(offset);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (dataEnd < dataStart || chunkEnd > source.length) {
      throw new Error("Invalid PNG chunk bounds");
    }

    const type = source.toString("ascii", offset + 4, dataStart);
    const data = source.subarray(dataStart, dataEnd);
    if (["tEXt", "zTXt", "iTXt"].includes(type)) {
      if (data.length > maxPngTextMetadataBytes) throw new Error("PNG text metadata is too large");
      metadata.push(parsePngTextChunk(type, data));
    }

    offset = chunkEnd;
    if (type === "IEND") {
      if (length !== 0 || offset !== source.length) throw new Error("Invalid PNG end chunk");
      reachedEnd = true;
      break;
    }
  }
  if (!reachedEnd) throw new Error("PNG end chunk is missing");
  return metadata;
}

function parsePngTextChunk(type: string, data: Buffer): PngTextMetadata {
  const [keywordBytes, afterKeyword] = readNullTerminated(data, 0);
  const keyword = keywordBytes.toString("latin1");
  if (keyword.length < 1 || keyword.length > 79) throw new Error("Invalid PNG text keyword");

  if (type === "tEXt") {
    return {
      keyword,
      language: "",
      translatedKeyword: "",
      text: data.subarray(afterKeyword).toString("latin1"),
    };
  }
  if (type === "zTXt") {
    if (afterKeyword >= data.length || data[afterKeyword] !== 0) {
      throw new Error("Invalid PNG compressed text metadata");
    }
    return {
      keyword,
      language: "",
      translatedKeyword: "",
      text: inflatePngText(data.subarray(afterKeyword + 1), "latin1"),
    };
  }

  if (afterKeyword + 2 > data.length) throw new Error("Invalid PNG international text metadata");
  const compressionFlag = data[afterKeyword];
  const compressionMethod = data[afterKeyword + 1];
  if ((compressionFlag !== 0 && compressionFlag !== 1) || compressionMethod !== 0) {
    throw new Error("Invalid PNG international text metadata");
  }
  const [languageBytes, afterLanguage] = readNullTerminated(data, afterKeyword + 2);
  const [translatedKeywordBytes, afterTranslatedKeyword] = readNullTerminated(data, afterLanguage);
  const textBytes = data.subarray(afterTranslatedKeyword);
  return {
    keyword,
    language: languageBytes.toString("ascii"),
    translatedKeyword: translatedKeywordBytes.toString("utf8"),
    text: compressionFlag === 1 ? inflatePngText(textBytes, "utf8") : textBytes.toString("utf8"),
  };
}

function readNullTerminated(data: Buffer, offset: number): [Buffer, number] {
  const terminator = data.indexOf(0, offset);
  if (terminator < 0) throw new Error("Invalid PNG text metadata");
  return [data.subarray(offset, terminator), terminator + 1];
}

function inflatePngText(data: Buffer, encoding: BufferEncoding): string {
  try {
    return inflateSync(data, { maxOutputLength: maxPngTextMetadataBytes }).toString(encoding);
  } catch {
    throw new Error("Invalid PNG compressed text metadata");
  }
}
