# House style for docs

Date: October 3, 2026. Status: proposed with the [documentation overhaul](./README.md).

This page is the style every shipped doc follows. It comes from the
[Google developer documentation style guide](https://developers.google.com/style), with extra rules
against the patterns that make text read as machine-written. Where this page is silent, follow the
Google guide.

## Voice

- Write to the reader as "you". Use the imperative for steps: "Run `pnpm lint`."
- Use the present tense and the active voice. Name the actor: "The node writes the row", not "The
  row is written".
- Describe what the software does in the third person. Don't give it human qualities.
- Say what a thing does, not how it feels. Name the mechanism or the number.
- Have a view. If one option is right, say so and say why.
- Vary sentence length. Keep most sentences under about 26 words.
- Put one idea in each paragraph. Split a paragraph past five or six sentences.

## Words to avoid

- Filler: please, simply, just, easy, quickly, note that, in order to.
- Time anchors: now, new, currently, soon, latest, existing, "not yet". Describe the state as it is.
  If a date matters, write the date.
- Claims you can't back with a number: best, fastest, always, never, ensure, guarantee.
- Puffery and stock phrases: robust, seamless, powerful, crucial, pivotal, delve, serves as,
  stands as, "not just X, but Y".
- Abstract metaphors: substrate, surface, primitive, vector, scaffolding. Use the concrete word.
- Ableist words and idioms: sanity check, crazy, blind to. Use allowlist and denylist.

Use one term for one concept. If the code calls it a contribution, the doc calls it a contribution
every time.

## Mechanics

- Sentence case for every heading. No trailing period. One h1 per page. Don't skip levels.
- Task headings start with a verb: "Add a pane". Concept headings are noun phrases.
- Serial comma. Straight quotes. No em dashes. Avoid semicolons and parentheses where a full stop
  works.
- Code font for code, paths, commands, flags, and identifiers. Bold for UI labels only.
- Link text names the target. Never "here" or a bare URL.
- Introduce a list with a full sentence and a colon. Number steps. Never write a one-item list.
- Spell out zero to nine. Use numerals for 10 and up, versions, and measurements.
- Write dates as "October 3, 2026".

## Page shape

Open with one or two sentences that say what the page covers and who needs it. Then, in this order
where they apply:

1. What it does, with the source paths that own it.
2. How to use or extend it.
3. Limits and known gaps.
4. A short "Why" section for design reasoning a reader needs before changing the code.

Leave out the history of how the design arrived. Git history keeps it.

## Split a long page

Split a page that runs past about 200 lines. Here's how:

1. Create a folder named after the page: `docs/managed-agents/` for `docs/managed-agents.md`. Some
   folders exist already, such as `docs/plugins/` and `docs/tui/`. Reuse them.
2. Move each topic into its own file in that folder. Name the file after the topic, in lowercase
   with hyphens, as [conventions](../../conventions.md) describes.
3. Keep `docs/<page>.md` as the landing page. It keeps a summary and a list of the topic pages. Source
   comments cite these paths about 3,000 times, so the landing page stays where it is.
4. For each heading that moved, leave an `<a id="old-heading-slug"></a>` anchor on the landing page
   next to the link to its new home. Old links then still land somewhere useful.
5. Update the source comments that cite a moved section, so they name the new file.
6. Add every new file to [docs/README.md](../../README.md).

Don't split a page by length alone. Each new file holds one topic a reader would look for by name.
