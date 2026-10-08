# Noy Hasade recipe links

Which shop products each recipe line in the Noy Hasade app offers, and how much "הוסיפו את כל המצרכים" puts in the cart.

- `recipe-links.v1.json`: what the app reads. Only links that passed the rules and two independent judges, each proven on planted errors in the same run.
- `source.json`: the whole dictionary (every proposal, every rejected candidate and why) and the judges' verdicts. The next run starts from it.
- `report.md`: the last run: what was served, what became plain text and why, how the judges did on the planted errors.

Written by a daily automated run (`scripts/recipe-links/run.ts` in the app repo). Every run is one commit, so the history is the record and any version can be restored.
