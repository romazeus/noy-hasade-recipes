/**
 * A recipe, as the app uses it.
 *
 * 🔴 THIS IS A PORT OF A LIVE WORDPRESS RECORD, NOT A SHAPE WE CHOSE. Every field below
 * exists because `matkon` (the CPT behind noyhasade.co.il/recipe/…) has it, and the
 * optionality is measured, not defensive — see `data/mappers/mapRecipe.ts` for the audit
 * of all 67 published recipes and `docs/RECIPES.md` for the wire contract.
 *
 * The three fields that are ALWAYS present on all 67: `image`, `noyTip`, `author` (with an
 * `authorImage`). The one that is NEVER present: a prep time — `make_time` and
 * `total_make_time` are empty on every published recipe and the two time taxonomies have
 * zero terms assigned, so there is no honest number to draw. Anything showing one is
 * inventing it.
 */

export type IngredientGroup = {
  /** "לבצק הפריך" — 31 of 67 recipes split their list; the rest have one unnamed group. */
  heading?: string;
  items: IngredientLine[];
};

/**
 * One line of the ingredient list, with the shop product it was matched to when there is
 * one. `text` is the merchant's own wording and is ALWAYS what gets rendered — the match
 * decorates the row, it never rewrites it (`data/mappers/matchIngredient.ts`).
 */
export type IngredientLine = {
  text: string;
  /**
   * Catalog product ids this line can be bought as.
   *
   *   []          nothing we sell — plain text
   *   [one]       a confident match; the row adds it in one tap
   *   [a, b, …]   the shop sells SEVERAL for this line, and the reader picks
   *
   * 🔴 THE PLURAL CASE IS THE COMMON ONE AND IT USED TO BE THROWN AWAY. Measured over the 67
   * live recipes, 59.8% of everything that fell to the "מצרכים שתוכלו לרכוש פה" rail was a
   * line with more than one candidate — "8 תפוחי אדמה" against five potatoes — dropped
   * because the matcher would not guess. Not guessing was right; hiding the options at the
   * bottom of the page was not (Rom, 2026-08-28).
   */
  productIds: string[];
};

export type StepGroup = {
  /** A `<strong>` run inside the WP editor content — "מכינים את הקישואים". */
  heading?: string;
  steps: string[];
};

export type RecipeDifficulty = 'easy' | 'medium' | 'hard';

/** Hebrew labels for the difficulty enum, kept beside the type so callers stay in one file. */
export const DIFFICULTY_LABEL: Record<RecipeDifficulty, string> = {
  easy: 'קל',
  medium: 'בינוני',
  hard: 'מאתגר',
};

/** The card-level record — everything the rails and the shelf need, and nothing more. */
export type RecipeSummary = {
  /**
   * The WordPress slug, percent-encoded exactly as the API returns it. It is the route
   * param AND the key `/content?slug=` is asked for, so it must never be decoded on the
   * way through — `%d7%97…` is the id.
   */
  id: string;
  /**
   * The WordPress post id. It is what orders the home rail, newest first: the index carries
   * no date, and `post_date` is unreliable (recipes created in 2024 carry 2020 dates).
   */
  postId?: number;
  title: string;
  /** Remote CDN url. Every published recipe has one. */
  image: string;
  difficulty?: RecipeDifficulty;
  /** `matkon_amount` verbatim — usually a bare number, sometimes "30 כדורים". */
  servings?: string;
  /** `matkon_cat`, minus the umbrella term every recipe carries. */
  categories: string[];
  tags: string[];
};

/** The full record, fetched per-recipe when its page opens. */
export type Recipe = RecipeSummary & {
  author: string;
  authorImage?: string;
  /** `dd/mm/yy`, as WordPress formats it. */
  date?: string;
  ingredientsTitle: string;
  ingredients: IngredientGroup[];
  steps: StepGroup[];
  /** A closing line that sat after the `</ol>` in the WP editor — "מנה קלילה ומפנקת…". */
  outro?: string;
  noyTip?: string;
  /** Curated by the merchant per recipe. Ids that no longer resolve are dropped on map. */
  shopProductIds: string[];
  shopTitle: string;
  rating: number;
  ratingCount: number;
};

/** The umbrella category every one of the 67 carries; never worth showing as a chip. */
export const UMBRELLA_CATEGORY = 'המתכונים של נוי';

export function difficultyFromHebrew(label: string | undefined): RecipeDifficulty | undefined {
  switch ((label ?? '').trim()) {
    case 'קל':
      return 'easy';
    case 'בינוני':
      return 'medium';
    // The live taxonomy says "קשה"; the app has always labelled that tier "מאתגר".
    case 'קשה':
    case 'מאתגר':
      return 'hard';
    default:
      return undefined;
  }
}
