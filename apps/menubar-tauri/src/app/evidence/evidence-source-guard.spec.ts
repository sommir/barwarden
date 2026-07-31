import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import * as evidenceTransaction from "../../../e2e/evidence-directory-transaction";
import { assertCleanEvidenceWriterTree } from "../../../e2e/evidence-source-guard";

const { replaceEvidenceDirectoryTransactionally } = evidenceTransaction;

const temporaryRoots: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("M11 evidence source guard", () => {
  it("recovers a leftover stage before the writer clean-tree guard", () => {
    const { worktree, authority, revision } = committedAuthorityWorktree();
    const stage = `${authority}.transaction-stage-interrupted`;
    seedAuthority(stage, "staged");
    const calls: string[] = [];
    const prepare = requiredWriterPreflight();

    expect(prepare(
      authority,
      (recovered) => {
        calls.push("validate");
        expect(readFileSync(join(recovered, "state.png"), "utf8")).toBe("old-image");
      },
      () => {
        calls.push("clean");
        return assertCleanEvidenceWriterTree({ worktree });
      },
    )).toBe(revision);

    expect(calls).toEqual(["validate", "clean"]);
    expect(existsSync(stage)).toBe(false);
  });

  it("restores and validates a backup before the writer clean-tree guard", () => {
    const { worktree, authority, revision } = committedAuthorityWorktree();
    const backup = `${authority}.transaction-backup`;
    renameSync(authority, backup);
    const calls: string[] = [];
    const prepare = requiredWriterPreflight();

    expect(prepare(
      authority,
      (recovered) => {
        calls.push("validate");
        expect(readFileSync(join(recovered, "PROVENANCE.md"), "utf8")).toBe("old-provenance");
      },
      () => {
        calls.push("clean");
        return assertCleanEvidenceWriterTree({ worktree });
      },
    )).toBe(revision);

    expect(calls).toEqual(["validate", "clean"]);
    expect(existsSync(authority)).toBe(true);
    expect(existsSync(backup)).toBe(false);
  });

  it("restores a validated backup when the canonical authority is corrupt", () => {
    const { worktree, authority, revision } = committedAuthorityWorktree();
    const backup = `${authority}.transaction-backup`;
    renameSync(authority, backup);
    mkdirSync(authority);
    writeFileSync(join(authority, "state.png"), "corrupt-image");
    const prepare = requiredWriterPreflight();

    expect(prepare(
      authority,
      (recovered) => {
        expect(readFileSync(join(recovered, "state.png"), "utf8")).toBe("old-image");
        expect(readFileSync(join(recovered, "PROVENANCE.md"), "utf8")).toBe("old-provenance");
      },
      () => assertCleanEvidenceWriterTree({ worktree }),
    )).toBe(revision);

    expect(readFileSync(join(authority, "state.png"), "utf8")).toBe("old-image");
    expect(existsSync(backup)).toBe(false);
  });

  it("validates the canonical authority before removing a stale backup", () => {
    const { worktree, authority, revision } = committedAuthorityWorktree();
    const backup = `${authority}.transaction-backup`;
    seedAuthority(backup, "stale");
    const prepare = requiredWriterPreflight();

    expect(prepare(
      authority,
      (recovered) => {
        expect(existsSync(backup)).toBe(true);
        expect(readFileSync(join(recovered, "state.png"), "utf8")).toBe("old-image");
      },
      () => assertCleanEvidenceWriterTree({ worktree }),
    )).toBe(revision);

    expect(readFileSync(join(authority, "state.png"), "utf8")).toBe("old-image");
    expect(existsSync(backup)).toBe(false);
  });

  it("does not create an empty canonical directory when recovery has no authority", () => {
    const worktree = committedWorktree();
    const authority = join(worktree, "missing-authorities");
    const clean = () => assertCleanEvidenceWriterTree({ worktree });
    const prepare = requiredWriterPreflight();

    expect(() => prepare(authority, () => undefined, clean))
      .toThrow("Evidence authority directory is missing after transaction recovery");
    expect(existsSync(authority)).toBe(false);
  });

  it("allows only its exact transaction stage and rejects tracked and unrelated drift before publication", () => {
    const worktree = temporaryGitWorktree();
    const authority = join(worktree, "authorities");
    seedAuthority(authority, "old");
    mkdirSync(join(worktree, "src"), { recursive: true });
    writeFileSync(join(worktree, "src", "tracked-source.ts"), "export const source = 'old';\n");
    git(worktree, ["add", "."]);
    git(worktree, ["-c", "user.name=Evidence Test", "-c", "user.email=evidence@example.test", "commit", "-m", "initial"]);
    const revision = git(worktree, ["rev-parse", "HEAD"]);

    expect(() => replaceEvidenceDirectoryTransactionally(
      authority,
      (stage) => {
        seedAuthority(stage, "new");
        expect(assertCleanEvidenceWriterTree({
          worktree,
          expectedRevision: revision,
          ignoredTransactionStage: stage,
        })).toBe(revision);
        writeFileSync(join(worktree, "src", "tracked-source.ts"), "export const source = 'changed';\n");
        mkdirSync(join(worktree, "unrelated-untracked"), { recursive: true });
        writeFileSync(join(worktree, "unrelated-untracked", "note.txt"), "not transaction-owned\n");
      },
      (stage) => assertCleanEvidenceWriterTree({
        worktree,
        expectedRevision: revision,
        ignoredTransactionStage: stage,
      }),
    )).toThrow("M11 authority writer requires a clean Git worktree");

    expect(readFileSync(join(authority, "state.png"), "utf8")).toBe("old-image");
    expect(readFileSync(join(authority, "PROVENANCE.md"), "utf8")).toBe("old-provenance");
    expect(existsSync(`${authority}.transaction-backup`)).toBe(false);
    expect(readdirSync(worktree).filter((entry) => entry.includes(".transaction-stage-"))).toEqual([]);
    expect(git(worktree, ["status", "--porcelain", "--untracked-files=all"])).toContain("M src/tracked-source.ts");
    expect(git(worktree, ["status", "--porcelain", "--untracked-files=all"]))
      .toContain("?? unrelated-untracked/note.txt");
  });

  it("rejects an unrelated untracked path while ignoring only the exact stage", () => {
    const worktree = committedWorktree();
    const revision = git(worktree, ["rev-parse", "HEAD"]);
    const stage = join(worktree, "authorities.transaction-stage-owned");
    seedAuthority(stage, "new");
    writeFileSync(join(worktree, "unrelated.txt"), "not transaction-owned\n");

    expect(() => assertCleanEvidenceWriterTree({
      worktree,
      expectedRevision: revision,
      ignoredTransactionStage: stage,
    })).toThrow("M11 authority writer requires a clean Git worktree");
  });

  it("allows exact controller outputs while still rejecting unrelated drift", () => {
    const worktree = committedWorktree();
    const revision = git(worktree, ["rev-parse", "HEAD"]);
    const machineReport = join(worktree, "docs", "machine.json");
    const runtimeReport = join(worktree, "docs", "runtime.md");
    mkdirSync(join(worktree, "docs"), { recursive: true });
    writeFileSync(machineReport, "machine report\n");
    writeFileSync(runtimeReport, "runtime report\n");

    expect(assertCleanEvidenceWriterTree({
      worktree,
      expectedRevision: revision,
      ignoredWorktreePaths: [machineReport, runtimeReport],
    })).toBe(revision);

    writeFileSync(join(worktree, "unrelated.txt"), "not controller-owned\n");
    expect(() => assertCleanEvidenceWriterTree({
      worktree,
      expectedRevision: revision,
      ignoredWorktreePaths: [machineReport, runtimeReport],
    })).toThrow("M11 authority writer requires a clean Git worktree");
  });

  it("rejects a clean replacement revision after staging", () => {
    const worktree = committedWorktree();
    const expectedRevision = git(worktree, ["rev-parse", "HEAD"]);
    writeFileSync(join(worktree, "tracked-source.ts"), "export const source = 'replacement';\n");
    git(worktree, ["add", "."]);
    git(worktree, [
      "-c", "user.name=Evidence Test",
      "-c", "user.email=evidence@example.test",
      "commit", "-m", "replacement",
    ]);
    const stage = join(worktree, "authorities.transaction-stage-owned");
    seedAuthority(stage, "new");

    expect(() => assertCleanEvidenceWriterTree({
      worktree,
      expectedRevision,
      ignoredTransactionStage: stage,
    })).toThrow("M11 authority writer source revision changed during capture");
  });

  it("rejects a transaction stage outside the Git worktree", () => {
    const worktree = committedWorktree();
    const outsideStage = mkdtempSync(join(tmpdir(), "bw-m11-outside-stage-"));
    temporaryRoots.push(outsideStage);

    expect(() => assertCleanEvidenceWriterTree({
      worktree,
      ignoredTransactionStage: outsideStage,
    })).toThrow("M11 transaction stage must be inside the Git worktree");
  });
});

function temporaryGitWorktree(): string {
  const root = mkdtempSync(join(tmpdir(), "bw-m11-source-guard-"));
  temporaryRoots.push(root);
  git(root, ["init"]);
  return root;
}

function committedWorktree(): string {
  const root = temporaryGitWorktree();
  writeFileSync(join(root, "tracked-source.ts"), "export const source = 'initial';\n");
  git(root, ["add", "."]);
  git(root, [
    "-c", "user.name=Evidence Test",
    "-c", "user.email=evidence@example.test",
    "commit", "-m", "initial",
  ]);
  return root;
}

function committedAuthorityWorktree(): {
  worktree: string;
  authority: string;
  revision: string;
} {
  const worktree = temporaryGitWorktree();
  const authority = join(worktree, "authorities");
  seedAuthority(authority, "old");
  git(worktree, ["add", "."]);
  git(worktree, [
    "-c", "user.name=Evidence Test",
    "-c", "user.email=evidence@example.test",
    "commit", "-m", "initial",
  ]);
  return {
    worktree,
    authority,
    revision: git(worktree, ["rev-parse", "HEAD"]),
  };
}

function requiredWriterPreflight(): (
  authorityDirectory: string,
  validateRecoveredAuthority: (directory: string) => void,
  assertCleanWriterTree: () => string,
) => string {
  const prepare = (evidenceTransaction as Record<string, unknown>)[
    "prepareEvidenceWriterPreflight"
  ];
  expect(prepare).toBeTypeOf("function");
  return prepare as (
    authorityDirectory: string,
    validateRecoveredAuthority: (directory: string) => void,
    assertCleanWriterTree: () => string,
  ) => string;
}

function seedAuthority(directory: string, value: string): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "state.png"), `${value}-image`);
  writeFileSync(join(directory, "PROVENANCE.md"), `${value}-provenance`);
}

function git(worktree: string, arguments_: string[]): string {
  return execFileSync("git", arguments_, { cwd: worktree, encoding: "utf8" }).trim();
}
