import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  recoverEvidenceDirectoryTransaction,
  replaceEvidenceDirectoryTransactionally,
} from "../../../e2e/evidence-directory-transaction";

const temporaryRoots: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("evidence directory transaction", () => {
  it("publishes a complete staged directory in one canonical rename", () => {
    const root = temporaryRoot();
    const authority = join(root, "authorities");
    seedAuthority(authority, "old");

    replaceEvidenceDirectoryTransactionally(authority, (stage) => seedAuthority(stage, "new"));

    expect(readdirSync(authority).sort()).toEqual(["PROVENANCE.md", "state.png"]);
    expect(readFileSync(join(authority, "state.png"), "utf8")).toBe("new-image");
    expect(readFileSync(join(authority, "PROVENANCE.md"), "utf8")).toBe("new-provenance");
    expect(existsSync(`${authority}.transaction-backup`)).toBe(false);
  });

  it("restores the complete old directory after interruption before canonical install", () => {
    const root = temporaryRoot();
    const authority = join(root, "authorities");
    seedAuthority(authority, "old");
    renameSync(authority, `${authority}.transaction-backup`);

    recoverEvidenceDirectoryTransaction(authority);

    expect(readFileSync(join(authority, "state.png"), "utf8")).toBe("old-image");
    expect(readFileSync(join(authority, "PROVENANCE.md"), "utf8")).toBe("old-provenance");
    expect(existsSync(`${authority}.transaction-backup`)).toBe(false);
  });

  it("rejects source drift after staging and leaves the complete old authority installed", () => {
    const root = temporaryRoot();
    const authority = join(root, "authorities");
    seedAuthority(authority, "old");
    let staged = false;

    expect(() => replaceEvidenceDirectoryTransactionally(
      authority,
      (stage) => {
        seedAuthority(stage, "new");
        staged = true;
      },
      (stage) => {
        expect(staged).toBe(true);
        expect(existsSync(stage)).toBe(true);
        throw new Error("source revision changed during staging");
      },
    )).toThrow("source revision changed during staging");

    expect(readFileSync(join(authority, "state.png"), "utf8")).toBe("old-image");
    expect(readFileSync(join(authority, "PROVENANCE.md"), "utf8")).toBe("old-provenance");
    expect(existsSync(`${authority}.transaction-backup`)).toBe(false);
    expect(readdirSync(root).filter((entry) => entry.includes(".transaction-stage-"))).toEqual([]);
  });
});

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "bw-m10-evidence-"));
  temporaryRoots.push(root);
  return root;
}

function seedAuthority(directory: string, value: string): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "state.png"), `${value}-image`);
  writeFileSync(join(directory, "PROVENANCE.md"), `${value}-provenance`);
}
