/**
 * One raw product from the shop API (`POST /products`, or `GET /products?id[]=…`), reduced to what
 * the recipe-links rules read.
 *
 * 🔴 ONE REDUCER FOR EVERY READER: the daily run (`scripts/recipe-links/live.ts`) and anything that
 * fetches products by id. The API returns
 * `id` as a NUMBER; a map keyed by it would miss every member and every save would pass unchecked
 * (design review, 2026-10-07), so the key is `String(id)` here and nowhere else.
 */
import type { CatalogProduct } from './rules';

export type RawProduct = Record<string, unknown>;

export function reduceProduct(p: RawProduct): CatalogProduct {
  const weight = p.weight == null || p.weight === '' ? null : Number(p.weight);
  return {
    id: String(p.id),
    name: String(p.name ?? ''),
    categories: Array.isArray(p.categories) ? p.categories.map(Number) : [],
    pricingType: String(p.pricingType ?? ''),
    isPack: !!p.isPack,
    isHalf: !!p.isHalf,
    showPriceBy: String(p.showPriceBy ?? ''),
    weight: weight != null && Number.isFinite(weight) ? weight : null,
    price: Number(p.price) || 0,
    regularPrice: Number(p.regular_price) || 0,
    // The app's own reading (`mapAlgoliaProduct.ts`): only an explicit false means sold out.
    inStock: !(p.stockStatus === false || p.stockStatus === 'false' || p.stockStatus === 0),
  };
}

/** The ids a by-id request asked for and did not get back: each one blocks a save. */
export function missingIds(asked: readonly string[], got: ReadonlyMap<string, CatalogProduct>): string[] {
  return asked.filter((id) => !got.has(id));
}
