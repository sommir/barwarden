const ansiPattern = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const summaryPattern = /(?:Running \d+ tests|Test Files|Tests\s+\d|\d+ (?:passed|skipped|failed)|modules transformed|Production bundle scan passed|test result:|Built application at:|Finished 1 bundle)/;

export function stripAnsi(output) {
  return output.replace(ansiPattern, "");
}

export function extractVerificationSummary(output) {
  return stripAnsi(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && summaryPattern.test(line))
    .slice(-16);
}

export function extractVerificationFailure(output) {
  const lines = stripAnsi(output).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const start = lines.findIndex((line) => /^(?:Error:|FAIL\b|Caused by:)/i.test(line));
  const fallback = start >= 0
    ? start
    : lines.findIndex((line) => /\b(?:failed|failure|timed out)\b/i.test(line));
  return fallback >= 0 ? lines.slice(fallback, fallback + 13) : [];
}
