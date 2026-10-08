/**
 * Every product that shares a word with a text, in any spelling: the widest search, for the judges'
 * candidate lists and for a session deciding a new line.
 *
 * 🔴 A "NOT SOLD" VERDICT IS A CLAIM, AND IT NEEDS THE WIDEST SEARCH. Rom, 2026-10-07: *"בדקתי
 * לדוגמה סילאן ושום שחור וכן יש לנו ואמרת שלא"*. The first pass searched names that START with the
 * ingredient: "שום שחור" missed "ראשי שום שחור שלמים", and "קשקבל" missed "קאשקבל". Here a word
 * matches anywhere in a name, folded the way the app's search folds it, and a shared prefix of
 * three letters counts both ways. (Moved from `proposals/gap-candidates.ts`.)
 */
import { cleanHebrewText, stem } from '@/utils/hebrew';

/** Words that say how much or how prepared, never what. */
const NOISE = new Set(
  [
    'כוס', 'כוסות', 'כף', 'כפות', 'כפית', 'כפיות', 'גרם', 'קג', 'קילו', 'ליטר', 'מל', 'חבילה', 'חבילת', 'חבילות',
    'יחידות', 'יחידה', 'צרור', 'חצי', 'רבע', 'שליש', 'קורט', 'מעט', 'לפי', 'הטעם', 'טעם', 'של', 'עם', 'או', 'גם',
    'קצוץ', 'קצוצה', 'קצוצים', 'טרי', 'טריים', 'טרייה', 'מגורר', 'מגוררת', 'גדול', 'גדולה', 'גדולים', 'קטן', 'קטנה',
    'בינוני', 'בינונית', 'שלם', 'שלמים', 'לקישוט', 'להגשה', 'איכותי', 'איכותית', 'מוכן', 'מוכנה', 'בקבוק', 'מיכל',
    'קופסא', 'קופסאת', 'פחית', 'גביע', 'גביעי', 'מארז', 'שקית', 'חתוך', 'חתוכים', 'פרוס', 'פרוסים', 'קלוף', 'קלופים',
    'מומס', 'מומסת', 'רכה', 'קר', 'קרה', 'חם', 'חמים', 'לא', 'חובה', 'אפשר', 'שאתם', 'אוהבים', 'כל', 'מה', 'וכל',
  ].map(stem),
);

export function words(text: string): string[] {
  return [
    ...new Set(
      cleanHebrewText(text)
        .split(' ')
        .filter((w) => w.length >= 3)
        .map(stem)
        .filter((w) => w.length >= 2 && !NOISE.has(w)),
    ),
  ];
}

export const near = (a: string, b: string) => a === b || (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a)));

export type Indexed<T> = { item: T; w: string[] };

export function indexNames<T extends { name: string }>(items: Iterable<T>): Indexed<T>[] {
  return [...items].map((item) => ({ item, w: words(item.name) }));
}

/**
 * Products sharing a word with `primary` (weighted 2) or `secondary` (weighted 1), best first.
 * Ties keep catalogue order, so the same inputs always give the same list.
 */
export function candidates<T>(index: readonly Indexed<T>[], primary: string, secondary = ''): { item: T; shared: string[]; score: number }[] {
  const a = words(primary);
  const b = words(secondary).filter((w) => !a.includes(w));
  const out: { item: T; shared: string[]; score: number; at: number }[] = [];
  index.forEach(({ item, w }, at) => {
    const sa = a.filter((x) => w.some((y) => near(x, y)));
    const sb = b.filter((x) => w.some((y) => near(x, y)));
    if (sa.length || sb.length) out.push({ item, shared: [...sa, ...sb], score: 2 * sa.length + sb.length, at });
  });
  return out.sort((x, y) => y.score - x.score || x.at - y.at).map(({ item, shared, score }) => ({ item, shared, score }));
}
