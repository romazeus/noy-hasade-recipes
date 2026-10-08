/**
 * The live catalogue and recipes, read exactly as the app reads them, for the recipe-links
 * tooling (`check.ts`, `snapshot.ts`).
 *
 * 🔴 THE LINE TEXT IS THE APP'S OWN `plainText`, AND THE SLUG IS `normalizeSlug`. An approved
 * line is keyed by that text, so a checker that normalised a line one character differently from
 * the mapper would report every line undecided, or worse, call a line decided that the app will
 * never find. Same module, same string.
 *
 * Plain `fetch`, no native stubs: everything imported here is pure. Read-only: the two POSTs are
 * the backend's read endpoints, the same calls every app launch makes.
 */
import { mapRecipeSummary, plainText, type WpRecipeDetail, type WpRecipeListRow } from '@/data/mappers/mapRecipe';
import { reduceProduct } from '@/data/recipeLinks/catalog';
import { normalizeSlug } from '@/data/recipeLinks/schema';
import type { CatalogProduct, LiveRecipe } from '@/data/recipeLinks/rules';

const BASE = 'https://api.noyhasade.co.il/api';

async function call(path: string, init?: RequestInit): Promise<any> {
  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}origin=web`;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { ...init, headers: { Accept: 'application/json', 'Content-Type': 'application/json' } });
      if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (attempt >= 2) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

/** The raw product, kept for the snapshot (images, prices), alongside the reduced one. */
export type RawProduct = Record<string, any>;

export async function fetchCatalog(): Promise<{ raw: RawProduct[]; byId: Map<string, CatalogProduct> }> {
  const json = await call('/products', { method: 'POST', body: '{}' });
  if (!Array.isArray(json?.products)) throw new Error('/products carried no products array');
  const raw: RawProduct[] = json.products;
  const byId = new Map<string, CatalogProduct>();
  for (const p of raw) byId.set(String(p.id), reduceProduct(p));
  return { raw, byId };
}

/** Category id → title, with its parent's title, for the snapshot and the review page. */
export async function fetchCategoryTitles(): Promise<Map<number, string>> {
  const json = await call('/categories', { method: 'POST', body: '{}' });
  const list: any[] = Array.isArray(json?.categories) ? json.categories : [];
  const byId = new Map(list.map((c) => [Number(c.id), c]));
  const out = new Map<number, string>();
  for (const c of list) {
    const parent = byId.get(Number(c.parent));
    out.set(Number(c.id), parent ? `${parent.title} › ${c.title}` : String(c.title));
  }
  return out;
}

export type LiveRecipeFull = LiveRecipe & {
  image: string;
  servings?: string;
  /** The ids the merchant curated in WordPress (`products_buy`), as a hint for proposals. */
  productsBuy: string[];
  /** Lines in reading order, with their group heading. */
  groups: { heading?: string; lines: string[] }[];
};

/** Every live recipe, de-duplicated by slug (the index lists each one up to twice). */
export async function fetchRecipes(concurrency = 6): Promise<LiveRecipeFull[]> {
  const index = await call('/recipe_categories');
  const rows = new Map<string, WpRecipeListRow>();
  for (const cat of index?.recipe_categories ?? []) {
    for (const row of cat?.recipes?.posts ?? []) if (row?.slug && !rows.has(row.slug)) rows.set(row.slug, row);
  }
  const queue = [...rows.values()];
  const out: LiveRecipeFull[] = [];
  async function worker() {
    for (let row = queue.shift(); row; row = queue.shift()) {
      const summary = mapRecipeSummary(row);
      if (!summary) continue;
      let decoded = summary.id;
      try {
        decoded = decodeURIComponent(summary.id);
      } catch {
        // keep the raw slug
      }
      const json = await call(`/content?slug=${encodeURIComponent(decoded)}`);
      const d: WpRecipeDetail | undefined = json?.content;
      if (!d || d.template !== 'matkon') throw new Error(`recipe ${decoded} did not resolve`);
      const groups = (d.acf?.ingredients?.ingredients ?? []).map((g) => ({
        heading: plainText(g.title ?? '') || undefined,
        lines: (g.ingredients ?? []).map((r) => plainText(r.text ?? '')).filter(Boolean),
      }));
      out.push({
        slug: normalizeSlug(summary.id),
        postId: summary.postId,
        title: (d.title ?? summary.title).trim(),
        image: summary.image,
        servings: summary.servings,
        productsBuy: (d.acf?.products_buy ?? []).map(String),
        groups,
        lines: groups.flatMap((g) => g.lines),
      });
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out.sort((a, b) => (b.postId ?? 0) - (a.postId ?? 0));
}
