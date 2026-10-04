# Write and maintain docs

This page says where a doc goes, how to write it, and what the doc checks enforce. Read it before you
add a page, move a section, or cite a doc from a source comment.

## Where a doc goes

Each kind of text has one home:

- **Shipped behavior** goes in a reference page under `docs/`. Each contract has one owning page.
  Other pages link to it instead of copying its details.
- **Proposals, plans, and analyses** go in `docs/future/`. Each file states its date and status near
  the top, and [the future index](./future/README.md) lists it. When the work ships, describe the
  behavior in the owning reference page. Where the two disagree, the reference page wins.
- **Dated evidence** stays as written. That's the results in `docs/testing/` and
  `docs/security/review-*.md`. Fix a broken link in one and change nothing else.

Name a new file in lowercase with hyphens, as [conventions](./conventions.md) describes. List it in
[docs/README.md](./README.md) in the same commit. Nothing else indexes the docs.

`AGENTS.md` is the short guide agents read first. It links into `docs/` and doesn't repeat it.

## Page shape

Open with one or two sentences that say what the page covers and who needs it. Then, in this order
where they apply:

1. What it does, with the source paths that own it.
2. How to use or extend it.
3. Limits and known gaps.
4. A short "Why" section for design reasoning a reader needs before changing the code.

Leave out the history of how the design arrived. Git history keeps it. Label a measurement with the
date it was taken.

## Voice

The style comes from the [Google developer documentation style guide](https://developers.google.com/style),
plus rules against the patterns that make text read as machine-written. Where this page is silent,
follow the Google guide.

- Write to the reader as "you". Use the imperative for steps: "Run `pnpm lint`."
- Use the present tense and the active voice. Name the actor: "The node writes the row", not "The
  row is written".
- Say what a thing does, not how it feels. Name the mechanism or the number.
- Have a view. If one option is right, say so and say why.
- Keep most sentences under about 26 words, and put one idea in each paragraph.
- Use one term for one concept. If the code calls it a contribution, the doc calls it a contribution
  every time.

Leave out these words:

- Filler: please, simply, just, easy, quickly, note that, in order to.
- Time anchors: now, new, currently, soon, latest, existing, "not yet". Describe the state as it is,
  and write a date when one matters.
- Claims you can't back with a number: best, fastest, always, never, ensure, guarantee.
- Puffery: robust, seamless, powerful, crucial, pivotal, delve, serves as, "not just X, but Y".
- Abstract metaphors: substrate, surface, primitive, vector, scaffolding. Use the concrete word.
- Ableist words: sanity check, crazy, blind to. Write allowlist and denylist.

## Mechanics

- Sentence case for every heading, with no trailing period. One h1 per page, and no skipped levels.
- Start a task heading with a verb, such as "Add a pane". Make a concept heading a noun phrase.
- Use the serial comma and straight quotes. Don't use em dashes. Prefer a full stop to a semicolon
  or parentheses.
- Use code font for code, paths, commands, flags, and identifiers. Use bold for UI labels only.
- Make link text name the target. Never write "here" or a bare URL.
- Introduce a list with a full sentence and a colon. Number steps. Never write a one-item list.
- Spell out zero to nine. Use numerals for 10 and up, versions, and measurements.
- Write dates as "October 4, 2026".

## Split a long page

A page past 200 lines fails the length check. Split it by topic:

1. Create a folder named after the page, such as `docs/managed-agents/` for
   `docs/managed-agents.md`. Most long pages have one already. Reuse it.
2. Move each topic into its own file in that folder, named after the topic.
3. Keep `docs/<page>.md` as the landing page, with a summary and a list of its topic pages. Source
   comments and outside links cite the landing page's path, so it stays put.
4. For each heading that moved, leave an `<a id="old-heading-slug"></a>` anchor on the landing page
   next to the link to its new home. Old links then still land somewhere useful.
5. Update the source comments and doc links that cited the moved section, so they name the topic
   page. `git grep -n "docs/<page>.md § "` finds the comments.
6. Add every new file to [docs/README.md](./README.md).

Don't split by length alone. Each file holds one topic a reader would look for by name. A page that
runs long because it lists things, like `docs/README.md`, is the one exception the check allows.

## Cite a doc from code

A source comment cites a doc as `docs/<page>.md § Heading`:

```ts
// Drafts live on the device, keyed by task.
// See docs/state-ownership/scope-rules.md § The scope table.
```

Follow these rules, because `tools/arch/docCitations.test.ts` checks every citation:

- The file must exist. Cite the topic page that owns the claim, not its landing page.
- The text after `§` must start with a heading or an `<a id>` anchor in that file. The check
  compares slugs, so case and punctuation don't matter, and the comment can carry on after the
  heading.
- Keep `§` on the same line as the path. The check joins up to three wrapped comment lines after it,
  but a `§` that starts the next line reads as no section at all.
- When you rename a heading, update every comment that cites it, or leave an anchor with the old
  slug.

`tools/arch/docCitations.allowlist.txt` held the citations that were broken when the check landed.
It's empty. Fix a broken citation instead of adding it there.

## Cite a path from a doc

`tools/arch/docPaths.test.ts` reads every page under `docs/`, plus `README.md` and `AGENTS.md`. It
checks three things:

- A path in backticks that starts with `apps/`, `packages/`, `plugins/`, `tools/`, `scripts/`,
  `docs/`, or `.github/` must exist. A path with no file extension is skipped.
- A relative link between docs must resolve.
- A `#fragment` on a doc link must name a heading or an explicit anchor in the target.

Write a doc path in full from the repo root, as `docs/plugins/ui-tiers.md`. Without the `docs/`
prefix, it reads as a path in the `plugins/` workspace and fails.

To name a file that's gone, put a marker on the same line: "deleted", "replaced", "moved to",
"git history", or "git log". The markers are case-sensitive, so "Deleted" at the start of a sentence
doesn't count.

## Check your work

Run these before you hand off a doc change:

1. `git add` any new file. Both checks read tracked files only.
2. Run `pnpm --filter @acorn/arch-tests test`. It runs the path, citation, and length checks.
3. Run `pnpm lint` if you edited source comments.

The length check skips `docs/future/`, `docs/testing/`, and the dated security reviews. Its failure
message lists each page over 200 lines.

Vitest hides `console.info` from passing tests when it detects an agent, so the citation counts don't
print. To see them, run `env -u CLAUDECODE -u AI_AGENT npx vitest run docCitations` in `tools/arch`.

## Why

Source comments cite the docs about 3,000 times. Before the citation check existed, a renamed page or
a moved section broke those comments silently. On October 3, 2026, 64 comments named a doc file that
no longer existed, and 420 named a section that didn't. The 200-line limit keeps each page to one
topic, so a citation lands on the text it means.
