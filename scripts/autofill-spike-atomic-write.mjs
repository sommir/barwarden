import { renameSync, rmSync, writeFileSync } from "node:fs";

const defaultFileSystem = { renameSync, rmSync, writeFileSync };

export function writeJsonAtomically(path, value, fileSystem = defaultFileSystem) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  try {
    fileSystem.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fileSystem.renameSync(temporaryPath, path);
  } catch (error) {
    try {
      fileSystem.rmSync(temporaryPath, { force: true });
    } catch {
      // Preserve the original write or rename failure.
    }
    throw error;
  }
}
