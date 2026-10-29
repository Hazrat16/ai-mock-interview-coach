// Splits interviewer text into sentences so the first one can be spoken while the rest is synthesized.
// Splitting too eagerly sounds choppy ("e.g." as its own sentence); not splitting delays the first audio.

const ABBREVIATIONS = new Set(['e.g', 'i.e', 'etc', 'vs', 'cf', 'approx', 'a.m', 'p.m', 'u.s', 'u.k', 'ph.d']);
// Only when capitalized: "3.5 ms." ends a sentence, "Ms. Lee" does not.
const TITLES = new Set(['Mr', 'Mrs', 'Ms', 'Dr', 'Prof', 'Sr', 'Jr', 'St', 'Inc', 'Ltd', 'Co', 'Corp', 'No', 'Fig']);

/** Sentences longer than this are split again at a comma or semicolon, so the first audio stays quick. */
const MAX_CHARS = 220;

// Sentence-ending punctuation, optional closing quotes or brackets, then whitespace.
const BOUNDARY = /([.!?…]+)(["')\]’”]*)\s+/g;

function endsWithAbbreviation(before: string) {
  const word = /([A-Za-z][A-Za-z.]*)$/.exec(before)?.[1];
  if (!word) return false;
  // A single capital letter is an initial ("J. Smith"); "I." at the end of a sentence is rare in questions.
  if (/^[A-Z]$/.test(word)) return true;
  return TITLES.has(word) || ABBREVIATIONS.has(word.toLowerCase());
}

function splitLong(sentence: string): string[] {
  if (sentence.length <= MAX_CHARS) return [sentence];
  const cut = Math.max(sentence.lastIndexOf(', ', MAX_CHARS), sentence.lastIndexOf('; ', MAX_CHARS));
  if (cut < MAX_CHARS / 3) return [sentence]; // no good place; one long sentence is better than a broken word
  return [sentence.slice(0, cut + 1), ...splitLong(sentence.slice(cut + 2).trim())];
}

export function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  for (const paragraph of text.split(/\n\s*\n|\n(?=\s*[-*\d])/)) {
    const flat = paragraph.replace(/\s+/g, ' ').trim();
    let start = 0;
    for (const m of flat.matchAll(BOUNDARY)) {
      const end = m.index + m[1]!.length + m[2]!.length;
      const next = flat[m.index + m[0].length];
      if (m[1] === '.' && endsWithAbbreviation(flat.slice(start, m.index))) continue;
      if (next && /[a-z]/.test(next)) continue; // "etc. and", "e.g. a cache"
      sentences.push(flat.slice(start, end));
      start = m.index + m[0].length;
    }
    if (start < flat.length) sentences.push(flat.slice(start));
  }
  return sentences.flatMap((s) => splitLong(s.trim())).filter((s) => /[\p{L}\p{N}]/u.test(s));
}
