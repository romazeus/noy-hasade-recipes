/**
 * THE RULES A SERVED FILE MUST PASS, and the live checks that feed the daily run.
 *
 * 🔴 THEY DO NOT DECIDE, THEY STOP. Two judges decide every link (`judge.ts`); these exist so a
 * slip of judgment meets a machine first, and every error makes its line plain text. Each one is a
 * defect measured on the live catalogue on 2026-10-07:
 *
 *   member-household   ביצת הפלא (13739) sits in 276 לבית ולמטבח and 327 מתכלה ואקולוגי, AND in
 *                      fresh fruit and garden vegetables (16, 17, 35, 55): "only in a household
 *                      root" would have let it through, so ANY household root fails
 *   member-category    and a member must sit in one of its concept's own categories (eggs: 284)
 *   member-name        "ממרח חמאה ללא מלח" was linked to a salt line, "רוטב כוסברה וליים" is the
 *                      sauce Rom named: a member's name leads with the ingredient, or says why not
 *   member-provides    a pack size typed by hand is checked against the digits the shop prints
 *
 * `error` makes its line, member or recipe plain text (`buildServed`); `warn` goes in the run's report.
 */
import { stem, cleanHebrewText } from '@/utils/hebrew';
import type { Amount, ApprovedFile, ConceptRecord, Need, Provides, SaleModel } from './schema';

/** The two roots that hold things for the home, not for the pot (measured 2026-10-07). */
export const HOUSEHOLD_ROOTS: readonly number[] = [276, 327];
/** A line whose computed cost passes this is shown to a person before it may stand. */
export const LINE_PRICE_CEILING = 150;
/**
 * 🔴 RAISE THIS WITH EVERY CHANGE TO WHAT `checkRules` FINDS. A version stores the keys of its
 * findings and the next save blocks only on NEW errors; a rule added later would otherwise make
 * every finding it has on the stored data "new", and no save could ever pass, the fix included
 * (review round 4, 2026-10-08). Since the panel was retired (2026-10-08) the rules run whole on
 * every build, so this is a change marker the pin test (`rulesVersion.test.ts`) holds still.
 */
export const RULES_VERSION = 6;

/** One live product, as `POST /products` returns it, reduced to what the rules read. */
export type CatalogProduct = {
  id: string;
  name: string;
  categories: number[];
  pricingType: string;
  isPack: boolean;
  isHalf: boolean;
  showPriceBy: string;
  /** Kilos per sale unit as the feed prints it, or null. */
  weight: number | null;
  price: number;
  /** The price when no sale runs (`regular_price`); 0 when the feed gives none. */
  regularPrice?: number;
  inStock: boolean;
};

/** One live recipe: its key (`normalizeSlug`), post id, title and its lines (`plainText`). */
export type LiveRecipe = { slug: string; postId?: number; title: string; lines: string[] };

export type Finding = {
  level: 'error' | 'warn';
  code: string;
  where: string;
  message: string;
  /** What the finding is about, by key, so a person's screen can name it in Hebrew. */
  concept?: string;
  product?: string;
  recipe?: string;
  line?: string;
  /**
   * A change, before and after (a name, or a sale model as JSON): the person acknowledging a rename
   * reads what it was and what it is (review round 5: only the new name was shown).
   */
  was?: string;
  now?: string;
};

type About = Pick<Finding, 'concept' | 'product' | 'recipe' | 'line' | 'was' | 'now'>;

/** A sale model as the four fields the rules read, for `Finding.was` / `Finding.now`. */
export const saleJson = (s: SaleModel): string =>
  JSON.stringify({ pricingType: s.pricingType, isPack: s.isPack, isHalf: s.isHalf, showPriceBy: s.showPriceBy });

/** How a caller wants the catalogue judged. The defaults are the offline and daily checks'. */
export type RuleOptions = {
  /**
   * 🔴 Only these member ids are checked against `catalog`. A caller that fetched only the products
   * adds or changes, never the 8.7 MB catalogue (a free Worker gets 10 ms of CPU), so every other
   * member is "not checked here", never "not live".
   */
  scope?: ReadonlySet<string>;
  /**
   * 🔴 A scoped member the catalogue did not return is an ERROR. Without this a missing product
   * only warns and SKIPS every catalogue check, so a save whose fetch came back short would pass
   * (design review, 2026-10-07).
   */
  missingIsError?: boolean;
  /** A line over the price ceiling is an ERROR: the daily run publishes with no second look. */
  priceIsError?: boolean;
};

// ── words ───────────────────────────────────────────────────────────────────

/**
 * A text's result, kept per isolate: names, labels and line texts repeat from save to save, and
 * folding and parsing them again was a fifth of a save's CPU (measured, review round 8). Callers
 * only read what comes back. Bounded, so a long-lived isolate never grows without limit.
 */
function memo<T>(fn: (text: string) => T): (text: string) => T {
  const seen = new Map<string, T>();
  return (text) => {
    const hit = seen.get(text);
    if (hit !== undefined) return hit;
    const out = fn(text);
    if (seen.size >= 20_000) seen.clear();
    seen.set(text, out);
    return out;
  };
}

/** Every real word of a name, folded the way the app's search folds it. */
const stemsOf = memo((text: string): string[] =>
  cleanHebrewText(text)
    .split(' ')
    .filter((w) => w.length > 1)
    .map(stem),
);

/** The first real word of a name, folded. */
export function leadStem(text: string): string {
  return stemsOf(text)[0] ?? '';
}

/**
 * Does this product's name lead with the concept's word, and carry the label's other words too
 * (or does it match an approved alias the same way)?
 *
 * 🔴 EVERY WORD OF THE LABEL, NOT ONLY THE FIRST. "שמן זית" leading alone would pass canola oil
 * as olive oil, and "חסה קיסר" would pass every lettuce the shop sells; the first word places the
 * product, the rest say WHICH one.
 */
/** Words a name may OPEN with that say how it is packed or counted, never what it is. */
const PACKED_IN = new Set(
  ['סלסלת', 'סלסלה', 'מארז', 'מארזי', 'חבילת', 'חבילה', 'שקית', 'קופסת', 'קופסא', 'מגש', 'ארגז', 'צרור', 'גביע', 'רביעיית', 'שישיית', 'שלישיית', 'זוג', 'גרם', 'קג', 'קילו', 'יחידות'].map(stem),
);

/**
 * Two STEMS of five letters or more opening with the same four (ברוקולי, ברוקומיני): a coined name of
 * the same thing. Four on the stem, because `stem` takes a leading ב as a preposition (רוקול).
 */
export const sharesPrefix = (a: string, b: string) => a.length >= 5 && b.length >= 5 && a.slice(0, 4) === b.slice(0, 4);

export function leadsWith(productName: string, concept: Pick<ConceptRecord, 'label' | 'aliases'>): boolean {
  // 🔴 A name may open with how it is PACKED ("סלסלת תות שדה", "מארז ביצים"): the head word is the
  // first one after those (Rom, 2026-10-09). Without this, strawberries back in season as "סלסלת תות
  // שדה של נוי" would never reach the proposer.
  const all = stemsOf(productName);
  let lead = 0;
  while (lead < all.length - 1 && (PACKED_IN.has(all[lead]) || /^\d/.test(all[lead]))) lead++;
  const words = all.slice(lead);
  if (!words.length) return false;
  const near = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));
  return [concept.label, ...(concept.aliases ?? [])].some((label) => {
    const want = stemsOf(label);
    // 🔴 The head word may be a NEAR form, not only the same one (Rom, 2026-10-09: ברוקומיני for
    // ברוקולי, never offered). This only puts a product in front of the proposer; it serves nothing.
    if (!want.length || !(near(want[0], words[0]) || sharesPrefix(want[0], words[0]))) return false;
    return want.slice(1).every((w) => words.some((x) => near(x, w)));
  });
}

// ── sizes ───────────────────────────────────────────────────────────────────

/**
 * What the shop itself prints about one sale unit's size: the name's digits, `showPriceBy`, the
 * feed's per-unit weight. Approximate ("כ-100 גרם") is still evidence; the comparison allows 10%.
 */
export function printedSize(p: CatalogProduct): { count?: number; g?: number; ml?: number } {
  const out: { count?: number; g?: number; ml?: number } = {};
  const n = (s: string) => Number(s.replace(',', '.'));
  // 🔴 EVERY UNIT ENDS ON A NON-LETTER, AND NONE IS A BARE PREFIX OF A WORD. JavaScript's `\b`
  // knows only Latin letters, so it never fires beside Hebrew; and a bare "מל" or "גר" reads
  // "1 מלח" as a millilitre and "50 גרעיני דלעת" as fifty grams.
  //
  // 🔴 AND A NUMBER IN THE NAME IS NOT ALWAYS THE PACK. "יוגורט פרו טבעי 21 גרם חלבון" is a
  // 200 g cup with 21 g of protein: the first version of this rule read it as a 21 g pack. So the
  // shop's own size field (`showPriceBy`) is read first, the name second, and a weight that names
  // a nutrient (חלבון, שומן, סוכר) is never a size.
  const END = '(?![א-ת])';
  const NOT_NUTRIENT = '(?!\\s*(?:חלבון|שומן|סוכר|סיבים))';
  const read = (text: string) => {
    const r: { count?: number; g?: number; ml?: number } = {};
    const count = new RegExp(`(\\d+)\\s*(?:יחידות|יח['׳])${END}`).exec(text);
    if (count) r.count = n(count[1]);
    const kg = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(?:ק["״]ג|קילוגרם|קילו)${END}`).exec(text);
    const g = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(?:גרם|גר['׳]|ג['׳])${END}${NOT_NUTRIENT}`).exec(text);
    if (g) r.g = n(g[1]);
    else if (kg) r.g = n(kg[1]) * 1000;
    const l = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(?:ליטר|ל['׳])${END}`).exec(text);
    const ml = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(?:מ["״]ל|מיליליטר)${END}`).exec(text);
    if (ml) r.ml = n(ml[1]);
    else if (l) r.ml = n(l[1]) * 1000;
    return r;
  };
  const field = read(p.showPriceBy);
  const name = read(p.name);
  out.count = field.count ?? name.count;
  out.g = field.g ?? name.g ?? (p.weight && p.weight > 0 && p.pricingType === 'unit' ? Math.round(p.weight * 1000) : undefined);
  out.ml = field.ml ?? name.ml;
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as typeof out;
}

/**
 * What ONE sale unit costs. 🔴 A product sold by the piece but priced per kilo (`unitaskg`) carries
 * its KILO price in `price`: a 200 g wedge of gouda at ₪170 a kilo is ₪34, not ₪170.
 */
export function unitPrice(p: CatalogProduct): number {
  const price = ceilingPrice(p);
  return p.pricingType === 'unitaskg' && p.weight && p.weight > 0 ? price * p.weight : price;
}

/**
 * The price a line is held to: the higher of today's and the regular one. 🔴 A sale ends and the
 * served line does not change: a ₪149 line on a 25% sale is ₪199 the day after (review round 7: 14
 * products were on sale that day).
 */
function ceilingPrice(p: CatalogProduct): number {
  return Math.max(p.price, p.regularPrice ?? 0);
}

const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(a, b) * 0.1;

/**
 * Two sale models are the same sale model: `showPriceBy` is compared trimmed, here and in the gate
 * alike (review round 4: a byte-for-byte compare called a trailing space a re-model).
 */
export function sameSale(a: SaleModel, b: SaleModel): boolean {
  return a.pricingType === b.pricingType && a.isPack === b.isPack && a.isHalf === b.isHalf && a.showPriceBy.trim() === b.showPriceBy.trim();
}

/**
 * The unit the cart holds one product in for one link, when it can be held two ways, else null.
 * 🔴 THE CART KEEPS ONE LINE PER PRODUCT, and a second write in another unit keeps the first unit
 * and adds the quantity on top (`state/cart.ts` `addToCartLine`): half a kilo of apples and 8 apples
 * become 8.5 kilos. Only a product sold both ways can meet two units: by the piece (a count, or one
 * piece to taste, as `lineCost` prices it) or by the kilo (grams). Read from the stored sale model
 * only, so the finding never depends on which products a save happened to fetch.
 */
export function cartUnit(need: Need, provides: Provides, pricingType: string): 'kg' | 'unit' | null {
  if (provides !== 'by-weight' || pricingType !== 'both') return null;
  if (need === 'to-taste' || need.unit === 'count') return 'unit';
  if (need.unit === 'g') return 'kg';
  return null;
}

/**
 * Sale units needed for one line, when it can be said WITHOUT converting between units; null
 * otherwise. 🔴 This is the arithmetic stage 2's planner builds on (Tier 1): it rounds UP, so a
 * line is never bought short, and it never turns a count into grams.
 */
export function packsFor(need: Need, provides: Provides): number | null {
  if (need === 'to-taste' || provides === 'whole-pack') return 1;
  if (provides === 'by-weight') return null; // the planner owns kilos and pieces
  if (need.unit !== provides.unit) return null;
  // The epsilon keeps 0.75 / 0.25 from rounding up to 4 on a float that came out 3.0000000004.
  return Math.max(1, Math.ceil(need.amount / provides.amount - 1e-9));
}

/**
 * What one line costs with one product, as add-all would order it, or null when the line is
 * added from its row only. 🔴 SOLD BY WEIGHT TOO: `packsFor` has no answer for those, and the price
 * ceiling skipped them, so "50,000 גרם בשר" would have been served at ₪3,995 while the same typo on
 * a product sold by the unit was blocked (data review, 2026-10-08).
 */
export function lineCost(need: Need, provides: Provides, p: CatalogProduct): number | null {
  if (provides !== 'by-weight') {
    const packs = packsFor(need, provides);
    return packs == null ? null : packs * unitPrice(p);
  }
  // By weight: kilos rounded UP to half a kilo, or whole pieces at the piece's weight (the planner's rule).
  const price = ceilingPrice(p);
  // To taste is one piece of a product sold both ways (`cartUnit`): with no piece weight it cannot
  // be priced (review round 7: it was priced as half a kilo while the page ordered a piece).
  if (need === 'to-taste') return p.weight ? p.weight * price : p.pricingType === 'both' ? null : 0.5 * price;
  if (need.unit === 'g') return Math.max(0.5, Math.ceil(need.amount / 500) / 2) * price;
  if (need.unit === 'count') return p.weight ? Math.ceil(need.amount - 1e-9) * p.weight * price : null;
  return null;
}

/** One amount a line's text states: a range (`lo`..`hi`, equal for a plain number) in a unit. */
export type Stated = { lo: number; hi: number; unit: Amount['unit'] };

/** The amounts a text states, one per unit; a unit the text states twice is left out (ambiguous). */
function statedByUnit(stated: readonly Stated[]): Map<Amount['unit'], Stated> {
  const seen = new Map<Amount['unit'], Stated | null>();
  for (const x of stated) seen.set(x.unit, seen.has(x.unit) ? null : x);
  return new Map([...seen].filter((e): e is [Amount['unit'], Stated] => e[1] !== null));
}

const NUM = '(\\d+(?:[.,]\\d+)?(?:\\/\\d+)?)';
const RANGE = `${NUM}(?:\\s*[-–]\\s*${NUM})?`;
const END_HE = '(?![א-ת])';
const MEASURE =
  'גרם|גר|ג[\'׳]|כוס|כוסות|כף|כפות|כפית|כפיות|מ["״]ל|ליטר|ל[\'׳]|ק["״]ג|קילו|חבילה|חבילות|אריזה|אריזות|צרור|צרורות|שן|שיני|קופסה|קופסת|פחית|ענף|ענפי|עלי|יח|חופן|קורט|מעט|פרוסות|פרוסה';
/** Compiled ONCE: compiling seven per line on every save cost a third of a save's CPU (review round 8). */
const STATED: readonly { re: RegExp; unit: Amount['unit']; mul: number }[] = [
  { re: new RegExp(`${RANGE}\\s*(?:גרם|גר['׳]|ג['׳])${END_HE}`, 'g'), unit: 'g', mul: 1 },
  { re: new RegExp(`${RANGE}\\s*(?:ק["״]ג|קילוגרם|קילו)${END_HE}`, 'g'), unit: 'g', mul: 1000 },
  { re: new RegExp(`${RANGE}\\s*(?:מ["״]ל|מיליליטר)${END_HE}`, 'g'), unit: 'ml', mul: 1 },
  { re: new RegExp(`${RANGE}\\s*(?:ליטר|ל['׳])${END_HE}`, 'g'), unit: 'ml', mul: 1000 },
  { re: new RegExp(`${RANGE}\\s*(?:חבילה|חבילות|אריזה|אריזות)${END_HE}`, 'g'), unit: 'package', mul: 1 },
  { re: new RegExp(`${RANGE}\\s*(?:צרור|צרורות)${END_HE}`, 'g'), unit: 'bunch', mul: 1 },
];
const LEADING_COUNT = new RegExp(`^\\s*${RANGE}\\s+(?!${MEASURE})`);
const toNumber = (x: string) => (x.includes('/') ? Number(x.split('/')[0]) / Number(x.split('/')[1]) : Number(x.replace(',', '.')));
/**
 * Hebrew number words that lead a line, read as digits ("חצי בצל" is 0.5 of an onion, "1 וחצי" is
 * 1.5): a typo on such a line went unchecked (review round 9: "חצי בצל" saved as 10 onions). On the
 * whole proposal this reads 74 more lines and flags none.
 */
const NUMBER_WORDS: readonly [RegExp, (lead: string, n?: string) => string][] = [
  [/^(\s*)(\d+)\s+וחצי(?=\s)/, (lead, n) => `${lead}${Number(n) + 0.5}`],
  [/^(\s*)חצי(?=\s)/, (lead) => `${lead}0.5`],
  [/^(\s*)רבע(?=\s)/, (lead) => `${lead}0.25`],
  [/^(\s*)שליש(?=\s)/, (lead) => `${lead}1/3`],
  [/^(\s*)(?:אחד|אחת)(?=\s)/, (lead) => `${lead}1`],
  [/^(\s*)(?:שניים|שתיים|שני|שתי)(?=\s)/, (lead) => `${lead}2`],
  [/^(\s*)(?:שלושה|שלוש|שלושת)(?=\s)/, (lead) => `${lead}3`],
  [/^(\s*)(?:ארבעה|ארבע|ארבעת)(?=\s)/, (lead) => `${lead}4`],
  [/^(\s*)(?:חמישה|חמש|חמשת)(?=\s)/, (lead) => `${lead}5`],
];

/**
 * Every amount a line's text states plainly: "200 גרם", "1/2 ליטר", "2 חבילות", "2-3 צרורות", and a
 * leading count not followed by a measure ("8 תפוחים" is 8 pieces, "2 כפות" is not 2 pieces). A
 * range is read either way round ("4-3" is the Hebrew order of "3-4").
 */
export const statedAmounts = memo(function statedAmounts(raw: string): Stated[] {
  let text = raw;
  for (const [re, to] of NUMBER_WORDS) text = text.replace(re, (_m, lead: string, n?: string) => to(lead, n));
  const out: Stated[] = [];
  const push = (m: RegExpMatchArray | RegExpExecArray, unit: Amount['unit'], mul: number) => {
    const a = toNumber(m[1]) * mul;
    const b = toNumber(m[2] ?? m[1]) * mul;
    if (Number.isFinite(a) && Number.isFinite(b)) out.push({ lo: Math.min(a, b), hi: Math.max(a, b), unit });
  };
  for (const x of STATED) for (const m of text.matchAll(x.re)) push(m, x.unit, x.mul);
  const lead = LEADING_COUNT.exec(text);
  if (lead) push(lead, 'count', 1);
  return out;
});

/** Does `x` say what `s` says? Pieces, bunches and packs may round UP; grams and millilitres may differ by a tenth. */
function fitsStated(x: number, s: Stated): boolean {
  if (s.unit === 'g' || s.unit === 'ml') return x >= s.lo * 0.9 - 1e-9 && x <= s.hi * 1.1 + 1e-9;
  return x >= s.lo - 1e-9 && x <= Math.ceil(s.hi - 1e-9) + 1e-9;
}

// ── the rules ───────────────────────────────────────────────────────────────

/**
 * Every rule, over the git record. `catalog` and `live` are the live catalogue and recipes; the
 * checks that need them are skipped when they are absent, so an offline check
 * without the network still checks the file's own consistency.
 */
export function checkRules(
  file: ApprovedFile,
  catalog?: ReadonlyMap<string, CatalogProduct>,
  live?: readonly LiveRecipe[],
  opts: RuleOptions = {},
): Finding[] {
  const out: Finding[] = [];
  const err = (code: string, where: string, message: string, about: About = {}) =>
    out.push({ level: 'error', code, where, message, ...about });
  const warn = (code: string, where: string, message: string, about: About = {}) =>
    out.push({ level: 'warn', code, where, message, ...about });

  // ── concepts and members ──
  for (const [cid, c] of Object.entries(file.concepts)) {
    const where = `concept ${cid}`;
    const ca: About = { concept: cid };
    if (!c.members.length) warn('concept-empty', where, 'no members', ca);
    if (!c.allowedCategories.length) err('concept-categories', where, 'no allowed categories', ca);
    if (c.defaultVariant && !c.members.some((m) => m.variant === c.defaultVariant)) {
      err('concept-default', where, `default variant "${c.defaultVariant}" is not a member's`, ca);
    }
    const seen = new Set<string>();
    for (const m of c.members) {
      const mw = `${where} member ${m.id} "${m.name}"`;
      const ma: About = { concept: cid, product: m.id };
      if (seen.has(m.id)) err('member-duplicate', mw, 'listed twice', ma);
      seen.add(m.id);
      if (c.rejected?.some((r) => r.id === m.id)) err('member-rejected', mw, 'is also on the rejected list', ma);
      if (!leadsWith(m.name, c) && !m.override?.name) {
        err('member-name', mw, `does not lead with "${c.label}"${c.aliases?.length ? ' or an alias' : ''}`, ma);
      }
      const byWeightSold = m.sale.pricingType === 'kg' || m.sale.pricingType === 'both';
      if (m.provides === 'by-weight' && !byWeightSold) {
        err('member-by-weight', mw, `provides by-weight but is sold as ${m.sale.pricingType}`, ma);
      }
      // 🔴 "whole-pack" too: on a product sold by weight it priced a kilo while the page said a piece,
      // and it slipped past the one-unit-per-product rule (review round 5).
      if (m.provides !== 'by-weight' && byWeightSold) {
        err('member-by-weight', mw, `is sold by weight (${m.sale.pricingType}): provides must be by-weight`, ma);
      }
      // 🔴 A bunch or a package is never a fraction of a sale unit: "0.1 צרור" a unit ordered ten
      // bunches for every bunch a line asked for, and no rule said a word (review round 4).
      if (
        typeof m.provides === 'object' &&
        (m.provides.unit === 'bunch' || m.provides.unit === 'package') &&
        !(Number.isInteger(m.provides.amount) && m.provides.amount >= 1) &&
        !m.override?.provides
      ) {
        err('member-provides-whole', mw, `provides ${m.provides.amount} ${m.provides.unit}: a sale unit holds a whole number of them`, ma);
      }

      if (!catalog) continue;
      if (opts.scope && !opts.scope.has(m.id)) continue;
      const p = catalog.get(m.id);
      if (!p) {
        if (opts.missingIsError) err('member-missing', mw, 'the shop did not return it', ma);
        else warn('member-not-live', mw, 'not in the live catalogue (delisted, or out of season)', ma);
        continue;
      }
      if (!p.categories.some((x) => c.allowedCategories.includes(x)) && !m.override?.category) {
        err('member-category', mw, `in none of ${c.allowedCategories.join(', ')}`, ma);
      }
      const household = p.categories.filter((x) => HOUSEHOLD_ROOTS.includes(x));
      if (household.length && !m.override?.household) {
        err('member-household', mw, `sits in household root ${household.join(', ')}`, ma);
      }
      if (p.name !== m.name) warn('member-renamed', mw, `live name is "${p.name}"`, { ...ma, was: m.name, now: p.name });
      if (!sameSale(p, m.sale)) {
        warn('member-sale-drift', mw, `live sale model ${p.pricingType}/${p.isPack}/${p.isHalf}/"${p.showPriceBy}"`, {
          ...ma,
          was: saleJson(m.sale),
          now: saleJson(p),
        });
      }
      if (typeof m.provides === 'object' && !m.override?.provides) {
        checkProvides(m.provides, p, mw, ma, err, warn);
      }
    }
  }

  // ── recipes and lines ──
  const liveBySlug = new Map((live ?? []).map((r) => [r.slug, r]));
  for (const [slug, r] of Object.entries(file.recipes)) {
    // 🔴 By SLUG: two recipes with the same title shared every key, so a warning acknowledged in one
    // silenced it in the other (review round 9). A person reads the title (`findingHe`), never this.
    const where = `recipe ${slug}`;
    const ra: About = { recipe: slug };
    const lr = liveBySlug.get(slug);
    if (live && !lr) warn('recipe-gone', where, 'not in the live index', ra);
    if (lr && r.postId && lr.postId && lr.postId !== r.postId) {
      err('recipe-postid', where, `post id ${r.postId} approved, ${lr.postId} live: a reused slug`, ra);
    }
    const unitsByConcept = new Map<string, Set<string>>();
    const unitsByProduct = new Map<string, { units: Set<string>; concepts: Set<string> }>();
    for (const [text, l] of Object.entries(r.lines)) {
      const lw = `${where} line "${text}"`;
      const la: About = { recipe: slug, line: text };
      if (lr && !lr.lines.includes(text)) warn('line-orphan', lw, 'no longer in the recipe (edited or removed)', la);
      if ('notSold' in l) continue;
      if (l.mode === 'all' && l.links.length > 1 && /\sאו\s/.test(` ${text} `)) {
        warn('line-or', lw, 'says "או" but is stored as all: one of them, or both?', la);
      }
      if (l.mode === 'any' && l.links.length < 2) warn('line-any-single', lw, '"any" with one link', la);
      // 🔴 One ingredient twice in one line would be ordered twice (review round 7: 20 + 20 onions).
      const linked = l.links.map((k) => k.concept);
      if (new Set(linked).size !== linked.length) err('line-concept-twice', lw, `links ${linked.join(', ')}`, la);
      // 🔴 The amount typed beside a line against the amount the line itself states: "1 בצל" saved as
      // 40 ordered 40 onions under the ceiling (review round 6), and as 40 onions plus salt to taste
      // once a second link turned the check off (round 7). Read from the TEXT: when it states exactly
      // one amount, the links in that unit must say it, their sum on a line that needs all of them
      // (250 g of berries split three ways), each one on a line that needs one of them.
      // Per UNIT: a text stating "2 ארטישוק (600 גרם)" holds one count and one weight, and each is
      // compared with the links in its own unit (review round 8: such a line went unchecked).
      const stated = statedAmounts(text);
      const byUnit = statedByUnit(stated);
      for (const [unit, s1] of byUnit) {
        const same = l.links.flatMap((k) => (k.need !== 'to-taste' && k.need.unit === unit ? [k.need.amount] : []));
        const off = same.length > 0 && (l.mode === 'any' ? same.some((x) => !fitsStated(x, s1)) : !fitsStated(same.reduce((x, y) => x + y, 0), s1));
        if (off) {
          const said = s1.lo === s1.hi ? `${s1.lo}` : `${s1.lo}-${s1.hi}`;
          warn('line-amount-text', lw, `the line says ${said} ${unit}, its links order ${same.join(' + ')}`, la);
        }
      }
      // One product a line that needs all its links can reach through two of them is ordered twice.
      if (l.mode === 'all' && l.links.length > 1) {
        const reach = l.links.map((k) => new Set(Object.prototype.hasOwnProperty.call(file.concepts, k.concept) ? file.concepts[k.concept].members.map((m) => m.id) : []));
        const shared = [...new Set(reach.flatMap((r, i) => [...r].filter((id) => reach.some((o, j) => j > i && o.has(id)))))].sort();
        if (shared.length) warn('line-product-twice', lw, `reaches ${shared.join(', ')} through two links`, la);
      }
      // 🔴 A line that needs ALL its links costs their SUM: each link under the ceiling said nothing
      // about the line (review round 4: eggs, oil and honey on one line, ₪217 to ₪311, passed).
      // Priced only when every product of every link was priced, so it never reads a partial sum.
      let lineTotal = 0;
      let lineDearest: { cost: number; id: string } | null = null;
      let lineComplete = !!catalog;
      for (const k of l.links) {
        const c = Object.prototype.hasOwnProperty.call(file.concepts, k.concept) ? file.concepts[k.concept] : undefined;
        const ka: About = { ...la, concept: k.concept };
        if (!c) {
          err('line-concept', lw, `unknown concept ${k.concept}`, ka);
          lineComplete = false;
          continue;
        }
        // Every substitute is reported: the shop does not sell what the line names.
        // Keyed by the ingredient's ID too: a second ingredient under the same label is another one.
        if (k.substitute) warn('line-substitute', lw, `offers "${c.label}" (${k.concept}) in place of what the line names`, ka);
        if (k.need !== 'to-taste') {
          const set = unitsByConcept.get(k.concept) ?? new Set<string>();
          set.add(k.need.unit);
          unitsByConcept.set(k.concept, set);
        }
        let linkDearest: { cost: number; id: string } | null = null;
        for (const m of c.members) {
          if (m.provides === 'whole-pack' && k.need !== 'to-taste' && isLarge(k.need)) {
            warn('whole-pack-large', `${lw} member ${m.id} need ${k.need.amount}${k.need.unit}`, `needs ${k.need.amount} ${k.need.unit} of "${c.label}", whose ${m.id} is whole-pack`, { ...ka, product: m.id });
          }
          const unit = cartUnit(k.need, m.provides, m.sale.pricingType);
          // To taste on a product sold by the piece AND the kilo orders ONE piece: short when the line
          // itself states several (review round 8: "8 תפוחי אדמה" set to taste ordered one).
          // One link only: in "4 פינגר ליים או גרידת לימון" the 4 is the finger limes, not the lemon.
          const saidPieces = byUnit.get('count');
          if (l.links.length === 1 && k.need === 'to-taste' && unit === 'unit' && saidPieces && saidPieces.lo > 1) {
            warn('line-taste-pieces', lw, `${m.name}: one piece to taste, the line says ${saidPieces.lo}`, { ...ka, product: m.id });
          }
          if (unit) {
            const u = unitsByProduct.get(m.id) ?? { units: new Set<string>(), concepts: new Set<string>() };
            u.units.add(unit);
            u.concepts.add(k.concept);
            unitsByProduct.set(m.id, u);
          }
          if (opts.scope && !opts.scope.has(m.id)) {
            lineComplete = false;
            continue;
          }
          const p = catalog?.get(m.id);
          if (!p) lineComplete = false;
          const cost = p ? lineCost(k.need, m.provides, p) : null;
          // 🔴 Ordered in pieces but impossible to price (a product sold both ways with no piece
          // weight): the ceiling cannot be checked, so the line is not taken on trust (review round 6).
          if (p && cost == null && unit === 'unit') {
            (opts.priceIsError ? err : warn)('line-unpriced', lw, `${m.name}: ordered in pieces with no piece weight, so the line cannot be priced`, {
              ...ka,
              product: m.id,
            });
          }
          if (cost != null && cost > LINE_PRICE_CEILING) {
            (opts.priceIsError ? err : warn)('line-price', lw, `${m.name} = ₪${cost.toFixed(2)}`, {
              ...ka,
              product: m.id,
            });
          }
          if (cost != null && (!linkDearest || cost > linkDearest.cost)) linkDearest = { cost, id: m.id };
          // Pieces against grams, on a product sold by weight, either way round: far from the count
          // times the shop's piece weight is a typo ("1 בצל" saved as 1000 g, round 7; "1 ק"ג
          // עגבניות" saved as 40 pieces, round 8).
          if (p?.weight && m.provides === 'by-weight' && k.need !== 'to-taste') {
            const pieceG = p.weight * 1000;
            const saidCount = byUnit.get('count');
            const saidG = byUnit.get('g');
            const far = (got: number, lo: number, hi: number) => got > hi * 2 || got < lo * 0.5;
            // Only when the text states nothing in the link's OWN unit: "2 ארטישוק (600 גרם)" saved as
            // 600 g says it in grams, and the gram check above governs.
            if (k.need.unit === 'g' && saidCount && !saidG && far(k.need.amount, saidCount.lo * pieceG, saidCount.hi * pieceG)) {
              warn('line-amount-weight', lw, `${m.name}: ${k.need.amount} g for ${saidCount.hi} pieces of about ${Math.round(pieceG)} g`, { ...ka, product: m.id });
            }
            if (k.need.unit === 'count' && saidG && !saidCount && far(k.need.amount * pieceG, saidG.lo, saidG.hi)) {
              warn('line-amount-weight', lw, `${m.name}: ${k.need.amount} pieces of about ${Math.round(pieceG)} g for ${saidG.hi} g`, { ...ka, product: m.id });
            }
          }
        }
        if (linkDearest) {
          lineTotal += linkDearest.cost;
          if (!lineDearest || linkDearest.cost > lineDearest.cost) lineDearest = linkDearest;
        }
      }
      if (l.mode === 'all' && l.links.length > 1 && lineComplete && lineTotal > LINE_PRICE_CEILING) {
        (opts.priceIsError ? err : warn)('line-price-total', lw, `all ${l.links.length} links = ₪${lineTotal.toFixed(2)}`, {
          ...la,
          product: lineDearest?.id,
        });
      }
    }
    // 🔴 THE CART HOLDS ONE LINE PER PRODUCT (`state/cart.ts` merges by id), so two lines asking
    // for one concept in two units ("2 גזרים" and "200 גרם גזר") cannot both be honoured.
    for (const [cid, units] of unitsByConcept) {
      if (units.size > 1) {
        err('recipe-unit-mix', `${where} concept ${cid}`, `asked for in ${[...units].join(' and ')}`, { ...ra, concept: cid });
      }
    }
    // 🔴 And per PRODUCT, which is what the cart keys on: one product under two ingredients (14 of
    // the imported products sit in two), or one ingredient to taste beside grams, reached the cart in
    // kilos AND pieces while every ingredient on its own looked fine (review round 4).
    for (const [pid, u] of unitsByProduct) {
      if (u.units.size > 1) {
        const concepts = [...u.concepts].sort();
        err('recipe-product-unit-mix', `${where} product ${pid}`, `by the kilo and by the piece, through ${concepts.join(', ')}`, {
          ...ra,
          product: pid,
          concept: concepts[0],
        });
      }
    }
    if (lr) {
      for (const text of lr.lines) {
        if (!r.lines[text]) err('line-undecided', `${where} line "${text}"`, 'no decision', { recipe: slug, line: text });
      }
    }
  }
  if (live) {
    for (const lr of live) {
      if (!Object.prototype.hasOwnProperty.call(file.recipes, lr.slug)) err('recipe-undecided', `recipe ${lr.title}`, `${lr.lines.length} lines, no decisions`, { recipe: lr.slug });
    }
  }
  return out;
}

/**
 * More than one "whole pack" can be trusted to hold. 🔴 Two bunches or two packages are more than
 * one pack: "2 חבילות כוסברה" on a whole-pack product ordered one, and nothing said so (review
 * round 6).
 */
function isLarge(need: Amount): boolean {
  if (need.unit === 'g' || need.unit === 'ml') return need.amount > 250;
  if (need.unit === 'bunch' || need.unit === 'package') return need.amount > 1;
  return need.amount > 2;
}

function checkProvides(
  provides: Amount,
  p: CatalogProduct,
  where: string,
  about: About,
  err: (code: string, where: string, message: string, about?: About) => void,
  warn: (code: string, where: string, message: string, about?: About) => void,
): void {
  const printed = printedSize(p);
  const said =
    provides.unit === 'count' ? printed.count : provides.unit === 'g' ? printed.g : provides.unit === 'ml' ? printed.ml : undefined;
  if (provides.unit === 'bunch' || provides.unit === 'package') {
    // The shop prints no bunch or package count: one is the sale unit itself, more needs a person.
    if (provides.amount > 1) warn('member-provides-unverified', where, `provides ${provides.amount} ${provides.unit}; the shop prints no such count`, about);
    return;
  }
  if (said == null) {
    warn('member-provides-unverified', where, `provides ${provides.amount} ${provides.unit}; the shop prints no size`, about);
  } else if (!close(said, provides.amount)) {
    err('member-provides', where, `provides ${provides.amount} ${provides.unit}; the shop prints ${said}`, about);
  }
}

/** The findings that block a publish. */
export function blocking(findings: readonly Finding[]): Finding[] {
  return findings.filter((f) => f.level === 'error');
}
