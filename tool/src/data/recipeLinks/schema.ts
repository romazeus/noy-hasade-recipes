/**
 * APPROVED RECIPE LINKS: which shop products a recipe's ingredient line stands for.
 *
 * Rom, 2026-10-07: *"אסור בשום פנים ואופן למערכת לטעות"*. A line "1 ביצה" showed ביצת הפלא (a
 * vegetable-freshness gadget) because the matcher compared SPELLING, and Hebrew spelling cannot
 * tell the two apart: `stem('ביצה')` and `stem('ביצת')` are the same string. No tuning makes a
 * spelling matcher right every time, so the app stopped deciding.
 *
 * 🔴 NOTHING IN THE APP DECIDES THAT A PRODUCT MATCHES AN INGREDIENT. Every link in the served
 * file passed the automatic rules (`rules.ts`) and two independent judges, each proven on planted
 * errors in the same run (`judge.ts`); anything not in it renders as plain text. A link points to a
 * CONCEPT (fresh coriander), never to one product: the concept's members are resolved against the
 * live catalogue when the page opens, so seasonal varieties come and go and the organic / mehadrin
 * / packaged choice is offered, while a coriander-lime sauce can never be, because no judge let it
 * through as fresh coriander.
 *
 * Two shapes of the same data:
 *
 *   ApprovedFile       the dictionary: every proposal, the rejected candidates and why. Kept as
 *                      `source.json` in the public recipes repo (`romazeus/noy-hasade-recipes`),
 *                      beside the judges' verdicts.
 *   RecipeLinksFile    what is SERVED and bundled: only what the app reads (`stripForServing`
 *                      over the judged part, `judge.ts`). No rejection and no note.
 *
 * The plan: `~/.claude/plans/wondrous-baking-plum.md` (2026-10-08: no people, no server); memory
 * `project_recipe_links_plan`.
 */

/** Bumped only by a change an older app could misread. The filename carries it (`.v1.json`). */
export const SCHEMA_MAJOR = 1 as const;

/** What a recipe asks for, in the unit the approver recorded it in. Cups and spoons never get here. */
export type NeedUnit = 'count' | 'g' | 'ml' | 'bunch' | 'package';
export type Amount = { amount: number; unit: NeedUnit };

/** "לפי הטעם", "קורט", "מעט": one sale unit covers it. */
export type Need = Amount | 'to-taste';

/**
 * What ONE sale unit of a member gives the cook.
 *
 *   Amount        an 18-pack gives 18 eggs; a bunch gives 1 bunch; a 200 g bag gives 200 g
 *   'whole-pack'  any amount a recipe asks for (salt, spices): one pack covers it
 *   'by-weight'   sold by the kilo (and by the piece when `pricingType` is `both`): the cart
 *                 takes grams as kilos and a count as pieces, no conversion between them
 */
export type Provides = Amount | 'whole-pack' | 'by-weight';

/**
 * The fields that decide how a product is SOLD, as approved. 🔴 A change to any of them under the
 * same name takes the member out of "add all" until it is re-approved: an 18-pack that became a
 * 12-pack would otherwise be bought as if it still held 18.
 */
export type SaleModel = { pricingType: string; isPack: boolean; isHalf: boolean; showPriceBy: string };

export type Member = {
  id: string;
  /** The product's name when it was approved. 🔴 A different live name hides the member. */
  name: string;
  sale: SaleModel;
  /** "רגיל", "אורגני", "מהדרין"… what the customer's remembered pick is (never a pack size). */
  variant: string;
  provides: Provides;
};

export type ConceptKind = 'count' | 'weight' | 'volume' | 'bunch' | 'package';

export type Concept = {
  /** Hebrew, as a cook says it: "ביצים", "כוסברה טרייה". */
  label: string;
  kind: ConceptKind;
  /** A staple most kitchens hold (Rom, 2026-10-07: shown on its row, never added by "add all"). */
  pantry?: boolean;
  /** Preselected when the customer has no pick of their own (Rom, 2026-10-07). */
  defaultVariant?: string;
  /** Category ids a member must sit in at least one of (eggs: 284). */
  allowedCategories: number[];
  members: Member[];
};

/**
 * 🔴 A SUBSTITUTE IS SHOWN AS ONE. Rom, 2026-10-07 ("תחליף מסומן"): when the shop does not sell
 * what a line names but sells what a cook would use instead (grana padano for parmesan), the row
 * offers it AND says it is a substitute. Never set on a link to the ingredient itself.
 */
export type LineLink = { concept: string; need: Need; substitute?: true };

/**
 * One ingredient line's decision.
 *
 *   mode 'all'   every link is needed: "מלח ופלפל" is salt AND pepper
 *   mode 'any'   one of them: "חמאה או שמן" is butter OR oil, one product
 *   notSold      plain text; 'assortment-gap' goes on Rom's list (decision 4), water does not
 */
export type LineDecision =
  | { mode: 'all' | 'any'; links: LineLink[] }
  | { notSold: 'assortment-gap' | 'not-a-shop-item' };

export type RecipeEntry = {
  /** 🔴 A slug WordPress reuses for another post must not inherit this recipe's approvals. */
  postId?: number;
  /** Keyed by the mapper's own `plainText(row.text)`: an edited line stops matching, by design. */
  lines: Record<string, LineDecision>;
};

/** The served file. Keyed by `normalizeSlug`. */
export type RecipeLinksFile = {
  schema: typeof SCHEMA_MAJOR;
  concepts: Record<string, Concept>;
  recipes: Record<string, RecipeEntry>;
};

// ── the git-only record ─────────────────────────────────────────────────────

export type Approval = {
  /** An approver LABEL ("staff-1", "rom"), never a person's name: git history is shared. */
  approvedBy?: string;
  approvedAt?: string;
  /** Set when Rom checked this item in his sample. */
  sampledBy?: string;
  note?: string;
};

export type MemberRecord = Member &
  Approval & {
    /** A rule this member breaks on purpose, and why (a household root, a name, a category). */
    override?: { household?: string; name?: string; category?: string; provides?: string };
  };

export type ConceptRecord = Omit<Concept, 'members'> &
  Approval & {
    members: MemberRecord[];
    /** Other first words a member's name may lead with ("פרסה" for "כרישה"). */
    aliases?: string[];
    /** Candidates looked at and refused. Never proposed again. */
    rejected?: { id: string; name: string; reason: string }[];
    /** What a count counts ("גבעולים", "ראשי שום"), for the judges' packets. Default: יח׳. */
    noun?: string;
  };

export type LineRecord = LineDecision &
  Approval & {
    /** Parts of an 'all' line the shop does not sell ("משמשים" in a list of fruit): Rom's gap list. */
    gaps?: string[];
  };

export type RecipeRecord = { postId?: number; title?: string; lines: Record<string, LineRecord> };

export type ApprovedFile = {
  schema: typeof SCHEMA_MAJOR;
  concepts: Record<string, ConceptRecord>;
  recipes: Record<string, RecipeRecord>;
};

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * A recipe's key, computed WITHOUT the recipe index.
 *
 * 🔴 `state/recipes.ts`'s `canonicalSlug` resolves against the index, so a deep link that lands
 * before the index has loaded passes through unchanged, URL-decoded by React Navigation, and
 * would miss this file. WordPress keys a Hebrew recipe by its lowercase percent-encoding; this
 * produces exactly that from either form.
 */
export function normalizeSlug(slug: string): string {
  let decoded = slug;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    // A lone '%' is not encoding; treat the string as already decoded.
  }
  return encodeURIComponent(decoded).toLowerCase();
}

/** The served file from the git record: what the app reads, and nothing else. */
export function stripForServing(approved: ApprovedFile): RecipeLinksFile {
  const concepts: Record<string, Concept> = {};
  for (const [id, c] of Object.entries(approved.concepts)) {
    concepts[id] = {
      label: c.label,
      kind: c.kind,
      ...(c.pantry ? { pantry: true } : {}),
      ...(c.defaultVariant ? { defaultVariant: c.defaultVariant } : {}),
      allowedCategories: [...c.allowedCategories],
      members: c.members.map((m) => ({
        id: m.id,
        name: m.name,
        sale: { ...m.sale },
        variant: m.variant,
        provides: typeof m.provides === 'string' ? m.provides : { ...m.provides },
      })),
    };
  }
  // 🔴 Built with `Object.fromEntries`, never by assignment: a slug or a line text is WordPress's
  // text, and `recipes["__proto__"] = …` sets a prototype instead of serving the recipe.
  const recipes: Record<string, RecipeEntry> = Object.fromEntries(
    Object.entries(approved.recipes).map(([slug, r]) => {
      const lines: Record<string, LineDecision> = Object.fromEntries(
        Object.entries(r.lines).map(([text, l]): [string, LineDecision] => [
          text,
          'notSold' in l
            ? { notSold: l.notSold }
            : {
                mode: l.mode,
                links: l.links.map((k) => ({ concept: k.concept, need: k.need, ...(k.substitute ? { substitute: true as const } : {}) })),
              },
        ]),
      );
      return [slug, { ...(r.postId ? { postId: r.postId } : {}), lines }];
    }),
  );
  return { schema: SCHEMA_MAJOR, concepts, recipes };
}

// ── validation ──────────────────────────────────────────────────────────────

const NEED_UNITS: readonly string[] = ['count', 'g', 'ml', 'bunch', 'package'];
const KINDS: readonly string[] = ['count', 'weight', 'volume', 'bunch', 'package'];

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isAmount = (v: unknown): v is Amount =>
  isObj(v) && typeof v.amount === 'number' && Number.isFinite(v.amount) && v.amount > 0 && NEED_UNITS.includes(v.unit as string);

/**
 * Structural check of a served file. 🔴 The app keeps its LAST GOOD file when this fails, so a
 * broken publish can never blank the recipe pages, and never makes them guess.
 */
export function parseRecipeLinksFile(json: unknown): { file: RecipeLinksFile } | { error: string } {
  if (!isObj(json)) return { error: 'not an object' };
  if (json.schema !== SCHEMA_MAJOR) return { error: `schema ${String(json.schema)}, expected ${SCHEMA_MAJOR}` };
  if (!isObj(json.concepts) || !isObj(json.recipes)) return { error: 'concepts or recipes missing' };

  for (const [id, c] of Object.entries(json.concepts)) {
    if (!isObj(c)) return { error: `concept ${id}: not an object` };
    if (typeof c.label !== 'string' || !c.label) return { error: `concept ${id}: no label` };
    if (!KINDS.includes(c.kind as string)) return { error: `concept ${id}: kind ${String(c.kind)}` };
    if (!Array.isArray(c.allowedCategories) || !c.allowedCategories.every((n) => Number.isInteger(n))) {
      return { error: `concept ${id}: allowedCategories` };
    }
    if (!Array.isArray(c.members)) return { error: `concept ${id}: members` };
    for (const m of c.members) {
      if (!isObj(m) || typeof m.id !== 'string' || typeof m.name !== 'string' || typeof m.variant !== 'string') {
        return { error: `concept ${id}: a member is malformed` };
      }
      const s = m.sale;
      if (
        !isObj(s) ||
        typeof s.pricingType !== 'string' ||
        typeof s.isPack !== 'boolean' ||
        typeof s.isHalf !== 'boolean' ||
        typeof s.showPriceBy !== 'string'
      ) {
        return { error: `concept ${id}: member ${String(m.id)} has no sale model` };
      }
      if (!(m.provides === 'whole-pack' || m.provides === 'by-weight' || isAmount(m.provides))) {
        return { error: `concept ${id}: member ${String(m.id)} provides` };
      }
    }
  }

  for (const [slug, r] of Object.entries(json.recipes)) {
    if (!isObj(r) || !isObj(r.lines)) return { error: `recipe ${slug}: lines` };
    for (const [text, l] of Object.entries(r.lines)) {
      if (!isObj(l)) return { error: `recipe ${slug}: line "${text}"` };
      if ('notSold' in l) {
        if (l.notSold !== 'assortment-gap' && l.notSold !== 'not-a-shop-item') {
          return { error: `recipe ${slug}: line "${text}" notSold` };
        }
        continue;
      }
      if (l.mode !== 'all' && l.mode !== 'any') return { error: `recipe ${slug}: line "${text}" mode` };
      if (!Array.isArray(l.links) || !l.links.length) return { error: `recipe ${slug}: line "${text}" links` };
      for (const k of l.links) {
        if (!isObj(k) || typeof k.concept !== 'string') return { error: `recipe ${slug}: line "${text}" link` };
        // 🔴 An OWN key only: "constructor" or "__proto__" must never pass as a concept.
        if (!Object.prototype.hasOwnProperty.call(json.concepts, k.concept)) {
          return { error: `recipe ${slug}: line "${text}" names unknown concept ${k.concept}` };
        }
        if (!(k.need === 'to-taste' || isAmount(k.need))) return { error: `recipe ${slug}: line "${text}" need` };
        if (k.substitute !== undefined && k.substitute !== true) return { error: `recipe ${slug}: line "${text}" substitute` };
      }
    }
  }
  return { file: json as unknown as RecipeLinksFile };
}
