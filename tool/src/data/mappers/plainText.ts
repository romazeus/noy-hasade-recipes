/**
 * WordPress HTML to the plain text a recipe line is KEYED by.
 *
 * 🔴 ONE FUNCTION, IMPORTED EVERYWHERE THAT KEYS A LINE. The app maps a recipe through it
 * (`mapRecipe.ts`), and the recipe-links run keys every decided line with it
 * (`scripts/recipe-links/live.ts`). Any other decoding gives a different key for the same line, and an
 * decided line then silently never shows (design review, 2026-10-07). Kept free of imports, so any
 * tool can use it without the app.
 */
const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&quot;': '"',
  '&#039;': "'",
  '&apos;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&hellip;': '…',
  '&ndash;': '–',
  '&mdash;': '—',
};

/** Strip tags and decode the handful of entities WordPress actually emits. */
export function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? ' ')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
