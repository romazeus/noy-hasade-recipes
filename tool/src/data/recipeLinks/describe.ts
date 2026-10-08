/**
 * What a recipe line ORDERS, and how a product, a need and an order read in Hebrew.
 *
 * 🔴 `orderOf` IS THE ORDER THE JUDGES APPROVE, SO IT IS THE ORDER THE APP MUST PLACE. The order
 * critic (`judge.ts`) sees exactly this for every link, and stage 2's planner (`recipeCartPlan.ts`,
 * Tier 1) builds on it rather than re-deriving it: two copies of this table would let the app
 * order something no judge ever saw. It is the plan's table of (recipe unit × sale option):
 *
 *   a staple                               never in "add all"; its row adds one step
 *   packs of a size, same unit as the need  ceil(need / size) packs
 *   a whole pack                            one pack, whatever the amount
 *   by weight, grams                        kilos, rounded UP to half a kilo
 *   by weight, a count or "to taste"        pieces, only when the product is sold by the piece too
 *   anything else                           added from its row only
 */
import { packsFor, unitPrice, type CatalogProduct } from './rules';
import type { Need, Provides } from './schema';

export type Order = { kind: 'units'; n: number } | { kind: 'kg'; kg: number } | { kind: 'row' } | { kind: 'staple' };

export function orderOf(need: Need, provides: Provides, pricingType: string, pantry: boolean): Order {
  if (pantry) return { kind: 'staple' };
  if (provides === 'by-weight') {
    if (need === 'to-taste') return pricingType === 'both' ? { kind: 'units', n: 1 } : { kind: 'row' };
    if (need.unit === 'g') return { kind: 'kg', kg: Math.max(0.5, Math.ceil(need.amount / 500 - 1e-9) / 2) };
    // Pieces round UP: half a lemon is one lemon.
    if (need.unit === 'count') return pricingType === 'both' ? { kind: 'units', n: Math.ceil(need.amount - 1e-9) } : { kind: 'row' };
    return { kind: 'row' };
  }
  const n = packsFor(need, provides);
  return n == null ? { kind: 'row' } : { kind: 'units', n };
}

const num = (n: number) => String(Math.round(n * 1000) / 1000);

export function priceText(p: CatalogProduct): string {
  if (p.pricingType === 'unitaskg' && p.weight) return `₪${(p.price * p.weight).toFixed(2)} ליחידה (כ-${num(p.weight)} ק"ג)`;
  if (p.pricingType === 'kg') return `₪${p.price} לק"ג`;
  if (p.pricingType === 'both') return `₪${p.price} לק"ג${p.weight ? `, יחידה כ-${num(p.weight)} ק"ג` : ''}`;
  return `₪${p.price}`;
}

export function needText(n: Need, noun = 'יח׳'): string {
  if (n === 'to-taste') return 'לפי הטעם (יחידה אחת מספיקה)';
  const unit = { count: noun, g: 'גרם', ml: 'מ"ל', bunch: 'צרור', package: 'אריזה' }[n.unit];
  return `${num(n.amount)} ${unit}`;
}

export function providesText(p: Provides, noun = 'יח׳'): string {
  if (p === 'whole-pack') return 'אריזה אחת מספיקה לכל מתכון';
  if (p === 'by-weight') return 'נמכר במשקל';
  return `כל יחידה מכילה ${needText(p, noun)}`;
}

/**
 * What an order costs, from the ORDER itself. 🔴 Never from the line's need: a planted error shows
 * ten times the amount, and a price computed from the real amount beside it would give the plant
 * away (the first packets did exactly that, 2026-10-08).
 */
export function orderCost(o: Order, provides: Provides, p: CatalogProduct): number | null {
  if (o.kind === 'kg') return o.kg * unitPrice(p);
  if (o.kind !== 'units') return null;
  if (provides === 'by-weight') return p.weight ? o.n * p.weight * unitPrice(p) : null;
  return o.n * unitPrice(p);
}

/** The order as the critic reads it, with what it costs. */
export function orderText(o: Order, provides: Provides, p: CatalogProduct | undefined): string {
  if (o.kind === 'staple') return 'לא נכנס לכפתור "הוסיפו את כל המצרכים" (מצרך בסיס); השורה מוסיפה יחידה אחת בלחיצה';
  if (o.kind === 'row') return 'לא נכנס לכפתור "הוסיפו את כל המצרכים"; הלקוח מוסיף מהשורה';
  const cost = p ? orderCost(o, provides, p) : null;
  const price = cost == null ? '' : ` (כ-₪${cost.toFixed(2)})`;
  return o.kind === 'units' ? `הכפתור מוסיף ${o.n} יח׳ מהמוצר${price}` : `הכפתור מוסיף ${num(o.kg)} ק"ג${price}`;
}
