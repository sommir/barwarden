export interface DocumentSearchMatch {
  readonly start: number;
  readonly end: number;
}

export interface DocumentSegment {
  readonly text: string;
  readonly matchIndex: number | null;
}

export function findDocumentMatches(
  text: string,
  query: string,
  limit = 500,
): readonly DocumentSearchMatch[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length === 0 || limit <= 0) {
    return [];
  }
  const haystack = text.toLocaleLowerCase();
  const matches: DocumentSearchMatch[] = [];
  for (let start = 0; matches.length < limit;) {
    const index = haystack.indexOf(needle, start);
    if (index < 0) {
      break;
    }
    matches.push({ start: index, end: index + needle.length });
    start = index + needle.length;
  }
  return matches;
}

export function segmentDocument(
  text: string,
  matches: readonly DocumentSearchMatch[],
): readonly DocumentSegment[] {
  const segments: DocumentSegment[] = [];
  let cursor = 0;
  matches.forEach((match, matchIndex) => {
    if (cursor < match.start) {
      segments.push({ text: text.slice(cursor, match.start), matchIndex: null });
    }
    segments.push({ text: text.slice(match.start, match.end), matchIndex });
    cursor = match.end;
  });
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), matchIndex: null });
  }
  return segments;
}
