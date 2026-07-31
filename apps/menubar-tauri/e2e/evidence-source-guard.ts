import { execFileSync } from "node:child_process";
import { relative } from "node:path";

export interface EvidenceWriterSourceGuardOptions {
  expectedRevision?: string | null;
  ignoredTransactionStage?: string | null;
  ignoredWorktreePaths?: readonly string[];
  worktree?: string;
}

export function assertCleanEvidenceWriterTree({
  expectedRevision = null,
  ignoredTransactionStage = null,
  ignoredWorktreePaths = [],
  worktree = process.cwd(),
}: EvidenceWriterSourceGuardOptions = {}): string {
  const statusArguments = ["status", "--porcelain", "--untracked-files=all"];
  const exclusions: string[] = [];
  if (ignoredTransactionStage !== null) {
    const stagePath = relative(worktree, ignoredTransactionStage).replaceAll("\\", "/");
    if (stagePath.startsWith("../") || stagePath === "..") {
      throw new Error("M11 transaction stage must be inside the Git worktree");
    }
    exclusions.push(
      `:(exclude)${stagePath}`,
      `:(exclude)${stagePath}/**`,
    );
  }
  for (const ignoredPath of ignoredWorktreePaths) {
    const path = relative(worktree, ignoredPath).replaceAll("\\", "/");
    if (!path || path.startsWith("../") || path === "..") {
      throw new Error("M11 ignored worktree path must be inside the Git worktree");
    }
    exclusions.push(`:(exclude,top)${path}`);
  }
  if (exclusions.length > 0) statusArguments.push("--", ".", ...exclusions);
  const dirty = execFileSync("git", statusArguments, {
    cwd: worktree,
    encoding: "utf8",
  }).trim();
  if (dirty.length > 0) {
    throw new Error(`M11 authority writer requires a clean Git worktree:\n${dirty}`);
  }
  const revision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: worktree,
    encoding: "utf8",
  }).trim();
  if (expectedRevision !== null && revision !== expectedRevision) {
    throw new Error("M11 authority writer source revision changed during capture");
  }
  return revision;
}
