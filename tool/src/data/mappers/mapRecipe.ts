/**
 * WordPress `matkon` → the app's `Recipe`.
 *
 * 🔴 EVERY RULE HERE WAS MEASURED AGAINST ALL 67 PUBLISHED RECIPES, not inferred from one.
 * The survey that produced them (2026-08-27, live `/api/content?slug=` for each) is in
 * `docs/RECIPES.md`; the numbers that matter to a future reader:
 *
 *   noytip, thumbnail, author_img, products_buy   67/67
 *   make_time · total_make_time · top_text         0/67   ← the fields the old page drew
 *   steps as `<ol><li>`                           61/67
 *   steps as "1. … <br />2. …"                     5/67
 *   ingredient groups: 1 / 2 / 3 / 4              36 / 21 / 9 / 1
 *
 * 🔴 AND THE `<br />` INSIDE AN `<ol>` IS NOISE, NOT A SEPARATOR. WordPress's autop puts a
 * `<br />` between every `<li>`; splitting on it instead of on the list items shreds one
 * step into three. 625 of them across the corpus, all decorative.
 */
import { buildMatcher, type MatchCandidate } from './matchIngredient';
import {
  difficultyFromHebrew,
  UMBRELLA_CATEGORY,
  type IngredientGroup,
  type Recipe,
  type RecipeSummary,
  type StepGroup,
} from '@/types/recipe';

// ── the wire ────────────────────────────────────────────────────────────────
/** One row of `/api/recipe_categories` → `recipe_categories[].recipes.posts[]`. */
export type WpRecipeListRow = {
  id?: number;
  slug?: string;
  name?: string;
  featured?: string | false;
  matkon_level?: string[];
  matkon_amount?: string[];
  matkon_cat?: string[];
  matkon_tags?: string[];
};

/** `/api/content?slug=<slug>` → `content`, for a `template: "matkon"` page. */
export type WpRecipeDetail = {
  template?: string;
  title?: string;
  content?: string;
  acf?: {
    thumbnail?: string | false;
    noytip?: string;
    recipe_writer?: string;
    author_img?: string | false;
    date?: string;
    products_buy?: number[];
    products_buy_title?: string;
    post_rating?: number;
    post_num_of_rating?: number;
    ingredients?: {
      title?: string;
      ingredients?: { title?: string; ingredients?: { text?: string }[] }[];
    };
    matkon_level?: string[];
    matkon_amount?: string[];
    matkon_cat?: string[];
    matkon_tags?: string[];
  };
};

// ── html ────────────────────────────────────────────────────────────────────
// The line key lives in its own module so the panel's server keys lines with the same function.
export { plainText } from './plainText';
import { plainText } from './plainText';

/** A leading "3." / "3)" — the manual numbering in the 5 non-`<ol>` recipes. */
const LEADING_NUMBER = /^\s*\d{1,2}\s*[.)]\s*/;

/**
 * Parse the WP editor body into ordered step GROUPS.
 *
 * Two shapes, and a heading mechanism that spans both: a `<strong>` run sitting between
 * steps ("מכינים את הקישואים:") starts a new group. 13 of the 67 use it.
 */
export function parseSteps(html: string): { groups: StepGroup[]; outro?: string } {
  if (!html.trim()) return { groups: [] };

  const groups: StepGroup[] = [];
  let current: StepGroup = { steps: [] };
  const push = () => {
    if (current.steps.length || current.heading) groups.push(current);
    current = { steps: [] };
  };

  const listMatch = html.match(/<ol[^>]*>([\s\S]*?)<\/ol>/i);
  if (listMatch) {
    // Anything BEFORE the list that is real prose is a heading for the first group.
    const before = plainText(html.slice(0, listMatch.index ?? 0));
    if (before) current.heading = before;

    const body = listMatch[1];
    // Walk the list body so a `<strong>` between two `<li>`s is seen in order.
    const token = /<li[^>]*>([\s\S]*?)<\/li>|<strong[^>]*>([\s\S]*?)<\/strong>/gi;
    let m: RegExpExecArray | null;
    while ((m = token.exec(body))) {
      if (m[1] !== undefined) {
        const step = plainText(m[1]).replace(LEADING_NUMBER, '');
        if (step) current.steps.push(step);
      } else {
        const heading = plainText(m[2] ?? '').replace(/[:：]\s*$/, '');
        // A bold run INSIDE a step is emphasis, not a heading — only one that appears
        // between items (i.e. when the current group already has steps) starts a group.
        if (heading && current.steps.length) {
          push();
          current.heading = heading;
        }
      }
    }
    push();
    const after = plainText(html.slice((listMatch.index ?? 0) + listMatch[0].length));
    return { groups, outro: after || undefined };
  }

  // The manual shape: "1. …<br />2. …", with `<strong>` headings interleaved.
  for (const rawChunk of html.split(/<br\s*\/?>/i)) {
    const boldRuns = [...rawChunk.matchAll(/<strong[^>]*>([\s\S]*?)<\/strong>/gi)];
    const chunk = plainText(rawChunk);
    if (!chunk) continue;
    const numbered = LEADING_NUMBER.test(chunk);
    // A chunk that is ENTIRELY bold and carries no step number is a heading.
    // Compared with whitespace removed: WordPress splits one heading across two runs
    // ("<strong>מכינים את הקבבים</strong><strong>:</strong>"), and joining them with a
    // space made the comparison fail on every heading in the manual shape.
    const bare = (t: string) => t.replace(/\s+/g, '');
    const allBold =
      boldRuns.length > 0 && bare(plainText(boldRuns.map((b) => b[1]).join(''))) === bare(chunk);
    if (!numbered && allBold) {
      if (current.steps.length) push();
      current.heading = chunk.replace(/[:：]\s*$/, '');
      continue;
    }
    const step = chunk.replace(LEADING_NUMBER, '');
    if (step) current.steps.push(step);
  }
  push();
  // With no list to close, a trailing unnumbered sentence is just the last step.
  return { groups };
}

// ── mapping ─────────────────────────────────────────────────────────────────
/** `matkon_cat` minus the umbrella every recipe carries. */
function realCategories(cats: string[] | undefined): string[] {
  return (cats ?? []).filter((c) => c && c !== UMBRELLA_CATEGORY);
}

export function mapRecipeSummary(row: WpRecipeListRow): RecipeSummary | null {
  const id = row.slug?.trim();
  const title = row.name?.trim();
  const image = typeof row.featured === 'string' ? row.featured : '';
  // 🔴 NO IMAGE ⇒ NO CARD. Every rail in this app is a photo card; a recipe without one
  // renders as an empty rectangle, and all 67 live recipes have a thumbnail, so a missing
  // one means the row is broken rather than plain.
  if (!id || !title || !image) return null;
  return {
    id,
    postId: typeof row.id === 'number' && row.id > 0 ? row.id : undefined,
    title,
    image,
    difficulty: difficultyFromHebrew(row.matkon_level?.[0]),
    servings: row.matkon_amount?.[0]?.trim() || undefined,
    categories: realCategories(row.matkon_cat),
    tags: (row.matkon_tags ?? []).filter(Boolean),
  };
}

export type MapRecipeOptions = {
  /**
   * Called when an ingredient line had more products behind it than a row can show. Passed
   * straight through to the matcher so the cap can never be silent — see `MAX_CHOICES`.
   */
  onChoiceOverflow?: (line: string, total: number) => void;
  /** The recipe's own curated products, already resolved against the live catalog. */
  candidates: readonly MatchCandidate[];
  /**
   * The whole catalog, for the second matching tier. Optional: pass nothing and only the
   * curated pool is searched.
   */
  catalogCandidates?: readonly MatchCandidate[];
};

/**
 * Build the full record. `summary` carries the taxonomies, which `/content` also returns —
 * but only for a recipe that HAS them, so the list row is the more reliable source and
 * wins wherever both speak.
 */
export function mapRecipeDetail(
  detail: WpRecipeDetail,
  summary: RecipeSummary,
  { candidates, catalogCandidates, onChoiceOverflow }: MapRecipeOptions,
): Recipe {
  const acf = detail.acf ?? {};
  const match = buildMatcher(candidates, { onOverflow: onChoiceOverflow });
  const wideMatch = catalogCandidates?.length
    ? buildMatcher(catalogCandidates, { strict: true })
    : null;

  const ingredients: IngredientGroup[] = [];
  for (const group of acf.ingredients?.ingredients ?? []) {
    const items = (group.ingredients ?? [])
      .map((row) => plainText(row.text ?? ''))
      .filter(Boolean)
      .map((text) => {
        // The curated pool first; the catalog-wide tier only answers where it said nothing.
        // A CHOICE from the merchant's own list beats a confident guess from 1700 products.
        const hits = match(text);
        const found = hits.length ? hits : (wideMatch?.(text) ?? []);
        return { text, productIds: found.map((h) => h.id) };
      });
    if (items.length) {
      ingredients.push({ heading: plainText(group.title ?? '') || undefined, items });
    }
  }

  const { groups, outro } = parseSteps(detail.content ?? '');

  return {
    ...summary,
    title: detail.title?.trim() || summary.title,
    image: typeof acf.thumbnail === 'string' && acf.thumbnail ? acf.thumbnail : summary.image,
    difficulty: summary.difficulty ?? difficultyFromHebrew(acf.matkon_level?.[0]),
    servings: summary.servings ?? acf.matkon_amount?.[0]?.trim() ?? undefined,
    categories: summary.categories.length ? summary.categories : realCategories(acf.matkon_cat),
    author: plainText(acf.recipe_writer ?? '') || 'נוי השדה',
    authorImage: typeof acf.author_img === 'string' && acf.author_img ? acf.author_img : undefined,
    date: acf.date?.trim() || undefined,
    ingredientsTitle: plainText(acf.ingredients?.title ?? '') || 'מצרכים',
    ingredients,
    steps: groups,
    outro,
    noyTip: plainText(acf.noytip ?? '') || undefined,
    shopProductIds: candidates.map((c) => c.id),
    shopTitle: plainText(acf.products_buy_title ?? '') || 'מצרכים שתוכלו לקנות אצלנו',
    rating: Number.isFinite(acf.post_rating) ? Number(acf.post_rating) : 0,
    ratingCount: Number.isFinite(acf.post_num_of_rating) ? Number(acf.post_num_of_rating) : 0,
  };
}
