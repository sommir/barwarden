const PINNED_REPOSITORY = "https://github.com/bitwarden/clients.git";
const PINNED_COMMIT = "f47b6946e01aed474875789081966d311d5b8289";

export interface UpstreamRevision {
  readonly repositoryUrl: string;
  readonly commit: string;
}

export function parseUpstreamRevision(value: string): UpstreamRevision {
  const normalized = value.replace(/\r\n/g, "\n");
  const marker = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  const lines = marker.split("\n");

  if (lines.length !== 2 || lines.some((line) => line.trim() !== line || line.length === 0)) {
    throw new Error("Invalid upstream source marker");
  }

  return {
    repositoryUrl: lines[0]!,
    commit: lines[1]!,
  };
}

export function assertPinnedUpstreamRevision(value: string): UpstreamRevision {
  const revision = parseUpstreamRevision(value);

  if (revision.repositoryUrl !== PINNED_REPOSITORY || revision.commit !== PINNED_COMMIT) {
    throw new Error("Unexpected Bitwarden clients source revision");
  }

  return revision;
}
