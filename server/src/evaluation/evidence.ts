// Checks that the evaluator's quotes really come from the transcript. Small models sometimes "quote" words the
// candidate never said; those quotes are flagged as unsupported in the report (R7).
import { normalizeWords } from '@shared/text/wer';

/** Share of a quote's words that must appear, in order, within a stretch of the transcript. */
const MIN_MATCH = 0.8;

function lcs(a: string[], b: string[]): number {
  let prev = new Array<number>(b.length + 1).fill(0);
  for (const wa of a) {
    const row = [0];
    for (let j = 1; j <= b.length; j++) row[j] = wa === b[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, row[j - 1]!);
    prev = row;
  }
  return prev[b.length]!;
}

/**
 * True when the quote matches the transcript allowing small differences (dropped words, a word changed),
 * since the model often tidies quotes slightly. Very short quotes must match exactly.
 */
export function quoteSupported(quote: string, transcript: string): boolean {
  const q = normalizeWords(quote.replace(/\.{3}|…/g, ' '));
  const t = normalizeWords(transcript);
  if (!q.length || !t.length) return false;
  if (q.length <= 2) {
    return t.some((_, i) => q.every((w, k) => t[i + k] === w));
  }
  const window = Math.ceil(q.length * 1.3);
  for (let start = 0; start < t.length; start++) {
    if (t[start] !== q[0] && t[start] !== q[1]) continue; // a match starts at one of the first two words
    if (lcs(q, t.slice(start, start + window)) / q.length >= MIN_MATCH) return true;
  }
  return false;
}
