/**
 * THE WATCHER'S RULE: is there anything for the AI to decide, and should it be woken now?
 *
 * Rom, 2026-10-08: *"רק אם יש צורך אז שהai יחשוב ולא סתם סריקה כל יום"*. Detecting work is
 * arithmetic, so a free hourly job (`scripts/recipe-links/watch.ts`, GitHub Actions in the public
 * recipes repo) runs this, and the routine, the only part that costs tokens, runs only when it says
 * so. A quiet day costs nothing.
 *
 * WORK is exactly what `run.ts packets` would hand to a proposer or a judge:
 *   - a live recipe line with no decision (a new recipe, an edited line), unless skipped;
 *   - a live, in-stock product that fits a concept and is neither a member nor refused;
 *   - a pair never judged as it is now (a renamed member, a member back in the catalogue).
 *
 * 🔴 EVERY STATE MUST BE ABLE TO REACH "NO WORK", or the watcher wakes the AI forever. So a line the
 * proposer cannot decide is SKIPPED with a reason (`source.skipped`), and asked again only when its
 * text changes; and the same unfinished work is retried once, a day later, and then never again
 * until something actually changes.
 */
import { conceptOf, specOf } from './dictionary';
import { candidateMembers } from './drift';
import { pairsOf, toJudge, type Source } from './judge';
import type { CatalogProduct, LiveRecipe } from './rules';
import type { ApprovedFile } from './schema';

export type WorkItem = string;

/** Every unit of work, as stable strings. Sorted, so the same work always has the same fingerprint. */
export function workOf(source: Source, catalog: ReadonlyMap<string, CatalogProduct>, live: readonly LiveRecipe[]): WorkItem[] {
  const out: WorkItem[] = [];
  const skipped = source.skipped ?? {};
  for (const lr of live) {
    const entry = Object.prototype.hasOwnProperty.call(source.file.recipes, lr.slug) ? source.file.recipes[lr.slug] : undefined;
    const moved = !!(entry?.postId && lr.postId && entry.postId !== lr.postId);
    for (const text of new Set(lr.lines)) {
      const decided = !moved && entry && Object.prototype.hasOwnProperty.call(entry.lines, text);
      if (decided) continue;
      if (!moved && skipped[lr.slug] && Object.prototype.hasOwnProperty.call(skipped[lr.slug], text)) continue;
      out.push(`line ${lr.slug} ${JSON.stringify(text)}`);
    }
  }
  for (const c of candidateMembers(source.file, catalog)) if (c.kind === 'candidate-member') out.push(`candidate ${c.concept} ${c.productId}`);
  // Members as the run would rebuild them: names and sale models from the live catalogue, so a
  // rename reads as a pair never judged as it is now.
  const errors: string[] = [];
  const refreshed: ApprovedFile = {
    schema: 1,
    concepts: Object.fromEntries(Object.entries(source.file.concepts).map(([cid, c]) => [cid, conceptOf(cid, specOf(c), catalog, c, errors)])),
    recipes: source.file.recipes,
  };
  const { pairs } = pairsOf(refreshed, live);
  for (const p of toJudge(pairs, source.verdicts, 0, (id) => catalog.has(id)).fresh) out.push(`pair ${p.key}`);
  return out.sort();
}

export type WatchState = {
  /** The work seen at the previous check: work must hold still for one check before it wakes the AI. */
  seen?: string;
  seenAt?: string;
  /** The work the AI was last woken for, when, and how many times for that same work. */
  fired?: string;
  firedAt?: string;
  tries?: number;
};

export const RETRY_AFTER_MS = 24 * 3600 * 1000;

/**
 * Wake the AI or not. `fingerprint` is the hash of the work list (empty work: no wake).
 *   - new work waits one check, so a recipe still being edited is not judged half-written;
 *   - work woken for already is retried ONCE after a day (a failed run), then left until it changes.
 */
export function decide(state: WatchState, fingerprint: string, count: number, now: Date): { fire: boolean; next: WatchState; why: string } {
  const at = now.toISOString();
  // An unchanged state is returned AS IS, so a quiet hour writes nothing and commits nothing.
  if (count === 0) return { fire: false, next: state.seen === fingerprint ? state : { ...state, seen: fingerprint, seenAt: at }, why: 'nothing to do' };
  if (fingerprint !== state.seen) return { fire: false, next: { ...state, seen: fingerprint, seenAt: at }, why: 'new work; waiting one check for edits to settle' };
  if (fingerprint !== state.fired) return { fire: true, next: { ...state, fired: fingerprint, firedAt: at, tries: 1 }, why: 'work held still: waking the run' };
  const since = state.firedAt ? now.getTime() - Date.parse(state.firedAt) : Infinity;
  if ((state.tries ?? 1) < 2 && since >= RETRY_AFTER_MS) {
    return { fire: true, next: { ...state, firedAt: at, tries: (state.tries ?? 1) + 1 }, why: 'the same work a day later: one retry' };
  }
  return { fire: false, next: state, why: (state.tries ?? 1) >= 2 ? 'already tried twice for this work: waiting for it to change' : 'woken for this work less than a day ago' };
}
