/**
 * THE WATCHER: free, hourly, no AI. It asks `watchRule.ts` whether there is anything for the AI to
 * decide, and wakes the routine only when there is (Rom, 2026-10-08: only when needed).
 *
 *   npx -y tsx --tsconfig scripts/recipe-links/tsconfig.json scripts/recipe-links/watch.ts \
 *     --data .. --state ../watch.json [--fire]
 *
 * Runs in the recipes repo's GitHub Actions (`.github/workflows/watch.yml`), from `tool/`. Reads
 * `<data>/source.json` and the live shop, reads and rewrites the state file, and with `--fire` and a
 * decision to wake POSTs to the routine's fire endpoint (env RECIPE_ROUTINE_ID, RECIPE_ROUTINE_TOKEN).
 * Prints one line: the decision and why.
 *
 * 🔴 It never wakes the AI on a half-read shop (the same 90% guard `judge.ts` publishes behind), and it
 * records a wake only after the fire endpoint accepted it, so a failed call is retried next hour.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { Source } from '@/data/recipeLinks/judge';
import { decide, workOf, type WatchState } from '@/data/recipeLinks/watchRule';
import { fetchCatalog, fetchRecipes } from './live';

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const DATA = resolve(arg('data') ?? '..');
const STATE = resolve(arg('state') ?? join(DATA, 'watch.json'));
const FIRE = args.includes('--fire');

function say(line: string) {
  console.log(line);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) writeFileSync(summary, `${line}\n`, { flag: 'a' });
}

async function fire(text: string): Promise<string> {
  const id = process.env.RECIPE_ROUTINE_ID;
  const token = process.env.RECIPE_ROUTINE_TOKEN;
  if (!id || !token) throw new Error('RECIPE_ROUTINE_ID or RECIPE_ROUTINE_TOKEN is not set');
  const res = await fetch(`https://api.anthropic.com/v1/claude_code/routines/${id}/fire`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'anthropic-beta': 'experimental-cc-routine-2026-04-01',
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`the fire endpoint answered HTTP ${res.status}: ${body.slice(0, 300)}`);
  try {
    return (JSON.parse(body) as { claude_code_session_url?: string }).claude_code_session_url ?? 'woken';
  } catch {
    return 'woken';
  }
}

async function main() {
  const source = JSON.parse(readFileSync(join(DATA, 'source.json'), 'utf8')) as Source;
  const [{ byId }, recipes] = await Promise.all([fetchCatalog(), fetchRecipes()]);
  const { catalogSize, recipeCount } = source.meta;
  if ((catalogSize > 0 && byId.size < 0.9 * catalogSize) || (recipeCount > 0 && recipes.length < 0.9 * recipeCount)) {
    say(`not waking: the shop came back short (${byId.size} products, ${recipes.length} recipes; the last run saw ${catalogSize} and ${recipeCount})`);
    return;
  }
  const live = recipes.map((r) => ({ slug: r.slug, postId: r.postId, title: r.title, lines: r.lines }));
  const work = workOf(source, byId, live);
  const fingerprint = work.length ? createHash('sha256').update(work.join('\n')).digest('hex').slice(0, 24) : '';
  const state: WatchState = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
  const d = decide(state, fingerprint, work.length, new Date());

  const kinds = ['line', 'candidate', 'pair'].map((k) => `${work.filter((w) => w.startsWith(`${k} `)).length} ${k}s`).join(', ');
  if (d.fire && FIRE) {
    const url = await fire(`The recipe-links watcher found ${work.length} items of work (${kinds}). Examples: ${work.slice(0, 5).join(' | ')}`);
    writeFileSync(STATE, JSON.stringify(d.next, null, 1) + '\n');
    say(`WOKEN: ${work.length} items (${kinds}) → ${url}`);
    return;
  }
  // Without --fire a wake decision is only reported, and the state keeps what it was, so a dry look
  // never swallows a wake.
  if (!d.fire) writeFileSync(STATE, JSON.stringify(d.next, null, 1) + '\n');
  say(`${d.fire ? 'WOULD WAKE (dry)' : 'no wake'}: ${d.why}; work: ${work.length} (${kinds})`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
