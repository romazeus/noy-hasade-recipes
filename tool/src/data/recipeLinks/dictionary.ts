/**
 * The dictionary as a session WRITES it, and as the record STORES it.
 *
 * A session proposes in a compact form: one `Spec` per concept (`concepts.json`) and one line of a
 * small language per recipe line (`lines.tsv`). `scripts/recipe-links/run.ts prepare` writes the
 * current dictionary in that form, the session edits it, and `run.ts packets` reads it back. Both
 * directions live here, so what the session reads and what it writes can never drift apart
 * (`dictionary.test.ts` round-trips them).
 *
 * 🔴 NAMES AND SALE MODELS ARE NEVER WRITTEN BY HAND. A member is written as an id, a variant and
 * what one unit gives; its name and how it is sold come from the LIVE catalogue every time the
 * record is built. A renamed product therefore changes the record, and a changed record is judged
 * again before it is served (`judge.ts`).
 *
 * The line language, as `scripts/recipe-links/proposals/lines.txt` used it on 2026-10-07:
 *
 *   concept[:amount[g|ml|b|c|p]]    no amount = "to taste" (one sale unit covers it); no suffix =
 *                                    the concept's own unit
 *   a + b      the line needs both          a | b      the line needs one of them
 *   -          not a shop item (water, ice)  ?          the shop does not sell it
 *   ?word      inside a line: that part is not sold
 *   ~concept   a SUBSTITUTE: the shop does not sell what the line names; the row says so
 *   # note     after the decision: why
 *   skip # why looked at and cannot be decided: plain text, never asked again while the text holds
 *              (no claim is made, unlike `?`). The reason is required.
 */
import type { CatalogProduct } from './rules';
import type { ConceptKind, ConceptRecord, LineRecord, MemberRecord, NeedUnit, Provides } from './schema';

/** What one sale unit gives, compactly: a number in the concept's unit, 'w' a whole pack, 'kg' by weight, or '200g'. */
export type P = number | 'w' | 'kg' | `${number}${'g' | 'ml' | 'b' | 'c' | 'p'}`;
export type Override = { name?: string; provides?: string; category?: string; household?: string };

export type Spec = {
  label: string;
  kind: ConceptKind;
  cats: number[];
  pantry?: true;
  def?: string;
  aliases?: string[];
  m: [id: string, variant: string, provides: P, override?: Override][];
  /** Looked at and refused, with the reason: never proposed again. */
  x?: [id: string, reason: string][];
  note?: string;
  /** What a count counts ("גבעולים", "ראשי שום"). Default: יח׳. */
  noun?: string;
};

export const UNIT_OF: Readonly<Record<ConceptKind, NeedUnit>> = { count: 'count', weight: 'g', volume: 'ml', bunch: 'bunch', package: 'package' };
const SUFFIX: Readonly<Record<string, NeedUnit>> = { g: 'g', ml: 'ml', b: 'bunch', c: 'count', p: 'package' };
const LETTER: Readonly<Record<NeedUnit, string>> = { g: 'g', ml: 'ml', bunch: 'b', count: 'c', package: 'p' };

export function providesOf(p: P, kind: ConceptKind): Provides {
  if (p === 'w') return 'whole-pack';
  if (p === 'kg') return 'by-weight';
  if (typeof p === 'number') return { amount: p, unit: UNIT_OF[kind] };
  const m = /^(\d+(?:\.\d+)?)(g|ml|b|c|p)$/.exec(p);
  if (!m) throw new Error(`cannot read provides "${String(p)}"`);
  return { amount: Number(m[1]), unit: SUFFIX[m[2]] };
}

export function pOf(provides: Provides, kind: ConceptKind): P {
  if (provides === 'whole-pack') return 'w';
  if (provides === 'by-weight') return 'kg';
  if (provides.unit === UNIT_OF[kind]) return provides.amount;
  return `${provides.amount}${LETTER[provides.unit]}` as P;
}

/**
 * A concept record from its spec. A member's name and sale model come from `catalog`; a member the
 * catalogue no longer returns keeps what `previous` knew of it (it is then simply not served), and
 * an id that is neither live nor known is an error: a typo must never become a member.
 */
export function conceptOf(
  cid: string,
  s: Spec,
  catalog: ReadonlyMap<string, Pick<CatalogProduct, 'name' | 'pricingType' | 'isPack' | 'isHalf' | 'showPriceBy'>>,
  previous: ConceptRecord | undefined,
  errors: string[],
): ConceptRecord {
  const members: MemberRecord[] = [];
  for (const [id, variant, prov, override] of s.m) {
    const live = catalog.get(id);
    const known = previous?.members.find((m) => m.id === id);
    if (!live && !known) {
      errors.push(`concept ${cid}: member ${id} is not in the catalogue and was never a member`);
      continue;
    }
    let provides: Provides;
    try {
      provides = providesOf(prov, s.kind);
    } catch (e) {
      errors.push(`concept ${cid}: member ${id}: ${(e as Error).message}`);
      continue;
    }
    members.push({
      id,
      name: live ? live.name : known!.name,
      sale: live
        ? { pricingType: live.pricingType, isPack: live.isPack, isHalf: live.isHalf, showPriceBy: live.showPriceBy }
        : { ...known!.sale },
      variant: variant || 'רגיל',
      provides,
      ...(override ? { override } : {}),
    });
  }
  const priorName = new Map((previous?.rejected ?? []).map((r) => [r.id, r.name]));
  return {
    label: s.label,
    kind: s.kind,
    ...(s.pantry ? { pantry: true } : {}),
    ...(s.def ? { defaultVariant: s.def } : {}),
    allowedCategories: [...s.cats],
    members,
    ...(s.aliases ? { aliases: [...s.aliases] } : {}),
    rejected: (s.x ?? []).map(([id, reason]) => ({ id, name: catalog.get(id)?.name ?? priorName.get(id) ?? '(not in the catalogue)', reason })),
    ...(s.note ? { note: s.note } : {}),
    ...(s.noun ? { noun: s.noun } : {}),
  };
}

export function specOf(c: ConceptRecord): Spec {
  return {
    label: c.label,
    kind: c.kind,
    cats: [...c.allowedCategories],
    ...(c.pantry ? { pantry: true as const } : {}),
    ...(c.defaultVariant ? { def: c.defaultVariant } : {}),
    ...(c.aliases?.length ? { aliases: [...c.aliases] } : {}),
    m: c.members.map((m): Spec['m'][number] => {
      const o = (m as MemberRecord).override;
      return o ? [m.id, m.variant, pOf(m.provides, c.kind), { ...o }] : [m.id, m.variant, pOf(m.provides, c.kind)];
    }),
    ...(c.rejected?.length ? { x: c.rejected.map((r): [string, string] => [r.id, r.reason]) } : {}),
    ...(c.note ? { note: c.note } : {}),
    ...(c.noun ? { noun: c.noun } : {}),
  };
}

/** One line's decision from the line language. `kindOf` answers for a concept id, or undefined. */
export function lineOf(text: string, kindOf: (cid: string) => ConceptKind | undefined, errors: string[], ref: string): LineRecord | null {
  const hash = text.indexOf('#');
  const spec = (hash >= 0 ? text.slice(0, hash) : text).trim();
  const note = hash >= 0 ? text.slice(hash + 1).trim() : '';
  const withNote = (r: LineRecord): LineRecord => (note ? { ...r, note } : r);
  if (spec === '-') return withNote({ notSold: 'not-a-shop-item' });
  if (spec === '?') return withNote({ notSold: 'assortment-gap' });
  if (!spec) {
    errors.push(`${ref}: no decision`);
    return null;
  }
  const any = /\s\|\s/.test(spec);
  const all = /\s\+\s/.test(spec);
  if (any && all) {
    errors.push(`${ref}: mixes "+" and "|"`);
    return null;
  }
  const parts = spec.split(any ? /\s\|\s/ : /\s\+\s/).map((t) => t.trim()).filter(Boolean);
  const gaps: string[] = [];
  const links: { concept: string; need: { amount: number; unit: NeedUnit } | 'to-taste'; substitute?: true }[] = [];
  for (const raw of parts) {
    if (raw.startsWith('?')) {
      gaps.push(raw.slice(1).trim());
      continue;
    }
    const substitute = raw.startsWith('~');
    const t = substitute ? raw.slice(1) : raw;
    const m = /^([a-z0-9-]+)(?::(\d+(?:\.\d+)?)(g|ml|b|c|p)?)?$/.exec(t);
    if (!m) {
      errors.push(`${ref}: cannot read "${t}"`);
      return null;
    }
    const kind = kindOf(m[1]);
    if (!kind) {
      errors.push(`${ref}: unknown concept ${m[1]}`);
      return null;
    }
    links.push({
      concept: m[1],
      need: m[2] ? { amount: Number(m[2]), unit: m[3] ? SUFFIX[m[3]] : UNIT_OF[kind] } : 'to-taste',
      ...(substitute ? { substitute: true as const } : {}),
    });
  }
  if (!links.length) {
    errors.push(`${ref}: no links`);
    return null;
  }
  return withNote({ mode: any ? 'any' : 'all', links, ...(gaps.length ? { gaps } : {}) });
}

/** The line language for a decision: `lineOf(specOfLine(r)) ≡ r`. */
export function specOfLine(r: LineRecord, kindOf: (cid: string) => ConceptKind | undefined): string {
  const note = r.note ? ` # ${r.note}` : '';
  if ('notSold' in r) return (r.notSold === 'not-a-shop-item' ? '-' : '?') + note;
  const parts = r.links.map((k) => {
    const kind = kindOf(k.concept);
    const amount =
      k.need === 'to-taste' ? '' : `:${k.need.amount}${kind && k.need.unit === UNIT_OF[kind] ? '' : LETTER[k.need.unit]}`;
    return `${k.substitute ? '~' : ''}${k.concept}${amount}`;
  });
  for (const g of r.gaps ?? []) parts.push(`?${g}`);
  return parts.join(r.mode === 'any' ? ' | ' : ' + ') + note;
}

/** `skip # why` → the reason ('' when it has none); anything else → null. */
export function skipOf(spec: string): string | null {
  const m = /^\s*skip\b\s*(?:#\s*(.*))?$/.exec(spec);
  return m ? (m[1] ?? '').trim() : null;
}
