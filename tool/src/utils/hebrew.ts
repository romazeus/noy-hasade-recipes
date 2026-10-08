/**
 * The Hebrew text layer — folding, tokenising, and the two ways a shopper's
 * Hebrew arrives WRONG.
 *
 * 🔴 THIS WAS EXTRACTED FROM `data/mappers/matchIngredient.ts`, NOT COPIED FROM IT
 * (2026-09-07). `stem` and `contentWords` were written there for the recipe →
 * product join and proven on all 770 live ingredient lines; the search engine needs
 * exactly the same folding, and a second copy would drift the day one of them was
 * fixed. The matcher now imports them from here and owns none of them.
 *
 * `contentWords` gained ONE parameter in the move — the stop-word set — because the
 * matcher's list is about recipes ("קצוץ", "לפי הטעם", "חופן") and a search query
 * has no such vocabulary. Nothing else changed; `matchIngredient.test.ts` is what
 * proves that, and it was green before and after.
 *
 * 🔴 WHAT THIS FILE IS NOT: a morphological analyser. It is a fold — a lossy,
 * deterministic mapping that makes two spellings of the same thing compare equal. It
 * happily maps words that are not related (`מים` → `מימ`), which is harmless for a
 * comparison and would be nonsense as a dictionary.
 */

/**
 * Final forms → their medial twins. Applied LAST, and the ordering is load-bearing:
 * see `stem`.
 */
const FINALS: Record<string, string> = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };

/** Fold ך ם ן ף ץ to כ מ נ פ צ, so two already-equal stems compare equal. */
export function foldFinals(w: string): string {
  return w.replace(/[ךםןףץ]/g, (c) => FINALS[c] ?? c);
}

const MEDIAL_TO_FINAL: Record<string, string> = { 'כ': 'ך', 'מ': 'ם', 'נ': 'ן', 'פ': 'ף', 'צ': 'ץ' };

/**
 * Re-spell a word's LAST letter in its final form — the inverse of `foldFinals`,
 * applied only where Hebrew actually applies it.
 *
 * 🔴 IT IS WHAT MAKES A GENERATED SINGULAR A REAL WORD. Slicing `ים` off `מלפפונים`
 * leaves `מלפפונ`, which nobody has ever written and which the index cannot match;
 * the word being looked for is `מלפפון`. `foldFinals` is for COMPARING two strings,
 * this is for PRODUCING one that will be sent to a search engine, and confusing the
 * two silently yields a variant that always returns zero.
 */
export function toFinalForm(w: string): string {
  if (!w) return w;
  const last = w[w.length - 1];
  const fin = MEDIAL_TO_FINAL[last];
  return fin ? w.slice(0, -1) + fin : w;
}

/**
 * Fold a Hebrew word to a comparable stem.
 *
 * 🔴 THE ORDER OF THESE THREE STEPS IS THE WHOLE FUNCTION, and getting it wrong is
 * silent. Folding the final letters FIRST turns "אפרסקים" into "אפרסקימ", after which
 * the plural rule looks for a suffix that is no longer spelled "ים" and never fires —
 * so the word stays plural, never equals the product's "אפרסק", and the line quietly
 * matches nothing. Morphology runs on the word AS WRITTEN; the final-letter fold is
 * last, purely to make two already-equal stems compare equal.
 *
 * 🔴 AND THE PREFIX SET IS DELIBERATELY THE FOUR SAFE PARTICLES, not all seven. "מ",
 * "ש" and "כ" open real words — strip them and "שימורים" becomes "ימור", "מלח"
 * becomes "לח".
 */
export function stem(raw: string): string {
  let w = raw;
  // 1 — plural and construct, on the word as written.
  if (w.length >= 5 && w.endsWith('יות')) w = w.slice(0, -3) + 'ה';
  else if (w.length >= 5 && w.endsWith('יים')) w = w.slice(0, -3);
  else if (w.length >= 4 && w.endsWith('ים')) w = w.slice(0, -2);
  else if (w.length >= 4 && w.endsWith('ות')) w = w.slice(0, -2) + 'ה';
  // Construct state: גבינת → גבינה, עגבניית → עגבניה.
  else if (w.length >= 4 && w.endsWith('ת')) w = w.slice(0, -1) + 'ה';
  // 🔴 THE CONSTRUCT PLURAL — "ביצי חופש" is how the shop names what a recipe calls
  // "2 ביצים", and the two folded to `ביצי` and `ביצ`, one letter apart and never equal.
  // Both sides fold the same way, so an adjective ending in yod (`יווני`, `בלסמי`) losing it
  // is harmless: it loses it on the product too.
  else if (w.length >= 4 && w.endsWith('י')) w = w.slice(0, -1);
  // 2 — one attached particle, only when a real word survives.
  if (w.length >= 4 && /^[והבל]/.test(w)) w = w.slice(1);
  // 3 — a trailing ה is noise for comparison ("עגבניה" vs "עגבני"), then the finals.
  if (w.length >= 4 && w.endsWith('ה')) w = w.slice(0, -1);
  return foldFinals(w);
}

/**
 * Strip niqqud, quotes, parentheticals, digits and punctuation, leaving words.
 *
 * 🔴 A PARENTHETICAL IS A SYNONYM HERE, NOT AN ASIDE — so its contents are KEPT. The
 * shop names products the same way: "עלי סלק (מנגולד)" is a product AND an ingredient
 * line, and stripping the bracket threw away the only word the two had in common.
 *
 * 🔴 AND THE GERESH IS REMOVED, WHICH IS THE SEARCH-SIDE POINT OF THIS FUNCTION.
 * `׳` (U+05F3) is a word TERMINATOR to Algolia, so `קוטג׳` and `קוטג` are two
 * different tokens to the index and identical to a shopper. Folding both to `קוטג`
 * here is what lets the local engine answer either spelling with the same products.
 */
export function cleanHebrewText(text: string): string {
  return text
    .replace(/[֑-ׇ]/g, '')
    .replace(/[()]/g, ' ')
    .replace(/["'׳״`]/g, ' ')
    .replace(/[0-9]+([.,/\-–][0-9]+)*\s*%?/g, ' ')
    .replace(/[^֐-׿a-zA-Z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The stemmed content words of a piece of text.
 *
 * 🔴 THE STOP-WORD SET IS APPLIED TWICE — once as written, once on the STEM. This was
 * measured in the recipe matcher and it generalises: "ומוצקים" carries a conjunctive
 * vav that no list can enumerate, so it survives a literal filter and then contributes
 * real weight to a line that means nothing by it. Stemming first folds it to "מוצק",
 * which the list does hold. A caller that passes stop words must therefore pass the
 * STEMMED set too — `buildStopWords` builds both halves from one list.
 */
export function contentWords(
  text: string,
  stopWords?: { literal: ReadonlySet<string>; stems: ReadonlySet<string> },
): string[] {
  const cleaned = cleanHebrewText(text);
  if (!cleaned) return [];
  const literal = stopWords?.literal;
  const stems = stopWords?.stems;
  return cleaned
    .split(' ')
    .filter((w) => w.length >= 2 && !literal?.has(w))
    .map(stem)
    .filter((w) => w.length >= 2 && !stems?.has(w));
}

/** Both halves of a stop-word set, so a caller cannot supply one and forget the other. */
export function buildStopWords(words: Iterable<string>): {
  literal: ReadonlySet<string>;
  stems: ReadonlySet<string>;
} {
  const literal = new Set(words);
  return { literal, stems: new Set([...literal].map(stem)) };
}

/**
 * 🔴 CANDIDATE SPELLINGS OF THE SAME WORD — the answer to the plural gap, and
 * deliberately NOT another fold.
 *
 * Measured on the live index 2026-09-06: **8 of 18 common produce singular/plural
 * pairs return a completely different top set.** `מלפפונים` returns pickles and no
 * cucumber; `ביצים` returns egg PASTA; `תפוחים` returns juice. Algolia ships no
 * Hebrew plural dictionary, so `ignorePlurals` is a measured no-op here — the index
 * cannot join them and neither can a stemmer alone.
 *
 * A FOLD cannot fix this and a GENERATOR can. `stem` maps both spellings to one key
 * and is asked to be right in one shot; this returns the handful of spellings the
 * same noun plausibly takes, and the caller tries them — against Algolia in one
 * multi-query, or against the local index as extra lookups. A wrong candidate simply
 * matches nothing, which costs nothing.
 *
 * 🔴 IT IS NOT A DICTIONARY AND WILL PRODUCE NON-WORDS. `בצל` yields `בצלה`, which
 * nobody sells. That is the design: an unsold spelling returns zero hits and
 * disappears, whereas a missing spelling returns the wrong department.
 */
export function hebrewVariants(word: string): string[] {
  const w = cleanHebrewText(word);
  if (w.length < 2) return [];
  const out = new Set<string>([w]);
  const add = (v: string) => {
    if (v.length >= 2) out.add(v);
  };

  if (w.length >= 5 && w.endsWith('יות')) {
    const base = w.slice(0, -3);
    add(base + 'ה');
    add(base + 'יה');
  } else if (w.length >= 4 && w.endsWith('ים')) {
    // The plural a shopper types. Both singulars are generated because Hebrew
    // spells them either way and the catalogue is the arbiter: ביצים → ביצה,
    // בצלים → בצל.
    const base = w.slice(0, -2);
    // 🔴 THE FINAL FORM FIRST — `מלפפונים` minus `ים` is `מלפפונ`, and the word is
    // `מלפפון`. Emitting only the raw slice is a variant that can never match.
    add(toFinalForm(base));
    add(base);
    add(base + 'ה');
  } else if (w.length >= 4 && w.endsWith('ות')) {
    const base = w.slice(0, -2);
    add(base + 'ה');
    add(base);
  } else {
    // A singular: offer the two plurals. `בננה` → `בננות`, `בצל` → `בצלים`.
    const base = w.endsWith('ה') ? w.slice(0, -1) : w;
    add(base + 'ים');
    add(base + 'ות');
    if (w.endsWith('ה')) add(base);
  }
  return [...out];
}

/**
 * 🔴 HEBREW TYPED ON AN ENGLISH KEYBOARD RETURNS NOTHING, AND IT IS THE COMMONEST
 * WAY A GROCERY SEARCH FAILS. `jkc` is `חלב` — the most searched word in a
 * supermarket — and it returns **0 results against 363**. The phone's keyboard is
 * whichever one it was left on, and a shopper who starts typing does not look.
 *
 * The table is the standard Hebrew PC/iOS layout. Only the 22 letters are mapped:
 * `,` `.` `;` `/` also carry Hebrew letters, but including them would rewrite ordinary
 * punctuation inside a real query, and no product name needs them.
 */
const EN_TO_HE: Record<string, string> = {
  q: '/', w: "'", e: 'ק', r: 'ר', t: 'א', y: 'ט', u: 'ו', i: 'ן', o: 'ם', p: 'פ',
  a: 'ש', s: 'ד', d: 'ג', f: 'כ', g: 'ע', h: 'י', j: 'ח', k: 'ל', l: 'ך',
  z: 'ז', x: 'ס', c: 'ב', v: 'ה', b: 'נ', n: 'מ', m: 'צ',
};

const HE_TO_EN: Record<string, string> = Object.fromEntries(
  Object.entries(EN_TO_HE)
    .filter(([, he]) => /[֐-׿]/.test(he))
    .map(([en, he]) => [he, en]),
);

/**
 * Latin letters read as the Hebrew keys they sit on. Returns null when the text is
 * not entirely Latin letters and spaces — a mixed query is a deliberate one.
 */
export function latinToHebrewLayout(text: string): string | null {
  const t = text.toLowerCase();
  if (!/^[a-z ]+$/.test(t)) return null;
  let out = '';
  for (const ch of t) {
    if (ch === ' ') {
      out += ' ';
      continue;
    }
    const he = EN_TO_HE[ch];
    // The four punctuation keys are unmapped on purpose (see above); a query that
    // needs one of them is not a layout mistake we can repair.
    if (!he || !/[֐-׿]/.test(he)) return null;
    out += he;
  }
  return out;
}

/**
 * The mirror: Hebrew letters read as the Latin keys they sit on, for a shopper who
 * typed an English brand with the Hebrew keyboard on ("דקךקא" for "coffee"'s
 * neighbours). Rarer than the other direction and just as cheap.
 */
export function hebrewToLatinLayout(text: string): string | null {
  if (!/^[֐-׿ ]+$/.test(text)) return null;
  let out = '';
  for (const ch of text) {
    if (ch === ' ') {
      out += ' ';
      continue;
    }
    const en = HE_TO_EN[ch];
    if (!en) return null;
    out += en;
  }
  return out;
}
