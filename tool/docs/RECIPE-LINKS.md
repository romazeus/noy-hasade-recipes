---
area: catalog
tier: 1
status: living
read_before: "Any change to what a recipe line offers, the recipe-links files, the daily run, or what add-all writes."
---
# Recipe links: no person, no server; two judges, proven on every run

Rom, 2026-10-07: *"אסור בשום פנים ואופן למערכת לטעות"*. A recipe line "1 ביצה" showed ביצת הפלא,
a vegetable-freshness gadget; salt showed nothing on 47 of 62 salt lines although the shop sells
six. The matcher compared SPELLING (`stem('ביצה') === stem('ביצת')`), and no tuning makes a
spelling matcher right every time. So the app stopped deciding.

Rom, 2026-10-08, after a panel with logins, a database and nine review rounds had been built for a
person to approve every link: *"אתה יכול לבנות מערכת שתדייק ב99.9%... בלי התערבות שלי או של כל
אדם אחר ופתיחת שרתים ובלגן."* He was right. "100% needs a person" was true of the string matcher,
not of judgment; what a person added was a CHECK, and a check can be made by independent judges,
provided their reliability is measured rather than assumed. The plan:
`~/.claude/plans/wondrous-baking-plum.md`; Rom's decisions: memory `project_recipe_links_plan`.

## 1. The model

    a recipe line  ──►  one or more CONCEPTS (fresh coriander, salt, eggs)  ──►  MEMBERS (products)
                         mode 'all' (מלח ופלפל) or 'any' (חמאה או שמן)          resolved live

- **A line links to a concept, never to a product.** The concept's members are resolved against
  the live catalogue when the page opens: seasonal products come and go, and the organic /
  mehadrin / packaged choice is offered. A coriander-lime sauce can never appear, because no judge
  let it through as fresh coriander.
- **A substitute is marked** (`LineLink.substitute`, Rom: "תחליף מסומן"): when the shop does not
  sell what the line names but sells what a cook would use instead (grana padano for parmesan),
  the row offers it AND says so.
- **Not judged means plain text.** A new recipe, an edited WordPress line, a renamed product: each
  renders as plain text until the next run has proposed and judged it.

Code (`src/data/recipeLinks/`): `schema.ts` (the format), `rules.ts` (what a machine refuses),
`judge.ts` (the gate), `dictionary.ts` (the compact form a session edits), `describe.ts` (what an
order is, and how it reads), `search.ts` (the spelling-blind candidate search), `drift.ts` (what
changed), `catalog.ts` (the one product reducer). The driver: `scripts/recipe-links/run.ts`; the
judges' instructions: `scripts/recipe-links/judges/`.

## 2. The gate (`judge.ts`)

A link is served only when ALL of these hold:

1. **Proposed**: a session wrote it into the dictionary.
2. **The rules pass** (section 3), against the live catalogue. An error makes THAT line (or that
   member, or that recipe) plain text; the rest is built again until clean.
3. **The PICKER agreed.** A judge that did not write the link sees the recipe, the line, the part
   of it in question, and every live product sharing a word with it, spelling-blind, out of stock
   included, the members unmarked among them. It names the right ones. 🔴 A member it did not name
   for ANY line leaves its concept everywhere: the served file has one member list per concept.
4. **The order CRITIC agreed.** A second judge sees the line, the product, and the exact order
   "add all" would place (`orderOf`, `describe.ts`): quantity, unit, cost, the substitute mark, the
   staple flag. 🔴 A "no" costs only that LINE: an amount belongs to a line.
5. **Both judges were proven in the same batch.** Every batch carries planted errors, unmarked: at
   least ten, and one in ten when larger (`minPlants`).
   - For the picker: products that are certainly not the ingredient, from `source.plants` (43 on
     2026-10-08, chosen from the dictionary's own rejected near-misses whose reason is a different
     product TYPE: ביצת הפלא for eggs, a dessert cream for mascarpone, a sauce for coriander). A
     variant preference (9% for 15%) is never a plant: a judge that names it may be right.
   - For the critic: real links shown wrong: ten times the order, a type-wrong product swapped in,
     a staple shown as ordered or an egg shown as a staple.
   - 🔴 A judge that lets ONE through: its batch counts for nothing and ONE fresh judge runs it
     again; a second miss and the run publishes nothing (`chooseAttempt`, `guards`). 🔴 A passing
     first attempt is final: asking again after a pass would let a run shop for its verdict.
   - 🔴 A planted item must read exactly like a real one. The first packets priced a "ten times"
     plant at the REAL order's cost and left a swapped-in product without its "what one unit holds"
     note; both gave plants away and would have flattered the judges (`orderCost`).
6. **Two "no"s block a pair for good** (`MAX_STRIKES`): a disagreement is fixed once, never argued.
7. **A verdict holds only for exactly what was judged.** It stores `pairHash` of the line, the need,
   the concept and the member as the judges saw them (name, sale model, variant, what a unit
   holds). Any change, a rename at the shop included, is judged again before it is served: what
   is judged comes from the content, never from a session's account of what it changed.

**Why this reaches 99.9%.** A wrong link must fool the proposer, both judges and the rules. Each
judge's miss rate is measured on the plants: zero misses on ~70 plants per judge bounds it under 5%
(95% confidence). Even if the two judges always failed together, a proposer error rate of about 1%
(the blind second opinion of 2026-10-07 raised 8 questions in ~700 links, none a proven error)
times 5% leaves fewer than 1 in 2,000. 🔴 The limit: plants are blatant, and a subtle error that
looks right to every judge is not measured by them.

**The guards** (`guards`): each one REFUSES the publish, and the app keeps its last good file:
the served bytes fail `parseRecipeLinksFile`; a batch failed twice or carried too few plants; the
catalogue or the recipe index came back under 90% of the last run's size (a half-read looks exactly
like a mass delisting); a served link would disappear with no recorded reason (a product gone, a
judge's no, a rule, a line gone from WordPress, an explicit rejection with its reason).

## 3. The rules (`rules.ts`)

Each one is a defect measured on the live catalogue (tests: `src/data/recipeLinks/__tests__`):

- a member in a household root (276, 327). ביצת הפלא is ALSO in fresh fruit, so "only in a
  household root" would have let it through;
- a member outside its concept's own categories (eggs: 284);
- a member whose name does not lead with EVERY word of the label ("שמן זית" must not pass canola);
- a pack size typed by hand that disagrees with what the shop prints (`showPriceBy` first, the
  name second, and "21 גרם חלבון" is never a size);
- a product sold by weight (`kg`, `both`) provides by weight, "whole pack" included;
- one concept asked for in two units in one recipe (the cart holds one line per product);
- 🔴 one PRODUCT asked for by the kilo and by the piece in one recipe (`recipe-product-unit-mix`,
  `cartUnit`): `state/cart.ts` keeps the first unit and adds the second quantity on top, so half a
  kilo and 8 apples become 8.5 kilos. Only that recipe's lines become plain text;
- a bunch or a package is a whole number of the sale unit (`member-provides-whole`);
- a "whole pack" on a line asking for more than one bunch or package is reported
  (`whole-pack-large`): "2 חבילות כוסברה" ordered one;
- an amount that disagrees with the amount the line itself states is reported
  (`line-amount-text`, `statedAmounts`), read from the TEXT: number words, ranges ("4-3" is the
  Hebrew "3-4"), and two amounts in two units each checked. ⚠️ A line that states no amount at all
  has nothing to compare with: a typo there meets only the price ceiling and the critic;
- grams far from the count times the shop's piece weight (`line-amount-weight`), one piece to taste
  where the line says several (`line-taste-pieces`), one ingredient twice in a line
  (`line-concept-twice`), one product through two links (`line-product-twice`);
- 🔴 in the served build, a line over the price ceiling (₪150) is an ERROR (`priceIsError`), priced
  as add-all would order it, sold by weight too (`lineCost`); a line that needs ALL its links is
  priced WHOLE (`line-price-total`); a line in pieces with no piece weight cannot be priced
  (`line-unpriced`); the ceiling holds at the REGULAR price (a sale ends, the line does not change).
  This is what keeps the cheesecake's decoration fruit plain text (Rom's decision 16).

Warnings stand and go in the run's report. Undecided lines are not errors in the served build: the
gate leaves them out by design.

🔴 **`RULES_VERSION`** and `__tests__/rulesVersion.test.ts` pin what the rules find over a corpus
that reaches all 33 codes, and the source of `rules.ts` and `utils/hebrew.ts`: an edit there fails
until someone decides whether the findings changed. A comment-only edit re-pins the source alone.

## 4. Where it lives: no server

The public repo `romazeus/noy-hasade-recipes`:

    recipe-links.v1.json   what the app reads (stripForServing of the judged part)
    source.json            the dictionary (every proposal, every rejection and why), the judges'
                           verdicts, the planted products, the skipped lines, the last run's sizes
    report.md              the last run: what was served, what is plain text and why, the judges
                           on their plants, the not-sold list, the picker's suggestions
    watch.json             the watcher's state (and its heartbeat)
    tool/                  a byte-identical COPY of the run's code from this repo (sync-tool.mjs)
    .github/workflows/watch.yml, .claude/agents/recipe-judge.md, .gitignore

Why its own repo: the run writes without asking, so it must never be able to reach `gate.json` or
`promos.json` (the app's kill switches) in the status repo, nor the app repo, which is private and
builds from. The routine clones ONLY this repo. Every run is one commit: the history is the record
and the undo.

🔴 **The code's source is THIS repo** (`scripts/recipe-links/`, `src/data/recipeLinks/`), where its
tests are. `tool/` is a copy: `node scripts/recipe-links/sync-tool.mjs --data <recipes checkout>`
writes it, `--check` says whether it is current. A change not synced does not run; a synced change
runs unattended from the next wake, so sync only what is committed and tested, and pushing it is a
push (Rom's yes).

## 5. The run: woken only when there is work

Rom, 2026-10-08: *"רק אם יש צורך אז שהai יחשוב ולא סתם סריקה כל יום"*. Two parts:

- **The watcher** (`watch.ts`, rule `watchRule.ts`): GitHub Actions in the recipes repo, every hour,
  free, no AI. It asks whether anything waits for a decision: a live recipe line with no decision
  (a new recipe, an edited line), a live product that fits an ingredient and was never decided, a
  pair never judged as it is now (a renamed member, a member back in the shop). New work waits one
  check so a recipe still being edited is not judged half-written, then it wakes the routine through
  its API trigger (token: the repo secret `RECIPE_ROUTINE_TOKEN`). The same work is retried once a
  day later, then never again until it changes. A quiet hour costs nothing and commits nothing.
- **The routine** (`ROUTINE.md`): a Claude Code session in Anthropic's cloud, on Rom's plan, with no
  schedule of its own. 🔴 It is the ONE standing exception to CLAUDE.md §2.14: it commits those three
  files to the recipes repo without asking. Nothing else.

The routine's procedure, from the recipes repo's `tool/` folder:

    R() { npx -y tsx --tsconfig scripts/recipe-links/tsconfig.json scripts/recipe-links/run.ts "$@"; }
    R prepare --data ..

(A function, not a variable: zsh does not split a variable into words. 🔴 No `npm install`: the
run's import graph is node builtins and `src/` only, checked on a bare copy with no `node_modules`;
its own `tsconfig.json` exists because the app's extends `expo/tsconfig.base`. A package import in
`src/data/recipeLinks/` would break the cloud job, not the app.)

1. **Read `.logs/recipe-links/run/todo.md`** and decide EVERYTHING it lists, editing ONLY
   `.logs/recipe-links/run/concepts.json` (one compact spec per concept: `m` members, `x` refused
   with a reason) and `.logs/recipe-links/run/lines.tsv` (the decision column, in the line language
   of `dictionary.ts`). Names and sale models are never typed: they come from the live catalogue.
   - a line with no decision: read the recipe; decide it (`egg:2 + salt`, `~grana:50`, `?`, `-`).
     🔴 A "not sold" (`?`) is a claim that needs the widest search: the to-do lists every product
     sharing a word with the line and the merchant's `products_buy`; read them all first (Rom found
     silan and black garlic sold after they were called gaps);
   - a product that fits an ingredient: add it to `m` with its variant and what one unit holds, or
     to `x` with the reason;
   - 🔴 when you genuinely cannot decide a line: `skip # why`. It stays plain text and is not asked
     again while its text holds. Never leave a line empty: the watcher would wake the AI for it.
2. `R packets --data ..` prints the packets. For EACH packet, one fresh subagent of type
   `recipe-judge` (the repo's `.claude/agents/recipe-judge.md`: it can only read and write), at most
   20 at a time, with exactly this prompt:

       Instructions: tool/scripts/recipe-links/judges/<PICKER|CRITIC>.md
       Packet: tool/.logs/recipe-links/run/batches/<id>.txt
       Answer: tool/.logs/recipe-links/run/answers/<id>.txt

   🔴 Never read a packet's answer key (`key.json`), never write an answer yourself, never edit an
   answer, never give a judge any hint. The run's worth is the judges' independence.
3. `R judge --data ..`. A packet it reports FAILED gets ONE more fresh judge, writing `<id>.2.txt`,
   then `judge` again. Never a third.
4. Optional, once: the pairs judged "no" are listed. Fix the ones the proposer genuinely got wrong,
   then `R packets --data .. --round 2`, judges, `R judge --data ..`. Never argue a "no" by
   re-proposing the same thing.
5. `R publish --data .. --push`. It commits `recipe-links.v1.json`, `source.json` and `report.md`
   to `main` (a refused run commits only the report; a run that judged and changed nothing commits
   nothing), rebasing over the watcher's own commits, and refuses if anything else changed.
   🔴 Pushing is opt-in: without `--push` it only commits locally, so a rehearsal can never reach
   GitHub (one did, on 2026-10-08, before this flag). Never change any other file.

**When a step fails:** the shop API or the recipe index fails: stop, publish nothing; the watcher
retries once a day later. A guard refuses: publish (the report alone goes out) and stop; never edit
a guard, a plant or a verdict to get past one. The app keeps its last good file in every case.

**What it costs** (measured 2026-10-08). The first full run (the whole dictionary, 24
general-purpose judges, in a session) took about 4.7 million tokens, once. In the cloud, the lean
`recipe-judge` agent (it can only read and write) judged a packet of 8 items with 10 plants in about
15,000 tokens, and the whole dry run, start to finish, took 77 seconds. A wake that judges a few
changed lines costs a small fraction of a day of interactive work; a quiet day costs nothing, and a
wake that finds nothing commits nothing. 🔴 There is no rotation (`--rotate`, default 0): every run
proves its judges on planted errors, and a link is judged again whenever what was judged changes.

## 6. Measured

2026-10-07 (65 recipes, 756 lines, 749 distinct texts):

    today's matcher     499 lines linked (66.0%); 67 of those offer a product the proposal does not
    the proposal        699 of the 735 a shop could sell (95.1%), 33 of them marked substitutes;
                        35 not sold (19 ingredients), 2 unclear, 21 not a shop item;
                        195 concepts, 339 products
    an independent read of all 461 orders add-all would make: none wrong
    a blind second opinion: 8 questions in ~700 links, all ambiguities, none a proven error

2026-10-08, the first judged run (the whole dictionary, 1,150 pairs, 22 packets):

    the judges          366 planted errors (236 to pickers, 130 to critics), NONE let through;
                        every packet passed on its first judge. Rule of three: each judge's miss
                        rate under 1.3% (picker) and 2.3% (critic), 95% confidence
    their refusals      41 pairs in round 1. Real catches: dry chickpeas offered for a can, a
                        berry mix split into invented amounts, a balsamic REDUCTION offered as
                        vinegar, a ready pomegranate-and-honey dressing decomposed, a brand
                        difference marked as a substitute, amounts read wrongly ("1 כף" as a
                        pack, half a pineapple as one)
    one fix round       6 lines corrected, all 6 accepted (silan now offered, marked substitute)
    served              674 of the 680 lines that had a product in season (99.1%); 32 marked
                        substitutes; 57 not sold or not a shop item; 12 lines of fruit out of
                        season (strawberry, fig, cherry, apricot) wait for their products
    the merchant's lists checked 2026-10-08 (every recipe's products_buy, the app's "מצרכים
                        שתוכלו לרכוש פה", Rom: no longer needed once stage 2 ships): 513 offered by
                        the system, 378 no longer in the catalogue, 108 left out, almost all on
                        purpose (salted butter for baking, crushed-garlic jars, 2.8 kg sacks for one
                        potato, a dip bowl). One proposer error fixed (the tart's mushroom mix read
                        as a pack). 🔴 Two recipes LACK a main ingredient in their own list, so no
                        product can be offered for it until the line exists in WordPress: כרוב ממולא
                        (no cabbage, no onion), רושטי עם תרד מוקפץ וביצת עין (no egg)
    🔴 a judge was wrong once, and it stands: "פקאן סיני" IS the candied pecan in Israel, and
                        the critic refused it as "not plain pecan". Re-proposing it would be
                        arguing; the line stays plain text. That is the price of the rule.

## 7. The panel, retired (2026-10-08)

For one day the plan was a permanent panel on our own Cloudflare Worker (review.noyhasade.co.il):
D1, Cloudflare Access, a staff approver, Rom's sample. Nine adversarial review rounds found and
fixed 117 defects in it. Rom retired it the same day for this design. Its code is in git at
`abcf69b0` (`infra/recipe-review/`, `src/data/recipeLinks/panel.ts`). Its lessons that still bind
live in `rules.ts` (amounts read from the line text, prices held at the regular price, a product's
unit mix within a recipe). The OLD review page it was meant to replace was deleted with Rom's yes
the same evening (Worker `noy-recipe-review`, its KV namespace, its admin token and links); the
one mark staff made there (silan, "יש לנו 3 רטבי סילאן") had already been applied.

## 8. Not built yet

- **Going live** (2026-10-08): the recipes repo is public with the first judged run; Rom connected
  GitHub (`/web-setup`) and created the cloud environment `noy-recipes`; the routine exists, OFF,
  until its environment is chosen and its API token is stored (his three minutes); its first wake
  is a dry run whose log a session reads. The branch `recipe-links-run` pushed to the app repo
  earlier that evening is no longer used: the routine clones only the recipes repo.
- **Stage 2, the app**: the store for the served file, the resolver, add-all from the judged links
  with recipe quantities through `orderOf`, the substitute mark (Tier 1, ships alone, images
  first), after a week of clean runs. Until then the app runs the old matcher. 🔴 `orderOf` is
  what the critic judged; if stage 2 ever changes its table, every pair must be judged again
  (put an order version into `pairHash`), or the app would order something no judge saw.

🔴 **Never reintroduce runtime matching under `src/`.** The guarantee is that the app contains no
matcher; stage 2 adds a test that fails if anything under `src/` imports one.
