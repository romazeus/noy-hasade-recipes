/**
 * Match a recipe's INGREDIENT LINE to a product the shop actually sells.
 *
 * 🔴 WHY THIS EXISTS. WordPress gives a recipe two things that never meet: a free-text
 * ingredient list (`ingredients.ingredients[].rows[].text`, 770 lines across the 67 live
 * recipes) and a FLAT list of product ids the merchant curated (`products_buy`, avg 14.7).
 * Nothing says which line is which product — the website renders them as two unrelated
 * blocks, and so did we. Joining them is what turns "read the recipe, then go find the
 * things" into "tap the line, it is in the basket".
 *
 * 🔴 IT IS A SUGGESTION LAYER, NEVER A PRICE. A wrong match adds the wrong product to a
 * basket, so every rule here is biased toward NOT matching: the head noun must agree, a
 * brand alone can never carry a match, and the caller is expected to show the product's
 * own name and picture next to the line so the shopper sees what they are adding. The
 * ingredient TEXT is always rendered verbatim — the match decorates it, never replaces it.
 *
 * The shape of the two strings is what makes this tractable: Hebrew ingredient lines and
 * Hebrew product names are both HEAD-INITIAL after the quantity is stripped —
 * "2 חצילים בינוניים" and "חציל בלאדי" both lead with the thing itself.
 */

import { buildStopWords, contentWords as sharedContentWords, stem } from '@/utils/hebrew';

/** Measure words and quantity nouns — never the thing being bought. */
const UNITS = [
  'כוסות', 'כוס', 'כפות', 'כף', 'כפיות', 'כפית', 'גרם', 'קג', 'קילו', 'קילוגרם',
  'מל', 'מיליליטר', 'ליטר', 'יחידות', 'יחידה', 'חבילות', 'חבילה', 'חבילת',
  'קופסאות', 'קופסה', 'קופסת', 'שקיות', 'שקית', 'שקיק', 'צרורות', 'צרור',
  'אריזות', 'אריזה', 'אריזת', 'סלסלת', 'סלסלה', 'מיכל', 'בקבוק', 'בקבוקים',
  'פחית', 'פחיות', 'מכל', 'גביע', 'גביעים',
  // 🔴 THE "FROM A …" FORMS, SPELLED OUT. `stem` deliberately strips only ו/ה/ב/ל, because
  // a מ- prefix rule would turn "מלפפון" into "לפפון" and "מנגו" into "נגו". So the handful
  // of measure words that genuinely appear with it are listed rather than derived.
  'מקופסת', 'מקופסה', 'משקית', 'מחבילה', 'מחבילת', 'מאריזת', 'מאריזה', 'מבקבוק', 'מכוס',
];

/**
 * Words that describe HOW MUCH, HOW PREPARED or HOW NICE — never WHAT. Dropping them is
 * what lets "1-2 חצילים יפים ומוצקים" reach "חציל".
 *
 * 🔴 `עלי`, `שיני`, `גרידת`, `ראש` and friends are here on purpose: they are PART-OF
 * words. "חופן עלי רוקולה" is bought as רוקולה, "5 שיני שום" as שום. Leaving them in
 * makes them the head noun and the line matches nothing.
 */
const MODIFIERS = new Set([
  ...UNITS,
  'חצי', 'רבע', 'שליש', 'שלושת', 'שני', 'שתי', 'כמה', 'מעט', 'קורט', 'חופן', 'קמצוץ',
  'לפי', 'הטעם', 'טעם', 'בערך', 'לערך', 'גדוש', 'גדושה', 'שטוחה', 'שטוח', 'מלאה', 'מלא',
  'טרי', 'טריה', 'טריים', 'טריות', 'קפוא', 'קפואה', 'קפואים', 'מיובש', 'מיובשת', 'מיובשים',
  'קצוץ', 'קצוצה', 'קצוצים', 'קצוצות', 'חתוך', 'חתוכה', 'חתוכים', 'חתוכות', 'פרוס', 'פרוסה',
  'פרוסים', 'פרוסות', 'מגורר', 'מגוררת', 'מגוררים', 'טחון', 'טחונה', 'טחונים', 'טחונות',
  'קלוף', 'קלופה', 'קלופים', 'קלופות', 'סחוט', 'סחוטה', 'מבושל', 'מבושלת', 'מבושלים',
  'קלוי', 'קלויה', 'קלויים', 'קלויות', 'צלוי', 'מומס', 'מומסת', 'רך', 'רכה', 'קר', 'קרה',
  'קרים', 'חם', 'חמה', 'גדול', 'גדולה', 'גדולים', 'גדולות', 'קטן', 'קטנה', 'קטנים', 'קטנות',
  'בינוני', 'בינונית', 'בינוניים', 'בינוניות', 'יפה', 'יפים', 'יפות', 'מוצק', 'מוצקים',
  'שטוף', 'שטופים', 'נקי', 'נקיים', 'איכותי', 'איכותית', 'משובח', 'משובחת',
  'של', 'עם', 'או', 'גם', 'ללא', 'בלי', 'בתוספת', 'לקישוט', 'להגשה', 'להגשת', 'לתיבול',
  'אפשר', 'להוסיף', 'מומלץ', 'לפזר', 'בגודל', 'כמות', 'לאורכם', 'לאורך', 'לרוחב',
  'עלי', 'עלה', 'עלים', 'שיני', 'שן', 'גרידת', 'גרידה', 'ראש', 'ראשי', 'תוך', 'תוכן',
  'חלקים', 'חלק', 'לפחות', 'עד', 'בין', 'לבין', 'ועוד', 'ועד',
  // 🔴 MEASURED, NOT GUESSED. Each of these was the HEAD NOUN of a line that named a
  // product the shop sells and matched nothing — "8 גבעולי בצל ירוק" against "בצל ירוק",
  // "1 מארז אספרגוס" against "אספרגוס". A part word or a packaging word standing where the
  // subject should be is the single largest source of misses in the live corpus.
  'גבעול', 'גבעולי', 'גבעולים', 'מארז', 'מארזי', 'מיקרו', 'זן', 'זני', 'קלח', 'קלחי',
  'פלח', 'פלחי', 'פרוסת', 'פרוסות', 'כדורי', 'כדור', 'ענף', 'ענפי', 'צרורות',
]);

/** Brand words. A brand ALONE can never carry a match — "אפרסקים של נוי השדה" must not
 *  become "שמן זית כתית מעולה נוי השדה", which is exactly what a naive matcher does. */
const BRAND_WORDS = new Set([
  'נוי', 'השדה', 'יד', 'מרדכי', 'שטיבל', 'תנובה', 'טרה', 'שטראוס', 'אסם', 'עלית',
  'סוגת', 'ויסוצקי', 'מולר', 'גד', 'הירדן', 'גדות', 'פרג', 'מולי', 'קוואקר',
  'טעם', 'הטבע', 'בלינה', 'מוטי', 'נטורלה', 'הימלאיה', 'ברילה', 'אולמקו',
]);

/**
 * 🔴 THINGS NOBODY BUYS FOR A RECIPE. Tap water is the whole reason this set exists: the
 * catalogue sells bottled mineral water, so "חצי כוס מים קרים" scored 1.25 against
 * "מים מינרלים טבעיים מוגזים" on six separate lines — a perfect match to a product no
 * cook wants. A blocked head noun ends the line before any scoring happens.
 *
 * 🔴 COMPARED AS STEMS, not as written. `stem` folds the final letters first, so "מים"
 * arrives as "מימ" and a set holding the plain spelling never fires — which is exactly
 * how this gate silently did nothing the first time it was written.
 */
const NEVER_A_PRODUCT_WORDS = ['מים', 'מי', 'קרח', 'אוויר', 'אויר'];

// 🔴 `stem`, `FINALS` AND `contentWords` MOVED TO `utils/hebrew.ts` (2026-09-07) —
// moved, not copied. The search engine needs the identical fold, and two copies of a
// Hebrew stemmer drift the day one of them is fixed. What lives here is what is about
// RECIPES: the unit words, the modifiers, the brands, the scoring. The fold is not.
//
// The one shape change: `contentWords` now takes its stop-word set as a parameter,
// because "קצוץ" and "לפי הטעם" are recipe vocabulary and a search query has none.
// `buildStopWords` builds the literal and stemmed halves together, which is what the
// two-pass filter below has always needed.
const RECIPE_STOP_WORDS = buildStopWords(MODIFIERS);

/** Recipe-line words, with the measure/modifier vocabulary removed. */
function contentWords(text: string): string[] {
  return sharedContentWords(text, RECIPE_STOP_WORDS);
}

/** `NEVER_A_PRODUCT_WORDS`, folded through `stem` so the gate compares like with like. */
const NEVER_A_PRODUCT = new Set(NEVER_A_PRODUCT_WORDS.map(stem));

/** Everything the matcher needs about one candidate product. */
export type MatchCandidate = { id: string; name: string };

/** A scored, accepted match. `score` is only meaningful for ranking within one line. */
export type IngredientMatch = { id: string; name: string; score: number };

/**
 * What one ingredient line resolved to.
 *
 * 🔴 A LIST, NOT ONE ANSWER — and that is a deliberate change from returning `null` on a tie
 * (Rom, 2026-08-28: *"לדעתי האופציות בחירה בין המוצרים היא טובה יותר"*). Measured across the
 * 67 live recipes, **59.8% of everything landing in the "מצרכים שתוכלו לרכוש פה" rail was a
 * line the shop sells SEVERAL products for** — "8 תפוחי אדמה" against five potatoes. Dropping
 * those to a rail at the bottom of the page hid a real choice behind a scroll; offering them
 * on the line itself is the same information where the reader already is.
 *
 *   length 0   nothing to buy — plain text
 *   length 1   one confident product
 *   length 2+  the shop sells several; the reader picks
 */
export type IngredientMatches = readonly IngredientMatch[];

/**
 * Inverse document frequency over the candidate pool, so a distinctive word ("רוקולה")
 * outweighs a ubiquitous one ("שמן", "גבינה") instead of every cheese matching every
 * cheese. Built once per recipe by `buildMatcher`.
 */
function idfOf(df: number, n: number): number {
  return Math.log((n + 1) / (df + 0.5));
}

/**
 * 🔴 A WORD PRESENT IN NO CANDIDATE MUST NOT OUTWEIGH ONE PRESENT IN EXACTLY ONE. Raw IDF
 * gives an unseen word the LARGEST weight of all, so "1-2 חצילים יפים ומוצקים" scored
 * 0.45 against "חציל בלאדי" — the head noun agreed perfectly and an adjective nobody sells
 * carried 64% of the denominator. Clamped at the df=1 value, the same line scores 0.78.
 */
function clampedIdf(df: number, n: number): number {
  return Math.min(idfOf(df, n), idfOf(1, n));
}

/** ACCEPT THRESHOLD — tuned on all 770 live ingredient lines; see `matchIngredient.test.ts`. */
const ACCEPT = 0.55;
/**
 * The bar for the CATALOG-WIDE tier. Searching 1712 products instead of the ~15 the
 * merchant chose means a plausible-looking wrong answer is always available, so this tier
 * additionally demands that the product LEAD with the ingredient's head noun — which is
 * what separates "בשר טחון" → a mince from "בשר טחון" → an instant noodle pot *flavoured*
 * with beef, the one bad match the looser tier produced.
 */
const ACCEPT_STRICT = 0.7;
/** A second candidate this close to the winner means the line offers a CHOICE, not an answer. */
const AMBIGUITY_MARGIN = 0.04;
/**
 * How many options one line may offer. Past this the row stops being a choice and becomes a
 * catalogue. It DOES bite — the shop stocks more than six potatoes — so `onOverflow` reports
 * every time it does rather than letting a partial list read as the whole shelf.
 */
const MAX_CHOICES = 6;
/** Shared empty result, so a no-match costs no allocation on 770 lines. */
const NONE: IngredientMatches = [];
/** How much more the line's own subject counts than the words describing it. */
const HEAD_WEIGHT = 2;

export type Matcher = (line: string) => IngredientMatches;

export type MatcherOptions = {
  /**
   * Called when a line had MORE candidates than a row can show. Exists so the cap can never
   * be silent — a probe or a report can count them rather than a partial list looking whole.
   */
  onOverflow?: (line: string, total: number) => void;
  /**
   * Demand a head-INITIAL product and a higher score. Use for any pool the merchant did
   * not curate for this specific dish — see `ACCEPT_STRICT`.
   */
  strict?: boolean;
};

/**
 * Build a matcher closed over ONE recipe's candidate products.
 *
 * 🔴 THE POOL IS THE RECIPE'S OWN `products_buy`, NEVER THE WHOLE CATALOG. Searching 1712
 * products for "מלח" finds a dozen defensible answers and no correct one; searching the
 * ~15 the merchant chose for THIS dish makes the head-noun gate decisive.
 */
export function buildMatcher(
  candidates: readonly MatchCandidate[],
  { strict = false, onOverflow }: MatcherOptions = {},
): Matcher {
  const docs = candidates.map((c) => ({ c, words: contentWords(c.name) }));
  const df = new Map<string, number>();
  for (const d of docs) for (const w of new Set(d.words)) df.set(w, (df.get(w) ?? 0) + 1);
  const n = Math.max(1, docs.length);
  const idf = (w: string) => clampedIdf(df.get(w) ?? 0, n);

  return (line: string): IngredientMatches => {
    const want = contentWords(line);
    if (!want.length) return NONE;
    const wantSet = new Set(want);
    // The head noun is the first NON-BRAND content word — "שמן זית של נוי השדה" leads
    // with שמן, and "אפרסקים של נוי השדה" with אפרסק, which is the whole point.
    const head = want.find((w) => !BRAND_WORDS.has(w));
    if (!head || NEVER_A_PRODUCT.has(head)) return NONE;

    /**
     * 🔴 THE HEAD NOUN COUNTS DOUBLE, on both sides of the ratio. Weighing every content
     * word equally makes a line's own subject no more important than a packaging word:
     * "חומוס מקופסת שימורים" scored exactly 0.5 against "גרגרי חומוס בקופסה" — the right
     * product, rejected because "שימורים" is half the sentence and the shop does not put
     * it in the name.
     */
    const weight = (w: string) => (BRAND_WORDS.has(w) ? 0 : idf(w) * (w === head ? HEAD_WEIGHT : 1));
    const totalMass = want.reduce((s, w) => s + weight(w), 0);
    if (totalMass <= 0) return NONE;

    const scored: IngredientMatch[] = [];
    for (const { c, words } of docs) {
      const have = new Set(words);
      const prodHead = words.find((w) => !BRAND_WORDS.has(w));
      const headOk = strict
        ? !!prodHead && (prodHead === head || sharesPrefix(prodHead, head))
        : have.has(head) || words.some((w) => sharesPrefix(w, head));
      if (!headOk) continue;

      let mass = 0;
      for (const w of wantSet) {
        if (BRAND_WORDS.has(w)) continue;
        if (have.has(w)) mass += weight(w);
        else if (words.some((p) => sharesPrefix(p, w))) mass += weight(w) * 0.75;
      }
      let score = mass / totalMass;
      // The product's OWN head agreeing is the strongest single signal there is.
      if (prodHead && (prodHead === head || sharesPrefix(prodHead, head))) score *= 1.25;
      // A brand named in BOTH is a real confirmation — but only ever a bonus.
      if (want.some((w) => BRAND_WORDS.has(w) && have.has(w))) score += 0.1;
      scored.push({ id: c.id, name: c.name, score });
    }
    if (!scored.length) return NONE;
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (best.score < (strict ? ACCEPT_STRICT : ACCEPT)) return NONE;
    // 🔴 TWO EQUALLY GOOD ANSWERS IS STILL NOT ONE ANSWER — it is now a CHOICE. This used to
    // return `null`, which was right about the uncertainty and wrong about what to do with
    // it: "גבינה" against a recipe carrying four cheeses must not guess, but the reader can.
    // Everything within the margin of the winner comes back, in order.
    const ties = scored.filter((c) => best.score - c.score < AMBIGUITY_MARGIN);
    if (ties.length <= 1) return [best];
    // 🔴 A CHOICE IS ONLY OFFERED OUT OF THE MERCHANT'S OWN LIST. In `strict` mode the pool is
    // the whole 1700-product catalog, where a tie is not "the shop stocks three of these" but
    // "we are guessing, several times" — "רוטב סילאן" came back as two tomato sauces and a
    // cream sauce, all of them tied on the word רוטב alone. A curated tie is an offer; a
    // catalog-wide tie is noise, and noise is what the ambiguity guard exists to refuse.
    if (strict) return NONE;
    // 🔴 AND A CAP THAT BITES SAYS SO. Truncating to N silently would present a partial list
    // as if it were the whole shelf; the caller is told instead (`docs/RECIPES.md`).
    if (ties.length > MAX_CHOICES) {
      onOverflow?.(line, ties.length);
      return ties.slice(0, MAX_CHOICES);
    }
    return ties;
  };
}

/** Prefix agreement on stems long enough for it to mean something. */
function sharesPrefix(a: string, b: string): boolean {
  if (a.length < 4 || b.length < 4) return false;
  return a.startsWith(b) || b.startsWith(a);
}
