import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { assertPinnedUpstreamRevision, parseUpstreamRevision } from "./upstream-provenance";

describe("upstream provenance", () => {
  it("parses the exact two-line upstream marker", () => {
    expect(parseUpstreamRevision("https://github.com/bitwarden/clients.git\r\nf47b6946e01aed474875789081966d311d5b8289\r\n")).toEqual({
      repositoryUrl: "https://github.com/bitwarden/clients.git",
      commit: "f47b6946e01aed474875789081966d311d5b8289",
    });
  });

  it("pins the immutable Bitwarden clients source snapshot", () => {
    const revision = readFileSync(
      resolve(process.cwd(), "vendor/bitwarden-clients/.source-revision"),
      "utf8",
    );

    expect(assertPinnedUpstreamRevision(revision)).toEqual({
      repositoryUrl: "https://github.com/bitwarden/clients.git",
      commit: "f47b6946e01aed474875789081966d311d5b8289",
    });
  });

  it("rejects malformed marker lines", () => {
    expect(() =>
      parseUpstreamRevision("https://github.com/bitwarden/clients.git"),
    ).toThrow("Invalid upstream source marker");
    expect(() =>
      parseUpstreamRevision(" https://github.com/bitwarden/clients.git\nf47b6946e01aed474875789081966d311d5b8289"),
    ).toThrow("Invalid upstream source marker");
    expect(() =>
      parseUpstreamRevision("https://github.com/bitwarden/clients.git \nf47b6946e01aed474875789081966d311d5b8289"),
    ).toThrow("Invalid upstream source marker");
    expect(() =>
      parseUpstreamRevision("https://github.com/bitwarden/clients.git\nf47b6946e01aed474875789081966d311d5b8289 "),
    ).toThrow("Invalid upstream source marker");
    expect(() =>
      parseUpstreamRevision("https://github.com/bitwarden/clients.git\n"),
    ).toThrow("Invalid upstream source marker");
    expect(() =>
      parseUpstreamRevision("https://github.com/bitwarden/clients.git\n\n"),
    ).toThrow("Invalid upstream source marker");
    expect(() =>
      parseUpstreamRevision("https://github.com/bitwarden/clients.git\nf47b6946e01aed474875789081966d311d5b8289\nextra"),
    ).toThrow("Invalid upstream source marker");
  });

  it("rejects an unexpected repository or commit", () => {
    expect(() =>
      assertPinnedUpstreamRevision("https://github.com/bitwarden/clients.git\nwrong"),
    ).toThrow("Unexpected Bitwarden clients source revision");
    expect(() =>
      assertPinnedUpstreamRevision("https://example.com/bitwarden/clients.git\nf47b6946e01aed474875789081966d311d5b8289"),
    ).toThrow("Unexpected Bitwarden clients source revision");
  });
});
