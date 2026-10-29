// Word error rate: (substitutions + deletions + insertions) / reference words, after normalizing both texts
// so formatting differences ("40" vs "forty", "Node.js" vs "node js", "HashMap" vs "hash map", "ms" vs
// "milliseconds", commas) are not counted as errors.

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function numberToWords(n: number): string {
  if (n < 20) return ONES[n]!;
  if (n < 100) return [TENS[Math.floor(n / 10)], n % 10 ? ONES[n % 10] : ''].filter(Boolean).join(' ');
  if (n < 1000)
    return [ONES[Math.floor(n / 100)], 'hundred', n % 100 ? numberToWords(n % 100) : ''].filter(Boolean).join(' ');
  for (const [size, name] of [
    [1e9, 'billion'],
    [1e6, 'million'],
    [1e3, 'thousand'],
  ] as const) {
    if (n >= size) {
      const rest = n % size;
      return [numberToWords(Math.floor(n / size)), name, rest ? numberToWords(rest) : ''].filter(Boolean).join(' ');
    }
  }
  return String(n);
}

export function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/(\d),(\d{3})/g, '$1$2') // 1,000 -> 1000
    .replace(/(\d)\s*ms\b|\bms\b/g, (_m, d: string | undefined) => `${d ?? ''} milliseconds`)
    .replace(/(\d+(?:\.\d+)?)\s*%/g, '$1 percent')
    .replace(/\d+\.\d+/g, (d) => d.replace('.', ' point '))
    .replace(/\d+/g, (d) => (d.length <= 12 ? numberToWords(Number(d)) : d))
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ') // punctuation, hyphens, dots in "node.js"
    .replace(/\b(okay)\b/g, 'ok')
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter(Boolean);
}

/** Splits a word in one text that is two adjacent words joined in the other ("hashmap" vs "hash map"). */
function splitCompounds(words: string[], other: string[]): string[] {
  const joined = new Map<string, [string, string]>();
  for (let i = 0; i + 1 < other.length; i++) joined.set(other[i]! + other[i + 1]!, [other[i]!, other[i + 1]!]);
  return words.flatMap((w) => joined.get(w) ?? [w]);
}

export type WerResult = { wer: number; errors: number; referenceWords: number };

export function wordErrorRate(reference: string, hypothesis: string): WerResult {
  const rawRef = normalizeWords(reference);
  const rawHyp = normalizeWords(hypothesis);
  const hyp = splitCompounds(rawHyp, rawRef);
  const ref = splitCompounds(rawRef, rawHyp);
  // Levenshtein distance over words, one row at a time.
  let prev = Array.from({ length: hyp.length + 1 }, (_, j) => j);
  for (let i = 1; i <= ref.length; i++) {
    const row = [i];
    for (let j = 1; j <= hyp.length; j++) {
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  const errors = prev[hyp.length]!;
  return { wer: ref.length ? errors / ref.length : hyp.length ? 1 : 0, errors, referenceWords: ref.length };
}
