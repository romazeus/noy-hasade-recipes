/**
 * THE GATE: what a recipe link must pass before the app may show it.
 *
 * Rom, 2026-10-08: *"אתה יכול לבנות מערכת שתדייק ב99.9%... בלי התערבות שלי או של כל אדם אחר"*.
 * No person approves a link any more. A link (a recipe line pointing at a product, with an amount)
 * is served only when ALL of these hold (plan, "How a link earns its place"):
 *
 *   1. it was proposed (the dictionary, `dictionary.ts`);
 *   2. the rules pass (`rules.ts`, with the live catalogue; an error makes THAT line plain text);
 *   3. the PICKER, a judge that did not write it, named the product among every live product that
 *      shares a word with the line;
 *   4. the order CRITIC, a second judge, called the exact order "add all" would place right;
 *   5. both judges were PROVEN in the same batch: every batch carries planted errors, and a judge
 *      that lets ONE through is not trusted (its batch is void and runs again once; a second miss
 *      publishes nothing);
 *   6. a pair judged wrong twice is blocked for good: a disagreement is never argued;
 *   7. what is judged comes from the CONTENT, never from a session's account of what it changed:
 *      a verdict holds only while the hash of exactly what the judges saw (`pairHash`) is unchanged.
 *
 * Pure: the clock, the files and the judges themselves belong to `scripts/recipe-links/run.ts`.
 *
 * 🔴 THE PICKER DECIDES WHAT A CONCEPT IS, THE CRITIC DECIDES A LINE. A product the picker refused
 * for any line leaves its concept everywhere (the served file has one member list per concept); an
 * order the critic refused costs only that line, because an amount belongs to a line.
 */
import { orderOf, orderText, needText, priceText, providesText, type Order } from './describe';
import { checkRules, HOUSEHOLD_ROOTS, sameSale, type CatalogProduct, type Finding, type LiveRecipe } from './rules';
import { candidates, type Indexed } from './search';
import { parseRecipeLinksFile, stripForServing, type ApprovedFile, type ConceptRecord, type LineLink, type LineRecord, type MemberRecord, type Need, type RecipeLinksFile } from './schema';

// ── the record ──────────────────────────────────────────────────────────────

export type Verdict = {
  /** `pairHash` of what was judged. Any other hash means it was never judged. */
  h: string;
  /** The picker named this product for this line part. */
  picker?: boolean;
  /** The critic called the order right. */
  critic?: boolean;
  /** A judge's reason, kept for a no. */
  why?: string;
  at: string;
  /** Judgings that ended "no". Two block the pair for good. */
  strikes: number;
};

/** A product that is certainly NOT the concept's ingredient: the picker's planted errors. */
export type Plant = { concept: string; id: string; why: string };

export type Source = {
  schema: 1;
  /** The proposals: every concept and every line decision, served or not. */
  file: ApprovedFile;
  verdicts: Record<string, Verdict>;
  plants: Plant[];
  /**
   * Lines the proposer looked at and could not decide, with why: plain text, and never asked again
   * while the text stays the same (slug → line text → reason). Without it, one undecidable line would
   * wake the AI every day (`watchRule.ts`).
   */
  skipped?: Record<string, Record<string, string>>;
  /** The last published run's view of the world, for the size guard. */
  meta: { catalogSize: number; recipeCount: number; at?: string };
};

export const MAX_STRIKES = 2;

// ── links and pairs ─────────────────────────────────────────────────────────

export type Link = {
  key: string;
  text: string;
  concept: string;
  mode: 'all' | 'any';
  need: Need;
  substitute: boolean;
  /** The recipes that use this line, as context for the judges. */
  recipes: { slug: string; title: string }[];
};

export type Pair = { key: string; h: string; link: Link; member: MemberRecord; pantry: boolean };

const needKey = (n: Need) => (n === 'to-taste' ? 'to-taste' : `${n.amount}${n.unit}`);

export const linkKey = (text: string, concept: string, need: Need, mode: string, substitute: boolean) =>
  JSON.stringify([text, concept, needKey(need), mode, substitute ? 1 : 0]);

export const pairKey = (link: string, member: string) => `${link}#${member}`;

/** cyrb53, twice with different seeds: 106 bits, enough that a changed pair never reads as judged. */
function hash53(s: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Everything a judge saw of one pair, and nothing it did not: a change to any of it is a new pair. */
export function pairHash(link: Link, c: Pick<ConceptRecord, 'label' | 'kind' | 'pantry'>, m: MemberRecord): string {
  const content = JSON.stringify([
    link.text,
    link.mode,
    needKey(link.need),
    link.substitute,
    link.concept,
    c.label,
    c.kind,
    !!c.pantry,
    m.id,
    m.name,
    [m.sale.pricingType, m.sale.isPack, m.sale.isHalf, m.sale.showPriceBy.trim()],
    m.variant,
    typeof m.provides === 'string' ? m.provides : [m.provides.amount, m.provides.unit],
  ]);
  return `${hash53(content, 1)}.${hash53(content, 2)}`;
}

/** The decided lines of the LIVE recipes, as links and pairs. A recipe whose post id moved is out. */
export function pairsOf(file: ApprovedFile, live: readonly LiveRecipe[]): { links: Map<string, Link>; pairs: Map<string, Pair> } {
  const links = new Map<string, Link>();
  const pairs = new Map<string, Pair>();
  for (const lr of live) {
    const entry = Object.prototype.hasOwnProperty.call(file.recipes, lr.slug) ? file.recipes[lr.slug] : undefined;
    if (!entry || (entry.postId && lr.postId && entry.postId !== lr.postId)) continue;
    for (const text of new Set(lr.lines)) {
      const d = Object.prototype.hasOwnProperty.call(entry.lines, text) ? entry.lines[text] : undefined;
      if (!d || 'notSold' in d) continue;
      for (const k of d.links) {
        const c = Object.prototype.hasOwnProperty.call(file.concepts, k.concept) ? file.concepts[k.concept] : undefined;
        if (!c) continue;
        const key = linkKey(text, k.concept, k.need, d.mode, !!k.substitute);
        let link = links.get(key);
        if (!link) {
          link = { key, text, concept: k.concept, mode: d.mode, need: k.need, substitute: !!k.substitute, recipes: [] };
          links.set(key, link);
        }
        if (!link.recipes.some((r) => r.slug === lr.slug)) link.recipes.push({ slug: lr.slug, title: lr.title });
        for (const m of c.members) {
          const pk = pairKey(key, m.id);
          if (!pairs.has(pk)) pairs.set(pk, { key: pk, h: pairHash(link, c, m), link, member: m, pantry: !!c.pantry });
        }
      }
    }
  }
  return { links, pairs };
}

const judged = (v: Verdict | undefined, p: Pair) => !!v && v.h === p.h && v.picker !== undefined && v.critic !== undefined;

/**
 * What this run must judge: every pair never judged as it is now, plus `rotate` of the oldest judged
 * ones. A member the catalogue does not return today cannot be shown to a judge, so it waits, unjudged
 * and unserved, until it comes back: otherwise every quiet day would carry it as work.
 */
export function toJudge(
  pairs: ReadonlyMap<string, Pair>,
  verdicts: Readonly<Record<string, Verdict>>,
  rotate: number,
  isLive: (productId: string) => boolean = () => true,
): { fresh: Pair[]; rotated: Pair[]; blocked: Pair[] } {
  const fresh: Pair[] = [];
  const blocked: Pair[] = [];
  const ok: { p: Pair; at: string }[] = [];
  for (const p of pairs.values()) {
    const v = verdicts[p.key];
    if (!isLive(p.member.id)) continue;
    if (v && v.strikes >= MAX_STRIKES) blocked.push(p);
    else if (!judged(v, p)) fresh.push(p);
    else if (v!.picker && v!.critic) ok.push({ p, at: v!.at });
  }
  ok.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.p.key < b.p.key ? -1 : 1));
  return { fresh, rotated: ok.slice(0, rotate).map((x) => x.p), blocked };
}

// ── batches ─────────────────────────────────────────────────────────────────

/** A small seeded generator, so a run's batches can be rebuilt and its tests are exact. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(xs: readonly T[], r: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function idMaker(r: () => number): () => string {
  const used = new Set<string>();
  return () => {
    for (;;) {
      let s = 'i';
      for (let i = 0; i < 5; i++) s += '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(r() * 36)];
      if (!used.has(s)) {
        used.add(s);
        return s;
      }
    }
  };
}

export type PickerKey = { kind: 'picker'; role: 'real' | 'control'; link: string; numbers: Record<string, string>; plants: string[] };
export type CriticKey =
  | { kind: 'critic'; role: 'real'; pair: string }
  | { kind: 'critic'; role: 'plant'; corruption: 'count' | 'product' | 'staple'; pair: string };
export type Batch = {
  id: string;
  kind: 'picker' | 'critic';
  /** The packet a judge reads. */
  text: string;
  /** The answer key. 🔴 Never shown to a judge. */
  key: Record<string, PickerKey | CriticKey>;
  plants: number;
  /** Fewer planted errors than the minimum: the batch cannot prove its judge, so the run cannot publish. */
  unprovable: boolean;
};

export const minPlants = (real: number) => Math.max(10, Math.ceil(real / 10));

type World = { file: ApprovedFile; catalog: ReadonlyMap<string, CatalogProduct>; index: readonly Indexed<CatalogProduct>[]; plants: readonly Plant[] };

const conceptOf = (w: World, cid: string) => w.file.concepts[cid];
const livePlants = (w: World, cid: string, members: ReadonlySet<string>) =>
  w.plants.filter((p) => p.concept === cid && w.catalog.has(p.id) && !members.has(p.id)).map((p) => p.id);

function productLine(p: CatalogProduct): string {
  const size = p.showPriceBy.trim();
  return `${p.name}${size ? ` · ${size}` : ''} · ${priceText(p)}${p.inStock ? '' : ' · אזל כרגע'}`;
}

function contextLines(link: Link): string[] {
  const [first, ...rest] = link.recipes;
  return [`מתכון: ${first?.title ?? '?'}${rest.length ? ` (ועוד ${rest.length} מתכונים עם אותה שורה)` : ''}`, `שורה: "${link.text}"`];
}

function partLine(link: Link, c: ConceptRecord): string {
  const parts = [`החלק: ${c.label}`, `כמות: ${needText(link.need, c.noun)}`];
  if (link.mode === 'any') parts.push('השורה מבקשת אחד מכמה מצרכים, וזה אחד מהם');
  if (link.substitute) parts.push('מוצע כתחליף מסומן: החנות לא מוכרת את מה שהשורה מבקשת');
  return parts.join(' · ');
}

/** One picker item: the line part, and every candidate numbered in a random order. */
function pickerItem(w: World, link: Link, r: () => number, id: string, role: 'real' | 'control'): { id: string; text: string; key: PickerKey } | null {
  const c = conceptOf(w, link.concept);
  if (!c) return null;
  const members = c.members.map((m) => m.id).filter((x) => w.catalog.has(x));
  if (!members.length) return null;
  const memberSet = new Set(members);
  const plants = livePlants(w, link.concept, memberSet);
  const taken = new Set([...members, ...plants]);
  const searched = candidates(w.index, c.label, link.text)
    .map((h) => h.item)
    .filter((p) => !taken.has(p.id) && !p.categories.some((x) => HOUSEHOLD_ROOTS.includes(x)))
    .slice(0, 20)
    .map((p) => p.id);
  const ids = shuffle([...members, ...plants, ...searched], r);
  const numbers: Record<string, string> = {};
  const lines = [`### ${id}`, ...contextLines(link), partLine(link, c), 'מועמדים:'];
  ids.forEach((pid, i) => {
    numbers[String(i + 1)] = pid;
    lines.push(`  ${i + 1}. ${productLine(w.catalog.get(pid)!)}`);
  });
  return { id, text: lines.join('\n'), key: { kind: 'picker', role, link: link.key, numbers, plants } };
}

export function pickerBatches(w: World, real: readonly Link[], controls: readonly Link[], seed: number, size = 60): Batch[] {
  const r = rng(seed);
  const order = shuffle(real, r);
  const pool = shuffle(controls.filter((l) => livePlants(w, l.concept, new Set(conceptOf(w, l.concept)?.members.map((m) => m.id) ?? [])).length), r);
  const out: Batch[] = [];
  for (let b = 0; b * size < order.length; b++) {
    const nextId = idMaker(r);
    const chunk = order.slice(b * size, (b + 1) * size);
    const items: { id: string; text: string; key: PickerKey }[] = [];
    for (const link of chunk) {
      const it = pickerItem(w, link, r, nextId(), 'real');
      if (it) items.push(it);
    }
    const need = minPlants(items.length);
    let plants = items.reduce((n, it) => n + it.key.plants.length, 0);
    const inBatch = new Set(chunk.map((l) => l.key));
    for (const l of pool) {
      if (plants >= need) break;
      if (inBatch.has(l.key)) continue;
      const it = pickerItem(w, l, r, nextId(), 'control');
      if (!it || !it.key.plants.length) continue;
      inBatch.add(l.key);
      items.push(it);
      plants += it.key.plants.length;
    }
    const shuffled = shuffle(items, r);
    const id = `picker-${String(b + 1).padStart(2, '0')}`;
    out.push({
      id,
      kind: 'picker',
      text: shuffled.map((it) => it.text).join('\n\n') + '\n',
      key: Object.fromEntries(shuffled.map((it) => [it.id, it.key])),
      plants,
      unprovable: plants < need,
    });
  }
  return out;
}

/** Concepts that are certainly not staples, and staples, for the critic's planted staple errors. */
const NOT_STAPLE = new Set(['egg', 'tomato', 'cucumber', 'potato', 'carrot', 'onion', 'lemon', 'zucchini', 'eggplant', 'butter']);
const IS_STAPLE = new Set(['salt', 'sugar', 'flour']);

type CriticView = { product: CatalogProduct; pantry: boolean; order: Order };

function criticText(w: World, id: string, pair: Pair, view: CriticView): string {
  const c = conceptOf(w, pair.link.concept)!;
  // 🔴 Every item reads alike, planted or not: a swapped-in product carries the member's "what one
  // unit holds" too, or its missing note would give the plant away.
  const showProvides = providesText(pair.member.provides, c.noun);
  return [
    `### ${id}`,
    ...contextLines(pair.link),
    partLine(pair.link, c),
    `תחליף מסומן: ${pair.link.substitute ? 'כן' : 'לא'} · מצרך בסיס: ${view.pantry ? 'כן' : 'לא'}`,
    `המוצר: ${productLine(view.product)}${showProvides ? ` · ${showProvides}` : ''}`,
    `ההזמנה: ${orderText(view.order, pair.member.provides, view.product)}`,
  ].join('\n');
}

function viewOf(w: World, pair: Pair): CriticView | null {
  const p = w.catalog.get(pair.member.id);
  if (!p) return null;
  return { product: p, pantry: pair.pantry, order: orderOf(pair.link.need, pair.member.provides, pair.member.sale.pricingType, pair.pantry) };
}

/** A real pair, shown WRONG in a way no careful judge can miss. */
function corrupt(w: World, pair: Pair, r: () => number): { view: CriticView; corruption: 'count' | 'product' | 'staple' } | null {
  const base = viewOf(w, pair);
  if (!base) return null;
  const options: ('count' | 'product' | 'staple')[] = [];
  if (base.order.kind === 'units' || base.order.kind === 'kg') options.push('count');
  const c = conceptOf(w, pair.link.concept)!;
  const plants = livePlants(w, pair.link.concept, new Set(c.members.map((m) => m.id)));
  if (plants.length && base.order.kind !== 'staple') options.push('product');
  if ((NOT_STAPLE.has(pair.link.concept) && !pair.pantry) || (IS_STAPLE.has(pair.link.concept) && pair.pantry)) options.push('staple');
  if (!options.length) return null;
  const corruption = options[Math.floor(r() * options.length)];
  if (corruption === 'count') {
    const o = base.order;
    return { corruption, view: { ...base, order: o.kind === 'units' ? { kind: 'units', n: o.n * 10 } : { kind: 'kg', kg: (o as { kg: number }).kg * 10 } } };
  }
  if (corruption === 'product') {
    const swap = w.catalog.get(plants[Math.floor(r() * plants.length)])!;
    return { corruption, view: { ...base, product: swap } };
  }
  return pair.pantry
    ? { corruption, view: { ...base, pantry: false, order: { kind: 'units', n: 1 } } }
    : { corruption, view: { ...base, pantry: true, order: { kind: 'staple' } } };
}

export function criticBatches(w: World, real: readonly Pair[], pool: readonly Pair[], seed: number, size = 100): Batch[] {
  const r = rng(seed);
  const order = shuffle(real, r);
  const candidatesForPlants = shuffle(pool, r);
  let cursor = 0;
  const out: Batch[] = [];
  for (let b = 0; b * size < order.length; b++) {
    const nextId = idMaker(r);
    const items: { id: string; text: string; key: CriticKey }[] = [];
    for (const pair of order.slice(b * size, (b + 1) * size)) {
      const view = viewOf(w, pair);
      if (!view) continue;
      const id = nextId();
      items.push({ id, text: criticText(w, id, pair, view), key: { kind: 'critic', role: 'real', pair: pair.key } });
    }
    const need = minPlants(items.length);
    let plants = 0;
    const inBatch = new Set(order.slice(b * size, (b + 1) * size).map((p) => p.key));
    // The pool may be small (a day's few changes): it is cycled, so a batch still carries its minimum.
    // A pair already in this batch is skipped while others remain: the same line shown twice, once
    // right and once wrong, would let a judge find the plant by comparison instead of by reading.
    for (let tries = 0; plants < need && tries < candidatesForPlants.length * 4; tries++) {
      const pair = candidatesForPlants[cursor++ % candidatesForPlants.length];
      if (inBatch.has(pair.key) && tries < candidatesForPlants.length) continue;
      const bad = corrupt(w, pair, r);
      if (!bad) continue;
      const id = nextId();
      items.push({ id, text: criticText(w, id, pair, bad.view), key: { kind: 'critic', role: 'plant', corruption: bad.corruption, pair: pair.key } });
      plants += 1;
    }
    const shuffled = shuffle(items, r);
    out.push({
      id: `critic-${String(b + 1).padStart(2, '0')}`,
      kind: 'critic',
      text: shuffled.map((it) => it.text).join('\n\n') + '\n',
      key: Object.fromEntries(shuffled.map((it) => [it.id, it.key])),
      plants,
      unprovable: plants < need,
    });
  }
  return out;
}

// ── answers ─────────────────────────────────────────────────────────────────

export type Score = {
  batch: string;
  kind: 'picker' | 'critic';
  /** Every item answered exactly once, in the format. */
  complete: boolean;
  problems: string[];
  plants: number;
  /** Planted errors the judge let through. ONE voids the batch. */
  plantMisses: string[];
  /** linkKey → the product ids the picker named, and the ones it was SHOWN (real items only). */
  picks: Map<string, { ids: Set<string>; shown: Set<string>; why: string }>;
  /** pairKey → the critic's call (real items only). */
  calls: Map<string, { yes: boolean; why: string }>;
};

export const passed = (s: Score) => s.complete && s.plantMisses.length === 0;

export function score(batch: Batch, answer: string): Score {
  const s: Score = { batch: batch.id, kind: batch.kind, complete: true, problems: [], plants: batch.plants, plantMisses: [], picks: new Map(), calls: new Map() };
  const seen = new Set<string>();
  for (const raw of answer.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(i[0-9a-z]{5})\s*\|\s*([^|]*?)\s*\|\s*(.*)$/.exec(line);
    if (!m) {
      s.complete = false;
      s.problems.push(`unreadable: ${line.slice(0, 80)}`);
      continue;
    }
    const [, id, value, why] = m;
    const k = batch.key[id];
    if (!k) {
      s.complete = false;
      s.problems.push(`unknown item ${id}`);
      continue;
    }
    if (seen.has(id)) {
      s.complete = false;
      s.problems.push(`answered twice: ${id}`);
      continue;
    }
    seen.add(id);
    if (k.kind === 'picker') {
      const v = value.trim().toLowerCase();
      let nums: string[];
      if (v === 'none') nums = [];
      else if (/^\d+(\s*,\s*\d+)*$/.test(v)) nums = v.split(',').map((x) => String(Number(x.trim())));
      else {
        s.complete = false;
        s.problems.push(`${id}: cannot read "${value}"`);
        continue;
      }
      const bad = nums.filter((n) => !k.numbers[n]);
      if (bad.length) {
        s.complete = false;
        s.problems.push(`${id}: no candidate ${bad.join(', ')}`);
        continue;
      }
      const ids = new Set(nums.map((n) => k.numbers[n]));
      for (const p of k.plants) if (ids.has(p)) s.plantMisses.push(`${id} named planted product ${p}`);
      if (k.role === 'real') s.picks.set(k.link, { ids, shown: new Set(Object.values(k.numbers)), why: why.trim() });
    } else {
      const v = value.trim().toLowerCase();
      if (v !== 'yes' && v !== 'no') {
        s.complete = false;
        s.problems.push(`${id}: "${value}" is not yes or no`);
        continue;
      }
      if (k.role === 'plant') {
        if (v === 'yes') s.plantMisses.push(`${id} passed a planted ${k.corruption} error`);
      } else s.calls.set(k.pair, { yes: v === 'yes', why: why.trim() });
    }
  }
  const missing = Object.keys(batch.key).filter((id) => !seen.has(id));
  if (missing.length) {
    s.complete = false;
    s.problems.push(`${missing.length} items unanswered`);
  }
  return s;
}

/**
 * The verdicts after a round. Only PASSED batches count. A pair whose content changed starts over;
 * a judging that ends "no" adds one strike, once per round.
 */
export function applyScores(
  verdicts: Readonly<Record<string, Verdict>>,
  pairs: ReadonlyMap<string, Pair>,
  scores: readonly Score[],
  now: string,
): Record<string, Verdict> {
  const next: Record<string, Verdict> = { ...verdicts };
  const touched = new Set<string>();
  const byLink = new Map<string, Pair[]>();
  for (const p of pairs.values()) byLink.set(p.link.key, [...(byLink.get(p.link.key) ?? []), p]);
  const start = (p: Pair): Verdict => {
    const prev = next[p.key];
    return prev && prev.h === p.h ? { ...prev } : { h: p.h, at: now, strikes: prev?.strikes ?? 0 };
  };
  for (const s of scores) {
    if (!passed(s)) continue;
    for (const [lk, pick] of s.picks) {
      for (const p of byLink.get(lk) ?? []) {
        // 🔴 Only a product the judge SAW is judged: a member the catalogue did not return that day
        // was not among the candidates, and silence about it is not a "no" (first run, 2026-10-08:
        // a tahini out of the catalogue drew a strike it never earned).
        if (!pick.shown.has(p.member.id)) continue;
        const v = start(p);
        v.picker = pick.ids.has(p.member.id);
        if (!v.picker) v.why = `picker: not named${pick.why ? ` (${pick.why})` : ''}`;
        v.at = now;
        next[p.key] = v;
        touched.add(p.key);
      }
    }
    for (const [pk, call] of s.calls) {
      const p = pairs.get(pk);
      if (!p) continue;
      const v = start(p);
      v.critic = call.yes;
      if (!call.yes) v.why = `critic: ${call.why}`;
      v.at = now;
      next[p.key] = v;
      touched.add(p.key);
    }
  }
  for (const k of touched) {
    const v = next[k];
    if (v.picker === false || v.critic === false) next[k] = { ...v, strikes: v.strikes + 1 };
    else if (v.picker && v.critic) delete next[k].why;
  }
  return next;
}

// ── the served file ─────────────────────────────────────────────────────────

export type Reason =
  | 'recipe-postid'
  | 'no-decision'
  | 'member-gone'
  | 'picker-no'
  | 'critic-no'
  | 'blocked'
  | 'not-judged'
  | 'rule'
  | 'no-member';

export type Exclusion = { reason: Reason; slug?: string; text?: string; concept?: string; member?: string; detail?: string };

/** The reasons a SERVED link may disappear for. Anything else refuses the publish (`guards`). */
export const ALLOWED_REMOVAL: ReadonlySet<Reason> = new Set<Reason>(['recipe-postid', 'member-gone', 'picker-no', 'critic-no', 'blocked', 'rule', 'no-member']);

type Built = { served: ApprovedFile; exclusions: Exclusion[]; findings: Finding[]; refused?: string };

const UNDECIDED = new Set(['line-undecided', 'recipe-undecided']);

/**
 * What the app may show: the judged, rule-clean part of the dictionary. Lines of the live recipes
 * only; a line the rules fault becomes plain text and the rest is built again, until clean.
 */
export function buildServed(source: Source, catalog: ReadonlyMap<string, CatalogProduct>, live: readonly LiveRecipe[]): Built {
  const file = source.file;
  const { pairs } = pairsOf(file, live);
  const outMembers = new Map<string, Exclusion>(); // `${concept}#${member}`
  const outLines = new Map<string, Exclusion>(); // `${slug}\n${text}`
  const outConcepts = new Map<string, Exclusion>();
  const outRecipes = new Map<string, Exclusion>();
  const mk = (c: string, m: string) => `${c}#${m}`;
  const lk = (s: string, t: string) => `${s}\n${t}`;

  // Member status, once: the picker's word on a product holds for its concept everywhere.
  const byMember = new Map<string, Pair[]>();
  for (const p of pairs.values()) {
    const k = mk(p.link.concept, p.member.id);
    byMember.set(k, [...(byMember.get(k) ?? []), p]);
  }
  for (const [cid, c] of Object.entries(file.concepts)) {
    for (const m of c.members) {
      const k = mk(cid, m.id);
      const live = catalog.get(m.id);
      if (!live) {
        outMembers.set(k, { reason: 'member-gone', concept: cid, member: m.id });
        continue;
      }
      if (live.name !== m.name || !sameSale(m.sale, live)) {
        outMembers.set(k, { reason: 'not-judged', concept: cid, member: m.id, detail: 'changed in the catalogue since it was judged' });
        continue;
      }
      const ps = byMember.get(k) ?? [];
      const refused = ps.find((p) => {
        const v = source.verdicts[p.key];
        return v && v.h === p.h && v.picker === false;
      });
      if (refused) outMembers.set(k, { reason: 'picker-no', concept: cid, member: m.id, detail: source.verdicts[refused.key].why });
    }
  }
  // 🔴 A critic "no" for ONE product of a line, beside a "yes" for another product of the same line,
  // is a doubt about that PRODUCT (first run: "גולדן יוגורט בסגנון יווני" for Greek yogurt), not
  // about the line's amount: the product leaves its concept and the line keeps the rest. When the
  // critic refused EVERY product of a line, the amount is what is wrong, and the line goes
  // (below). Either way a refused pair is never served.
  const byLineOfConcept = new Map<string, Pair[]>();
  for (const p of pairs.values()) {
    const v = source.verdicts[p.key];
    if (!v || v.h !== p.h || v.critic === undefined) continue;
    const k = `${p.link.key}`;
    byLineOfConcept.set(k, [...(byLineOfConcept.get(k) ?? []), p]);
  }
  for (const ps of byLineOfConcept.values()) {
    const yes = ps.some((p) => source.verdicts[p.key].critic === true);
    if (!yes) continue;
    for (const p of ps) {
      const v = source.verdicts[p.key];
      const k = mk(p.link.concept, p.member.id);
      if (v.critic === false && !outMembers.has(k)) outMembers.set(k, { reason: 'critic-no', concept: p.link.concept, member: p.member.id, detail: `for "${p.link.text}": ${v.why ?? ''}` });
    }
  }

  const findings: Finding[] = [];
  for (let pass = 0; pass < 8; pass++) {
    const served: ApprovedFile = { schema: 1, concepts: {}, recipes: {} };
    const exclusions: Exclusion[] = [...outMembers.values(), ...outConcepts.values(), ...outRecipes.values()];
    const usedMembers = new Map<string, Set<string>>();
    for (const lr of live) {
      const entry = Object.prototype.hasOwnProperty.call(file.recipes, lr.slug) ? file.recipes[lr.slug] : undefined;
      if (outRecipes.has(lr.slug)) continue;
      if (entry?.postId && lr.postId && entry.postId !== lr.postId) {
        exclusions.push({ reason: 'recipe-postid', slug: lr.slug });
        continue;
      }
      const lines: Record<string, LineRecord> = {};
      for (const text of new Set(lr.lines)) {
        const line = { slug: lr.slug, text };
        const d = entry && Object.prototype.hasOwnProperty.call(entry.lines, text) ? entry.lines[text] : undefined;
        if (!d) {
          exclusions.push({ reason: 'no-decision', ...line });
          continue;
        }
        const ruled = outLines.get(lk(lr.slug, text));
        if (ruled) {
          exclusions.push(ruled);
          continue;
        }
        if ('notSold' in d) {
          lines[text] = { notSold: d.notSold };
          continue;
        }
        const ok: { link: LineLink; members: MemberRecord[] }[] = [];
        let failure: Exclusion | null = null;
        for (const k of d.links) {
          const c = Object.prototype.hasOwnProperty.call(file.concepts, k.concept) ? file.concepts[k.concept] : undefined;
          const conceptOut = outConcepts.get(k.concept);
          if (!c || conceptOut) {
            failure ??= conceptOut ? { ...conceptOut, ...line } : { reason: 'no-decision', ...line, concept: k.concept, detail: 'unknown concept' };
            continue;
          }
          const key = linkKey(text, k.concept, k.need, d.mode, !!k.substitute);
          const members = c.members.filter((m) => !outMembers.has(mk(k.concept, m.id)));
          if (!members.length) {
            const first = c.members.map((m) => outMembers.get(mk(k.concept, m.id))).find(Boolean);
            failure ??= { reason: 'no-member', ...line, concept: k.concept, detail: first ? `${first.member}: ${first.reason}` : 'no members' };
            continue;
          }
          let linkFailure: Exclusion | null = null;
          for (const m of members) {
            const p = pairs.get(pairKey(key, m.id));
            const v = p && source.verdicts[p.key];
            if (!p || !v || v.h !== p.h || v.critic === undefined || v.picker === undefined) {
              if (v && v.strikes >= MAX_STRIKES) linkFailure ??= { reason: 'blocked', ...line, concept: k.concept, member: m.id, detail: v.why };
              else linkFailure ??= { reason: 'not-judged', ...line, concept: k.concept, member: m.id };
            } else if (v.strikes >= MAX_STRIKES && !(v.picker && v.critic)) {
              linkFailure ??= { reason: 'blocked', ...line, concept: k.concept, member: m.id, detail: v.why };
            } else if (!v.critic) {
              linkFailure ??= { reason: 'critic-no', ...line, concept: k.concept, member: m.id, detail: v.why };
            }
          }
          if (linkFailure) failure ??= linkFailure;
          else ok.push({ link: k, members });
        }
        const keep = d.mode === 'all' ? (failure ? [] : ok) : ok;
        if (!keep.length) {
          exclusions.push(failure ?? { reason: 'no-member', ...line });
          continue;
        }
        if (d.mode === 'any' && failure) exclusions.push({ ...failure, detail: `one option of an "any" line: ${failure.detail ?? failure.reason}` });
        lines[text] = { mode: d.mode, links: keep.map((x) => ({ concept: x.link.concept, need: x.link.need, ...(x.link.substitute ? { substitute: true as const } : {}) })) };
        for (const x of keep) {
          const set = usedMembers.get(x.link.concept) ?? new Set<string>();
          for (const m of x.members) set.add(m.id);
          usedMembers.set(x.link.concept, set);
        }
      }
      if (Object.keys(lines).length) served.recipes[lr.slug] = { ...(lr.postId ? { postId: lr.postId } : {}), title: lr.title, lines };
    }
    for (const [cid, ids] of usedMembers) {
      const c = file.concepts[cid];
      const members = c.members.filter((m) => ids.has(m.id));
      const keepDefault = c.defaultVariant && members.some((m) => m.variant === c.defaultVariant);
      served.concepts[cid] = {
        label: c.label,
        kind: c.kind,
        ...(c.pantry ? { pantry: true } : {}),
        ...(keepDefault ? { defaultVariant: c.defaultVariant } : {}),
        allowedCategories: [...c.allowedCategories],
        members: members.map((m) => ({ ...m })),
        ...(c.aliases ? { aliases: [...c.aliases] } : {}),
      };
    }

    // 🔴 An undecided line is plain text BY DESIGN here: the served file leaves out every line that
    // is not judged, so the rules' "no decision" errors describe the gate working, not a fault.
    const found = checkRules(served, catalog, live, { priceIsError: true }).filter((f) => !UNDECIDED.has(f.code));
    const errors = found.filter((f) => f.level === 'error');
    if (!errors.length) {
      findings.push(...found);
      return { served, exclusions, findings };
    }
    for (const f of errors) {
      const detail = `${f.code}: ${f.message}`;
      if (f.recipe && f.line) outLines.set(lk(f.recipe, f.line), { reason: 'rule', slug: f.recipe, text: f.line, detail });
      else if (f.recipe && (f.concept || f.product)) {
        // A unit mix inside one recipe belongs to the recipe's lines that reach it, not to the
        // product everywhere: only those lines become plain text.
        for (const [text, l] of Object.entries(served.recipes[f.recipe]?.lines ?? {})) {
          if ('notSold' in l) continue;
          const hit = l.links.some((k) => k.concept === f.concept || (!!f.product && served.concepts[k.concept]?.members.some((m) => m.id === f.product)));
          if (hit) outLines.set(lk(f.recipe, text), { reason: 'rule', slug: f.recipe, text, detail });
        }
      } else if (f.recipe) outRecipes.set(f.recipe, { reason: 'rule', slug: f.recipe, detail });
      else if (f.concept && f.product) outMembers.set(mk(f.concept, f.product), { reason: 'rule', concept: f.concept, member: f.product, detail });
      else if (f.concept) outConcepts.set(f.concept, { reason: 'rule', concept: f.concept, detail });
      else return { served, exclusions, findings: found, refused: `a rule error that names no line, member or recipe: ${f.where}: ${detail}` };
    }
  }
  return { served: { schema: 1, concepts: {}, recipes: {} }, exclusions: [], findings, refused: 'the rules did not settle in 8 passes' };
}

// ── guards ──────────────────────────────────────────────────────────────────

type Triple = { slug: string; text: string; concept: string; member: string };

function triples(f: RecipeLinksFile | ApprovedFile): Triple[] {
  const out: Triple[] = [];
  for (const [slug, r] of Object.entries(f.recipes)) {
    for (const [text, l] of Object.entries(r.lines)) {
      if ('notSold' in l) continue;
      for (const k of l.links) for (const m of f.concepts[k.concept]?.members ?? []) out.push({ slug, text, concept: k.concept, member: m.id });
    }
  }
  return out;
}

/**
 * Reasons to REFUSE a publish; empty means publish. Every one fails closed: the app keeps the last
 * good file, which is always safe, while a wrong publish reaches every phone within minutes.
 */
export function guards(input: {
  served: ApprovedFile;
  exclusions: readonly Exclusion[];
  source: Source;
  previous?: RecipeLinksFile;
  live: readonly LiveRecipe[];
  catalogSize: number;
  scores: readonly Score[];
  batches: readonly Batch[];
  refused?: string;
}): string[] {
  const out: string[] = [];
  if (input.refused) out.push(input.refused);
  const bytes = JSON.parse(JSON.stringify(stripForServing(input.served)));
  const parsed = parseRecipeLinksFile(bytes);
  if ('error' in parsed) out.push(`the served file does not parse: ${parsed.error}`);

  for (const b of input.batches) {
    if (b.unprovable) out.push(`${b.id}: only ${b.plants} planted errors, fewer than ${minPlants(Object.keys(b.key).length - b.plants)}`);
    const s = input.scores.find((x) => x.batch === b.id);
    if (!s) out.push(`${b.id}: no passing answer`);
    else if (!passed(s)) out.push(`${b.id}: ${s.plantMisses.length ? `planted errors passed: ${s.plantMisses.join('; ')}` : s.problems.join('; ')}`);
  }

  const { meta } = input.source;
  if (meta.catalogSize > 0 && input.catalogSize < 0.9 * meta.catalogSize) {
    out.push(`the catalogue returned ${input.catalogSize} products, under 90% of the last run's ${meta.catalogSize}: a half-read looks like a mass delisting`);
  }
  if (meta.recipeCount > 0 && input.live.length < 0.9 * meta.recipeCount) {
    out.push(`the recipe index returned ${input.live.length} recipes, under 90% of the last run's ${meta.recipeCount}`);
  }

  if (input.previous) {
    const now = new Set(triples(input.served).map((t) => JSON.stringify(t)));
    const liveLines = new Map(input.live.map((r) => [r.slug, new Set(r.lines)]));
    const byLine = new Map<string, Exclusion>();
    const byMember = new Map<string, Exclusion>();
    for (const e of input.exclusions) {
      if (e.slug !== undefined && e.text !== undefined) byLine.set(`${e.slug}\n${e.text}`, byLine.get(`${e.slug}\n${e.text}`) ?? e);
      if (e.concept && e.member && e.slug === undefined) byMember.set(`${e.concept}#${e.member}`, e);
    }
    const unexplained: string[] = [];
    for (const t of triples(input.previous)) {
      if (now.has(JSON.stringify(t))) continue;
      if (!liveLines.get(t.slug)?.has(t.text)) continue; // the recipe or the line is gone from WordPress
      const member = byMember.get(`${t.concept}#${t.member}`);
      if (member && ALLOWED_REMOVAL.has(member.reason)) continue;
      const rejected = input.source.file.concepts[t.concept]?.rejected?.some((r) => r.id === t.member);
      if (rejected) continue;
      const line = byLine.get(`${t.slug}\n${t.text}`);
      if (line && ALLOWED_REMOVAL.has(line.reason)) continue;
      const servedLine = input.served.recipes[t.slug]?.lines[t.text];
      if (servedLine && !('notSold' in servedLine)) continue; // the line was decided anew and judged
      unexplained.push(`${t.slug} "${t.text}" ${t.concept}/${t.member}: ${line?.reason ?? member?.reason ?? 'no recorded reason'}`);
    }
    if (unexplained.length) out.push(`${unexplained.length} served links would disappear without a reason, e.g. ${unexplained.slice(0, 3).join(' | ')}`);
  }
  return out;
}

/**
 * Which attempt of a batch counts. 🔴 A passing FIRST attempt is final: asking again after a pass
 * would let a run shop for the verdict it wants. A failed one gets exactly one more fresh judge.
 */
export function chooseAttempt(attempts: readonly Score[]): Score | null {
  const [first, second] = attempts;
  if (!first) return null;
  if (passed(first) || !second) return first;
  return second;
}

/** The only files a run may publish, and the paths a publish refuses. */
export const PUBLISHED = ['recipe-links.v1.json', 'source.json', 'report.md'] as const;
export const strayPaths = (changed: readonly string[]) => changed.filter((f) => !(PUBLISHED as readonly string[]).includes(f));

// ── the report ──────────────────────────────────────────────────────────────

const REASON_TEXT: Record<Reason, string> = {
  'recipe-postid': 'the slug now belongs to another post',
  'no-decision': 'no decision yet (a new or edited line)',
  'member-gone': 'the product is not in the catalogue',
  'picker-no': 'the picker did not name the product',
  'critic-no': 'the critic refused the order',
  blocked: 'judged wrong twice: blocked for good',
  'not-judged': 'not judged as it is now',
  rule: 'a rule error',
  'no-member': 'no product of the ingredient passed',
};

export function report(input: {
  at: string;
  live: readonly LiveRecipe[];
  served: ApprovedFile;
  exclusions: readonly Exclusion[];
  batches: readonly Batch[];
  scores: readonly Score[];
  refusals: readonly string[];
  source: Source;
  suggestions: readonly string[];
}): string {
  const lines = input.live.reduce((n, r) => n + new Set(r.lines).size, 0);
  let linked = 0;
  let notSold = 0;
  for (const r of Object.values(input.served.recipes)) for (const l of Object.values(r.lines)) ('notSold' in l ? notSold++ : linked++);
  const out: string[] = [
    `# Recipe links: run of ${input.at}`,
    '',
    input.refusals.length ? `**NOT PUBLISHED.** ${input.refusals.length} guard(s) refused:` : '**Published.**',
    ...input.refusals.map((r) => `- ${r}`),
    '',
    `- live recipes: ${input.live.length}; distinct live lines: ${lines}`,
    `- lines served with products: ${linked}; lines marked not sold or not a shop item: ${notSold}`,
    `- verdicts on record: ${Object.keys(input.source.verdicts).length}; planted products: ${input.source.plants.length}`,
    '',
    '## The judges, proven on planted errors',
    '',
  ];
  for (const b of input.batches) {
    const s = input.scores.filter((x) => x.batch === b.id);
    const last = s[s.length - 1];
    const status = !last ? 'no answer' : passed(last) ? 'passed' : last.plantMisses.length ? `FAILED: ${last.plantMisses.length} planted error(s) passed` : `FAILED: ${last.problems[0]}`;
    out.push(`- ${b.id}: ${Object.keys(b.key).length} items, ${b.plants} planted; ${s.length} attempt(s); ${status}`);
  }
  const groups = new Map<Reason, Exclusion[]>();
  for (const e of input.exclusions) groups.set(e.reason, [...(groups.get(e.reason) ?? []), e]);
  out.push('', '## Plain text, and why', '');
  for (const [reason, list] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    out.push(`### ${REASON_TEXT[reason]} (${list.length})`, '');
    for (const e of list.slice(0, 40)) {
      const title = input.live.find((r) => r.slug === e.slug)?.title;
      const what = [title && `${title}:`, e.text && `"${e.text}"`, e.concept, e.member && `product ${e.member}`, e.detail && `(${e.detail})`].filter(Boolean).join(' ');
      out.push(`- ${what}`);
    }
    if (list.length > 40) out.push(`- … ${list.length - 40} more`);
    out.push('');
  }
  const gaps = new Map<string, string[]>();
  for (const lr of input.live) {
    const entry = input.source.file.recipes[lr.slug];
    for (const text of new Set(lr.lines)) {
      const d = entry?.lines[text];
      if (!d) continue;
      if ('notSold' in d && d.notSold === 'assortment-gap') gaps.set(text, [...(gaps.get(text) ?? []), lr.title]);
      if (!('notSold' in d)) for (const g of d.gaps ?? []) gaps.set(`${g} (in "${text}")`, [...(gaps.get(`${g} (in "${text}")`) ?? []), lr.title]);
    }
  }
  out.push('## Not sold by the shop', '');
  for (const [what, titles] of [...gaps].sort()) out.push(`- ${what}: ${titles.join(', ')}`);
  if (input.suggestions.length) {
    out.push('', '## Products a picker named that are not members (for the next proposal)', '');
    out.push(...input.suggestions.map((s) => `- ${s}`));
  }
  return out.join('\n') + '\n';
}
