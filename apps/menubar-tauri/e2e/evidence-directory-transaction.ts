import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

const backupSuffix = ".transaction-backup";
const stageMarker = ".transaction-stage-";

export type EvidenceDirectoryValidator = (directory: string) => void;

export function recoverEvidenceDirectoryTransaction(
  authorityDirectory: string,
  validateAuthority?: EvidenceDirectoryValidator,
): void {
  const backup = `${authorityDirectory}${backupSuffix}`;
  if (existsSync(backup)) {
    if (existsSync(authorityDirectory)) {
      if (!validateAuthority) {
        throw new Error("Evidence transaction recovery requires authority validation before discarding a backup");
      }
      try {
        validateAuthority(authorityDirectory);
      } catch {
        validateAuthority(backup);
        restoreValidatedBackup(authorityDirectory, backup);
        removeTransactionStages(authorityDirectory);
        return;
      }
      rmSync(backup, { recursive: true, force: true });
    } else {
      validateAuthority?.(backup);
      renameSync(backup, authorityDirectory);
    }
  } else if (existsSync(authorityDirectory)) {
    validateAuthority?.(authorityDirectory);
  }

  removeTransactionStages(authorityDirectory);
}

function removeTransactionStages(authorityDirectory: string): void {
  const parent = dirname(authorityDirectory);
  const stagePrefix = `${basename(authorityDirectory)}${stageMarker}`;
  for (const entry of readdirSync(parent)) {
    if (entry.startsWith(stagePrefix)) {
      rmSync(join(parent, entry), { recursive: true, force: true });
    }
  }
}

function restoreValidatedBackup(
  authorityDirectory: string,
  backup: string,
): void {
  const discardedCanonical = `${authorityDirectory}.transaction-discarded-${process.pid}-${Date.now()}`;
  renameSync(authorityDirectory, discardedCanonical);
  try {
    renameSync(backup, authorityDirectory);
  } catch (restoreError) {
    renameSync(discardedCanonical, authorityDirectory);
    throw restoreError;
  }
  rmSync(discardedCanonical, { recursive: true, force: true });
}

export function prepareEvidenceWriterPreflight<T>(
  authorityDirectory: string,
  validateRecoveredAuthority: (directory: string) => void,
  assertCleanWriterTree: () => T,
): T {
  recoverEvidenceDirectoryTransaction(authorityDirectory, validateRecoveredAuthority);
  if (!existsSync(authorityDirectory)) {
    throw new Error(
      `Evidence authority directory is missing after transaction recovery: ${authorityDirectory}`,
    );
  }
  return assertCleanWriterTree();
}

export function replaceEvidenceDirectoryTransactionally(
  authorityDirectory: string,
  populateAndValidateStage: (stageDirectory: string) => void,
  beforeCanonicalInstall: (stageDirectory: string) => void = () => undefined,
): void {
  recoverEvidenceDirectoryTransaction(authorityDirectory);
  if (!existsSync(authorityDirectory)) {
    throw new Error(`Evidence authority directory is missing: ${authorityDirectory}`);
  }

  const parent = dirname(authorityDirectory);
  const stage = mkdtempSync(join(parent, `${basename(authorityDirectory)}${stageMarker}`));
  const backup = `${authorityDirectory}${backupSuffix}`;
  let canonicalMoved = false;
  try {
    cpSync(authorityDirectory, stage, { recursive: true });
    populateAndValidateStage(stage);
    beforeCanonicalInstall(stage);
    renameSync(authorityDirectory, backup);
    canonicalMoved = true;
    try {
      renameSync(stage, authorityDirectory);
    } catch (error) {
      renameSync(backup, authorityDirectory);
      canonicalMoved = false;
      throw error;
    }
    rmSync(backup, { recursive: true, force: true });
    canonicalMoved = false;
  } finally {
    if (existsSync(stage)) {
      rmSync(stage, { recursive: true, force: true });
    }
    if (canonicalMoved && !existsSync(authorityDirectory) && existsSync(backup)) {
      renameSync(backup, authorityDirectory);
    }
  }
}
