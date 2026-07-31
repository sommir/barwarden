import { basename } from "node:path";

type EvidenceTestInfo = {
  outputPath(fileName: string): string;
  project: { name: string };
};

export function isAuthoritativeEvidenceWriter(
  testInfo: EvidenceTestInfo,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment.UPDATE_EVIDENCE === "true" && testInfo.project.name === "chromium";
}

export function evidenceCapturePath(
  testInfo: EvidenceTestInfo,
  authoritativePath: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return isAuthoritativeEvidenceWriter(testInfo, environment)
    ? authoritativePath
    : testInfo.outputPath(basename(authoritativePath));
}
