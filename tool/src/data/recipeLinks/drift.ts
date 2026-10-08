/**
 * WHAT CHANGED UNDER THE DICTIONARY, as questions for the daily run's proposer (Rom, 2026-10-07:
 * *"צריך שהמערכת הזו תהיה בתחזוקה תמידית"*).
 *
 * 🔴 NOTHING HERE IS PUBLISHED BY ITSELF. A new mango variety that fits the fresh-mango concept
 * becomes a QUESTION to the proposer, never a link; even once proposed, it is served only after
 * both judges pass it (`judge.ts`). Precision first: a day's delay is a cost, a wrong product is a
 * lie.
 *
 * The other half of the live check, renamed members, a changed sale model, a line edited in
 * WordPress, lives in `checkRules` (`rules.ts`), which reports them as findings.
 */
import { HOUSEHOLD_ROOTS, leadsWith, type CatalogProduct, type LiveRecipe } from './rules';
import type { ApprovedFile, LineDecision } from './schema';

export type ReviewItem =
  /** A live, in-stock product that fits an existing concept and nobody has judged yet. */
  | { kind: 'candidate-member'; concept: string; productId: string; name: string }
  /** A line with no decision whose exact text IS decided in another recipe: proposed the same. */
  | { kind: 'line-proposal'; slug: string; title: string; text: string; decision: LineDecision; from: string }
  /** A line with no decision anywhere: it needs a proposal from a session. */
  | { kind: 'line-needs-proposal'; slug: string; title: string; text: string };

/**
 * Products that fit a concept by its own categories and its own word, are in stock, sit in no
 * household root, and are neither a member nor a rejected candidate.
 */
export function candidateMembers(file: ApprovedFile, catalog: ReadonlyMap<string, CatalogProduct>): ReviewItem[] {
  const out: ReviewItem[] = [];
  for (const [cid, c] of Object.entries(file.concepts)) {
    const known = new Set([...c.members.map((m) => m.id), ...(c.rejected ?? []).map((r) => r.id)]);
    for (const p of catalog.values()) {
      if (known.has(p.id) || !p.inStock) continue;
      if (p.categories.some((x) => HOUSEHOLD_ROOTS.includes(x))) continue;
      if (!p.categories.some((x) => c.allowedCategories.includes(x))) continue;
      if (!leadsWith(p.name, c)) continue;
      out.push({ kind: 'candidate-member', concept: cid, productId: p.id, name: p.name });
    }
  }
  return out;
}

/**
 * Every live line without a decision. 🔴 A text decided in ANOTHER recipe is only PROPOSED here,
 * never applied: "פלפל" in a salad and "פלפל" beside the salt are the same string and different
 * products, so the proposer decides it afresh.
 */
export function undecidedLines(file: ApprovedFile, live: readonly LiveRecipe[]): ReviewItem[] {
  const decided = new Map<string, { decision: LineDecision; from: string }>();
  for (const [slug, r] of Object.entries(file.recipes)) {
    for (const [text, l] of Object.entries(r.lines)) {
      if (!decided.has(text)) {
        const decision: LineDecision = 'notSold' in l ? { notSold: l.notSold } : { mode: l.mode, links: l.links };
        decided.set(text, { decision, from: r.title ?? slug });
      }
    }
  }
  const out: ReviewItem[] = [];
  for (const lr of live) {
    const approved = file.recipes[lr.slug];
    for (const text of lr.lines) {
      if (approved?.lines[text]) continue;
      const prior = decided.get(text);
      out.push(
        prior
          ? { kind: 'line-proposal', slug: lr.slug, title: lr.title, text, decision: prior.decision, from: prior.from }
          : { kind: 'line-needs-proposal', slug: lr.slug, title: lr.title, text },
      );
    }
  }
  return out;
}
