/**
 * THE RECIPE-LINKS RUN: propose, judge, publish. No person in the loop (Rom, 2026-10-08).
 *
 *   npx tsx scripts/recipe-links/run.ts bootstrap --data <dir>     once: the first source.json
 *   npx tsx scripts/recipe-links/run.ts prepare   --data <dir>     live data, the editable dictionary, the to-do
 *   (the session edits <work>/concepts.json and <work>/lines.tsv)
 *   npx tsx scripts/recipe-links/run.ts packets   --data <dir> [--round 2]
 *   (one judge per packet, as subagents: see the printed instructions)
 *   npx tsx scripts/recipe-links/run.ts judge     --data <dir>
 *   npx tsx scripts/recipe-links/run.ts publish   --data <dir> [--dry-run] [--no-push]
 *
 * `--data` is a checkout of `romazeus/noy-hasade-recipes`. The work folder is `--work`, by default
 * `.logs/recipe-links/run` (gitignored). The procedure, step by step, is `docs/RECIPE-LINKS.md`,
 * "The daily run"; the gate itself is `src/data/recipeLinks/judge.ts`.
 *
 * 🔴 `publish` WRITES ONLY THREE FILES, AND ONLY TO THE DATA REPO: `recipe-links.v1.json`,
 * `source.json`, `report.md`. It refuses when anything else in that checkout is dirty, and it
 * never touches the app repo. That is the whole of the standing exception to CLAUDE.md §2.14.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { conceptOf, lineOf, skipOf, specOf, specOfLine, type Spec } from '@/data/recipeLinks/dictionary';
import { candidateMembers } from '@/data/recipeLinks/drift';
import {
  applyScores,
  buildServed,
  chooseAttempt,
  criticBatches,
  guards,
  pairsOf,
  passed,
  pickerBatches,
  PUBLISHED,
  report,
  score,
  strayPaths,
  toJudge,
  type Batch,
  type Plant,
  type Score,
  type Source,
  type Verdict,
} from '@/data/recipeLinks/judge';
import type { CatalogProduct, LiveRecipe } from '@/data/recipeLinks/rules';
import { stripForServing, type ApprovedFile, type ConceptKind, type RecipeLinksFile } from '@/data/recipeLinks/schema';
import { candidates, indexNames } from '@/data/recipeLinks/search';
import { fetchCatalog, fetchRecipes, type LiveRecipeFull } from './live';

const args = process.argv.slice(2);
const cmd = args[0];
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const flag = (name: string) => args.includes(`--${name}`);

const DATA = resolve(arg('data') ?? '../noy-hasade-recipes');
const WORK = resolve(arg('work') ?? '.logs/recipe-links/run');
const OUT = join(WORK, 'out');
const AUTHOR = { name: 'recipe-links', email: 'recipe-links@users.noreply.github.com' };
/**
 * Unchanged pairs re-judged per run. 0 by default since 2026-10-08: the run wakes only when there is
 * work (Rom: only when needed), and every run proves its judges on planted errors anyway.
 */
const ROTATE = Number(arg('rotate') ?? 0);

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;
const writeJson = (p: string, v: unknown, pretty = true) => writeFileSync(p, JSON.stringify(v, null, pretty ? 1 : undefined) + '\n');

type Live = { at: string; catalog: CatalogProduct[]; recipes: LiveRecipeFull[] };
type State = { round: number; seed: number; batches: string[]; rounds: Record<string, string[]> };

function loadSource(): Source {
  const p = join(DATA, 'source.json');
  if (!existsSync(p)) throw new Error(`${p} is missing: run bootstrap, or point --data at the recipes repo`);
  const s = readJson<Source>(p);
  if (s.schema !== 1 || !s.file || !s.verdicts || !Array.isArray(s.plants)) throw new Error('source.json is not a recipe-links source');
  return s;
}

const liveOf = (l: Live): LiveRecipe[] => l.recipes.map((r) => ({ slug: r.slug, postId: r.postId, title: r.title, lines: r.lines }));
const catalogOf = (l: Live) => new Map(l.catalog.map((p) => [p.id, p]));

// ── bootstrap ───────────────────────────────────────────────────────────────

/**
 * The first planted errors: near-misses the dictionary rejected on 2026-10-07 whose reason is a
 * different product TYPE, chosen so that no careful judge could name one. A variant preference
 * (9% for 15%, coarse for fine) is never a plant: a judge that names it may be right.
 */
const BOOT_PLANTS: Plant[] = [
  ['egg', '13739', 'a gadget that keeps vegetables fresh'],
  ['egg', '1234347', 'a plum'],
  ['egg', '726590', 'egg noodles'],
  ['egg', '865159', 'egg salad'],
  ['egg', '1171466', 'egg pasta'],
  ['egg', '1187409', 'fish-roe salad'],
  ['butter', '343929', 'hazelnut butter'],
  ['butter', '545423', 'almond butter'],
  ['butter', '545428', 'peanut butter'],
  ['mascarpone', '691108', 'a sweetened dessert cream'],
  ['mascarpone', '961199', 'a pasta sauce'],
  ['feta', '1187198', 'a pepper spread'],
  ['feta', '1187519', 'a cheese-and-onion spread'],
  ['grana', '961191', 'an alfredo sauce'],
  ['salt', '1070460', 'butter-flavoured popcorn salt'],
  ['salt-coarse', '1070460', 'butter-flavoured popcorn salt'],
  ['vinegar-white', '998358', 'a balsamic-style dressing'],
  ['rice', '1071231', 'a seasoned rice-and-vegetable mix'],
  ['rice', '1071237', 'a mujadara mix'],
  ['pistachio-roasted', '1070617', 'a pistachio, onion and almond mix'],
  ['pistachio-roasted', '545363', 'pistachio paste'],
  ['pumpkin-seeds', '1054678', 'watermelon seeds'],
  ['parsley', '714', 'parsley root, a different vegetable'],
  ['coriander', '1092864', 'a coriander-lime sauce'],
  ['coriander', '527128', 'a kombucha drink'],
  ['shallot', '1025980', 'fried crispy shallots'],
  ['black-garlic', '1194077', 'a black-garlic spread'],
  ['black-garlic', '1194130', 'a black-garlic and honey spread'],
  ['black-garlic', '1120212', 'a camembert cheese'],
  ['peas-frozen', '718988', 'wasabi peas, a snack'],
  ['peas-frozen', '718996', 'roasted peas, a snack'],
  ['peas-frozen', '775', 'pea sprouts'],
  ['tomato', '817', 'sun-dried tomatoes'],
  ['tomato', '1140506', 'sun-dried tomatoes in oil'],
  ['cucumber', '865035', 'pickled cucumbers'],
  ['cabbage-white', '671719', 'sauerkraut'],
  ['leek', '1187555', 'leek patties'],
  ['lemon', '1215045', 'preserved lemon with olives'],
  ['lemon', '825', 'lime'],
  ['pineapple', '718970', 'dried pineapple'],
  ['mango', '719737', 'dried mango'],
  ['raspberry-red', '531', 'blackberries'],
  ['celery-stalks', '712', 'celery root'],
].map(([concept, id, why]) => ({ concept, id, why }));

function bootstrap() {
  const proposed = readJson<ApprovedFile>(arg('proposed') ?? '.logs/recipe-links/proposed.json');
  const errors: string[] = [];
  for (const p of BOOT_PLANTS) {
    const c = proposed.concepts[p.concept];
    if (!c) errors.push(`plant ${p.id}: no concept ${p.concept}`);
    else if (!c.rejected?.some((r) => r.id === p.id)) errors.push(`plant ${p.id}: not on ${p.concept}'s rejected list`);
    else if (c.members.some((m) => m.id === p.id)) errors.push(`plant ${p.id}: a member of ${p.concept}`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  mkdirSync(DATA, { recursive: true });
  const target = join(DATA, 'source.json');
  if (existsSync(target) && !flag('force')) throw new Error(`${target} exists; --force to replace it`);
  const source: Source = { schema: 1, file: proposed, verdicts: {}, plants: BOOT_PLANTS, meta: { catalogSize: 0, recipeCount: 0 } };
  writeJson(target, source);
  console.log(`${target}: ${Object.keys(proposed.concepts).length} concepts, ${Object.keys(proposed.recipes).length} recipes, ${BOOT_PLANTS.length} planted products, no verdicts`);
}

// ── prepare ─────────────────────────────────────────────────────────────────

async function prepare() {
  const source = loadSource();
  const [{ byId }, recipes] = await Promise.all([fetchCatalog(), fetchRecipes()]);
  const live: Live = { at: new Date().toISOString(), catalog: [...byId.values()], recipes };
  for (const r of recipes) for (const t of r.lines) if (/[\t\n]/.test(t)) throw new Error(`a line of ${r.slug} carries a tab or a newline: ${JSON.stringify(t)}`);

  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  writeJson(join(WORK, 'live.json'), live, false);

  const kinds = new Map(Object.entries(source.file.concepts).map(([k, c]) => [k, c.kind]));
  const kindOf = (cid: string) => kinds.get(cid);
  writeJson(join(WORK, 'concepts.json'), Object.fromEntries(Object.entries(source.file.concepts).map(([k, c]) => [k, specOf(c)])));

  // The same text decided in another recipe: a hint, never a decision.
  const elsewhere = new Map<string, string>();
  for (const r of Object.values(source.file.recipes)) for (const [t, l] of Object.entries(r.lines)) if (!elsewhere.has(t)) elsewhere.set(t, specOfLine(l, kindOf));

  const rows = ['# slug\tindex\ttext\tdecision (the line language: dictionary.ts). Empty = undecided; `skip # why` = looked at, cannot decide.'];
  const undecided: { r: LiveRecipeFull; i: number; text: string }[] = [];
  for (const r of recipes) {
    const entry = source.file.recipes[r.slug];
    const postMoved = entry?.postId && r.postId && entry.postId !== r.postId;
    r.lines.forEach((text, i) => {
      const d = !postMoved && entry && Object.prototype.hasOwnProperty.call(entry.lines, text) ? entry.lines[text] : undefined;
      const skip = !postMoved && !d ? source.skipped?.[r.slug]?.[text] : undefined;
      rows.push(`${r.slug}\t${i}\t${text}\t${d ? specOfLine(d, kindOf) : skip !== undefined ? `skip # ${skip}` : ''}`);
      if (!d && skip === undefined) undecided.push({ r, i, text });
    });
  }
  writeFileSync(join(WORK, 'lines.tsv'), rows.join('\n') + '\n');

  const index = indexNames(byId.values());
  const todo: string[] = [`# What waits for a decision (${live.at})`, ''];
  todo.push(`## Lines with no decision (${undecided.length})`, '');
  for (const u of undecided) {
    todo.push(`- ${u.r.title} · \`${u.r.slug}\` line ${u.i}: "${u.text}"${elsewhere.has(u.text) ? `  (decided elsewhere as \`${elsewhere.get(u.text)}\`)` : ''}`);
    const buy = u.r.productsBuy.map((id) => byId.get(id)).filter(Boolean) as CatalogProduct[];
    for (const h of candidates(index, u.text).slice(0, 12)) todo.push(`    ${h.item.id} ${h.item.inStock ? '' : '(אזל) '}${h.item.name} | ${h.item.showPriceBy.trim()}`);
    if (buy.length) todo.push(`    merchant's products_buy: ${buy.map((p) => `${p.id} ${p.name}`).join(' · ')}`);
  }
  const fits = candidateMembers(source.file, byId).filter((x) => x.kind === 'candidate-member');
  todo.push('', `## Live products that fit an ingredient and nobody judged (${fits.length})`, '', 'Add each to the concept\'s `m` (a member) or `x` (refused, with the reason).', '');
  for (const f of fits) if (f.kind === 'candidate-member') todo.push(`- ${f.concept}: ${f.productId} ${f.name}`);
  const gone: string[] = [];
  const changed: string[] = [];
  for (const [cid, c] of Object.entries(source.file.concepts)) {
    for (const m of c.members) {
      const p = byId.get(m.id);
      if (!p) gone.push(`- ${cid}: ${m.id} ${m.name}`);
      else if (p.name !== m.name) changed.push(`- ${cid}: ${m.id} "${m.name}" is now "${p.name}" (judged again automatically)`);
    }
  }
  todo.push('', `## Members the catalogue no longer returns (${gone.length}; not served while gone)`, '', ...gone);
  todo.push('', `## Members renamed (${changed.length})`, '', ...changed);
  const struck = Object.entries(source.verdicts).filter(([, v]) => v.strikes === 1 && (v.picker === false || v.critic === false));
  todo.push('', `## Judged wrong once (${struck.length}): one more "no" blocks the pair for good`, '');
  for (const [k, v] of struck.slice(0, 200)) todo.push(`- ${k}: ${v.why ?? ''}`);
  writeFileSync(join(WORK, 'todo.md'), todo.join('\n') + '\n');

  console.log(`live: ${live.catalog.length} products, ${recipes.length} recipes`);
  console.log(`to decide: ${undecided.length} lines; ${fits.length} candidate members; ${gone.length} members gone; ${changed.length} renamed`);
  console.log(`edit ${join(WORK, 'concepts.json')} and ${join(WORK, 'lines.tsv')}; the list is ${join(WORK, 'todo.md')}`);
}

// ── packets ─────────────────────────────────────────────────────────────────

/** The session's edits, read back into a record. Errors stop the run before any judge is asked. */
function applyEdits(source: Source, live: Live): { file: ApprovedFile; skipped: Record<string, Record<string, string>> } {
  const skipped: Record<string, Record<string, string>> = {};
  const errors: string[] = [];
  const specs = readJson<Record<string, Spec>>(join(WORK, 'concepts.json'));
  const catalog = catalogOf(live);
  const concepts: ApprovedFile['concepts'] = {};
  for (const [cid, s] of Object.entries(specs)) {
    if (!/^[a-z0-9-]{2,40}$/.test(cid)) errors.push(`concept id "${cid}"`);
    concepts[cid] = conceptOf(cid, s, catalog, source.file.concepts[cid], errors);
  }
  const kindOf = (cid: string): ConceptKind | undefined => (Object.prototype.hasOwnProperty.call(concepts, cid) ? concepts[cid].kind : undefined);
  const bySlug = new Map(live.recipes.map((r) => [r.slug, r]));
  const recipes: ApprovedFile['recipes'] = {};
  // Recipes that are not live keep their decisions: a recipe taken down and put back is not new.
  for (const [slug, r] of Object.entries(source.file.recipes)) if (!bySlug.has(slug)) recipes[slug] = r;
  for (const raw of readFileSync(join(WORK, 'lines.tsv'), 'utf8').split('\n')) {
    if (!raw.trim() || raw.startsWith('#')) continue;
    const [slug, idx, text, spec = ''] = raw.split('\t');
    const r = bySlug.get(slug);
    if (!r) {
      errors.push(`lines.tsv: no live recipe ${slug}`);
      continue;
    }
    if (r.lines[Number(idx)] !== text) {
      errors.push(`lines.tsv: ${slug} line ${idx} is "${r.lines[Number(idx)]}", not "${text}"`);
      continue;
    }
    const entry = (recipes[slug] ??= { ...(r.postId ? { postId: r.postId } : {}), title: r.title, lines: {} });
    if (!spec.trim()) continue;
    const skip = skipOf(spec);
    if (skip !== null) {
      if (!skip) errors.push(`${slug} line ${idx}: a skip needs its reason (\`skip # why\`)`);
      else (skipped[slug] ??= {})[text] = skip;
      continue;
    }
    const rec = lineOf(spec, kindOf, errors, `${slug} line ${idx}`);
    if (!rec) continue;
    const prior = entry.lines[text];
    if (prior && JSON.stringify(prior) !== JSON.stringify(rec)) errors.push(`${slug}: "${text}" appears twice with different decisions`);
    entry.lines[text] = rec;
  }
  if (errors.length) {
    console.error(`✗ ${errors.length} errors in the edits:\n  ${errors.join('\n  ')}`);
    process.exit(1);
  }
  // Skips of recipes that are not live are kept, like their decisions.
  for (const [slug, lines] of Object.entries(source.skipped ?? {})) if (!bySlug.has(slug)) skipped[slug] = lines;
  return { file: { schema: 1, concepts, recipes }, skipped };
}

function packets() {
  const source = loadSource();
  const live = readJson<Live>(join(WORK, 'live.json'));
  const round = Number(arg('round') ?? 1);
  if (round !== 1 && round !== 2) throw new Error('--round is 1 or 2: a disagreement is fixed once, never argued');
  const statePath = join(WORK, 'state.json');
  const state: State = round === 1 ? { round, seed: 0, batches: [], rounds: {} } : readJson<State>(statePath);
  if (round === 2 && !state.rounds['1']) throw new Error('round 2 needs round 1 judged first');

  const { file, skipped } = applyEdits(source, live);
  writeJson(join(WORK, 'proposed.json'), file);
  writeJson(join(WORK, 'skipped.json'), skipped);
  const verdicts: Record<string, Verdict> = round === 1 ? source.verdicts : readJson(join(WORK, 'verdicts.json'));
  const liveRecipes = liveOf(live);
  const { links, pairs } = pairsOf(file, liveRecipes);
  const catalog = catalogOf(live);
  const { fresh, rotated, blocked } = toJudge(pairs, verdicts, round === 1 ? ROTATE : 0, (id) => catalog.has(id));
  const real = [...fresh, ...rotated];
  const world = { file, catalog, index: indexNames(live.catalog), plants: source.plants };
  const seed = (Date.now() ^ (round * 0x9e3779b9)) >>> 0;
  const realLinks = [...new Map(real.map((p) => [p.link.key, p.link])).values()];
  const batches: Batch[] = real.length
    ? [...pickerBatches(world, realLinks, [...links.values()], seed), ...criticBatches(world, real, [...pairs.values()], seed + 1)]
    : [];
  const dir = join(WORK, 'batches');
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(WORK, 'answers'), { recursive: true });
  const ids: string[] = [];
  for (const b of batches) {
    const id = `r${round}-${b.id}`;
    ids.push(id);
    writeFileSync(join(dir, `${id}.txt`), b.text);
  }
  const keyPath = join(WORK, 'key.json');
  const keys: Record<string, Batch> = existsSync(keyPath) && round === 2 ? readJson(keyPath) : {};
  for (const b of batches) keys[`r${round}-${b.id}`] = { ...b, id: `r${round}-${b.id}` };
  writeJson(keyPath, keys, false);
  state.round = round;
  state.seed = seed;
  state.rounds[String(round)] = ids;
  writeJson(statePath, state);

  console.log(`round ${round}: ${fresh.length} pairs never judged as they are, ${rotated.length} re-judged in rotation, ${blocked.length} blocked`);
  for (const b of batches) console.log(`  r${round}-${b.id}: ${Object.keys(b.key).length} items, ${b.plants} planted${b.unprovable ? '  ✗ TOO FEW PLANTS: this run cannot publish' : ''}`);
  if (!batches.length) {
    console.log('NOTHING TO JUDGE');
    return;
  }
  const here = resolve('scripts/recipe-links/judges');
  console.log('\nOne judge per packet, each a fresh subagent that sees nothing else. Its prompt:');
  console.log(`  "Read ${here}/<PICKER|CRITIC>.md and ${dir}/<id>.txt, and write your answers to ${join(WORK, 'answers')}/<id>.txt.`);
  console.log('   Open no other file." A packet whose answer fails gets ONE more fresh judge, writing <id>.2.txt.');
}

// ── judge ───────────────────────────────────────────────────────────────────

function judge() {
  const source = loadSource();
  const live = readJson<Live>(join(WORK, 'live.json'));
  const state = readJson<State>(join(WORK, 'state.json'));
  const keys = readJson<Record<string, Batch>>(join(WORK, 'key.json'));
  const file = readJson<ApprovedFile>(join(WORK, 'proposed.json'));
  const liveRecipes = liveOf(live);
  const catalog = catalogOf(live);
  const { pairs } = pairsOf(file, liveRecipes);
  const now = new Date().toISOString();

  // Every batch of every round: the first attempt that passed, or the last that failed.
  const scores: Score[] = [];
  const allScores: Score[] = [];
  const thisRound = new Set(state.rounds[String(state.round)] ?? []);
  for (const ids of Object.values(state.rounds)) {
    for (const id of ids) {
      const b = keys[id];
      const attempts = [`${id}.txt`, `${id}.2.txt`]
        .map((f) => join(WORK, 'answers', f))
        .filter(existsSync)
        .map((path) => score(b, readFileSync(path, 'utf8')));
      allScores.push(...attempts);
      const chosen = chooseAttempt(attempts);
      if (chosen) scores.push(chosen);
    }
  }
  const prior: Record<string, Verdict> = state.round === 1 ? source.verdicts : readJson(join(WORK, 'verdicts.json'));
  const fresh = scores.filter((s) => thisRound.has(s.batch));
  const verdicts = applyScores(prior, pairs, fresh, now);
  writeJson(join(WORK, 'verdicts.json'), verdicts, false);

  const skippedPath = join(WORK, 'skipped.json');
  const skipped = existsSync(skippedPath) ? readJson<Record<string, Record<string, string>>>(skippedPath) : source.skipped ?? {};
  const next: Source = { ...source, file, verdicts, skipped };
  const built = buildServed(next, catalog, liveRecipes);
  const previousPath = join(DATA, 'recipe-links.v1.json');
  const previous = existsSync(previousPath) ? readJson<RecipeLinksFile>(previousPath) : undefined;
  const batches = Object.values(state.rounds).flat().map((id) => keys[id]);
  const refusals = guards({ served: built.served, exclusions: built.exclusions, source: next, previous, live: liveRecipes, catalogSize: catalog.size, scores, batches, refused: built.refused });

  const suggestions: string[] = [];
  for (const s of scores) {
    if (!passed(s)) continue;
    for (const [lk, pick] of s.picks) {
      const [text, concept] = JSON.parse(lk) as [string, string];
      const members = new Set(file.concepts[concept]?.members.map((m) => m.id));
      for (const id of pick.ids) if (!members.has(id)) suggestions.push(`${concept} "${text}": ${id} ${catalog.get(id)?.name ?? ''}`);
    }
  }
  const md = report({ at: now, live: liveRecipes, served: built.served, exclusions: built.exclusions, batches, scores: allScores, refusals, source: next, suggestions: [...new Set(suggestions)].slice(0, 200) });

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const publish = refusals.length === 0;
  writeFileSync(join(OUT, 'report.md'), md);
  if (publish) {
    next.meta = { catalogSize: catalog.size, recipeCount: liveRecipes.length, at: now };
    writeJson(join(OUT, 'source.json'), next);
    writeJson(join(OUT, 'recipe-links.v1.json'), stripForServing(built.served), false);
  }
  writeJson(join(OUT, 'status.json'), { publish, refusals, at: now });

  const failed = scores.filter((s) => !passed(s) && thisRound.has(s.batch));
  const nos = Object.entries(verdicts).filter(([k, v]) => pairs.has(k) && v.h === pairs.get(k)!.h && (v.picker === false || v.critic === false) && v.at === now);
  console.log(`judged: ${fresh.filter(passed).length}/${fresh.length} packets passed this round${failed.length ? `; FAILED: ${failed.map((s) => s.batch).join(', ')} (one more fresh judge each, writing <id>.2.txt)` : ''}`);
  console.log(`this round's "no": ${nos.length} pairs${nos.length && state.round === 1 ? ' (fix once in concepts.json / lines.tsv, then `packets --round 2`, or leave them as plain text)' : ''}`);
  console.log(publish ? `READY TO PUBLISH: ${join(OUT)}` : `NOT PUBLISHABLE:\n  ${refusals.join('\n  ')}`);
  console.log(`report: ${join(OUT, 'report.md')}`);
  process.exitCode = publish ? 0 : 3;
}

// ── publish ─────────────────────────────────────────────────────────────────

function git(...a: string[]): string {
  return execFileSync('git', ['-C', DATA, ...a], { encoding: 'utf8' }).trim();
}

/**
 * The paths `git status --porcelain` names. 🔴 Never trimmed: the first line of the output starts
 * with a space (" M source.json"), and a trim shifted it, so the first publish read "ource.json" as
 * a stranger and refused itself (2026-10-08).
 */
function changedPaths(): string[] {
  return execFileSync('git', ['-C', DATA, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .map((l) => l.slice(3));
}

function publish() {
  const status = readJson<{ publish: boolean; refusals: string[]; at: string }>(join(OUT, 'status.json'));
  const dirty = changedPaths();
  if (dirty.length) throw new Error(`the data checkout has changes of its own; refusing:\n${dirty.join('\n')}`);
  // A refused run still publishes its report, so the refusal is visible where the file lives.
  const files = status.publish ? [...PUBLISHED] : ['report.md'];
  const changed = files.filter((f) => {
    const target = join(DATA, f);
    return !existsSync(target) || !readFileSync(target).equals(readFileSync(join(OUT, f)));
  });
  if (!changed.length) {
    console.log('nothing changed; no commit');
    return;
  }
  const msg = status.publish ? `run ${status.at}: published` : `run ${status.at}: NOT published (${status.refusals.length} guard(s) refused; see report.md)`;
  if (flag('dry-run')) {
    console.log(`dry run: would commit ${changed.join(', ')} as "${msg}"`);
    return;
  }
  for (const f of changed) writeFileSync(join(DATA, f), readFileSync(join(OUT, f)));
  const stray = strayPaths(changedPaths());
  if (stray.length) throw new Error(`refusing: paths other than the three changed: ${stray.join(', ')}`);
  git('add', '--', ...changed);
  // A public repo: the run commits under a no-reply identity, as the status repo's catalog-watch does,
  // never under the e-mail of whoever's machine or account it runs on.
  git('-c', `user.name=${AUTHOR.name}`, '-c', `user.email=${AUTHOR.email}`, 'commit', '-m', msg, '--', ...changed);
  if (!flag('no-push')) {
    // The hourly watcher commits its own file (`watch.json`) to main; replay this commit on top of
    // whatever it pushed meanwhile, so the two never collide (they never touch the same file).
    git('-c', `user.name=${AUTHOR.name}`, '-c', `user.email=${AUTHOR.email}`, 'pull', '--rebase', '--quiet', 'origin', 'main');
    git('push', 'origin', 'HEAD:main');
  }
  console.log(`${msg}\n${git('log', '-1', '--format=%H')}`);
}

// ── main ────────────────────────────────────────────────────────────────────

const commands: Record<string, () => unknown> = { bootstrap, prepare, packets, judge, publish };
if (!commands[cmd]) {
  console.error('usage: run.ts bootstrap|prepare|packets|judge|publish --data <dir>');
  process.exit(2);
}
Promise.resolve()
  .then(() => commands[cmd]())
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });

