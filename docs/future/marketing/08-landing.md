# Phase 8: build the landing page

Date: October 15, 2026. Status: done. Needs phases 1, 6, and 7.

## Completion note

October 16, 2026. The landing page at `/` is written and built, in the 11 sections below, in
`apps/site/src/pages/index.astro`. The root `LICENSE` file holds the MIT text, "Copyright (c) 2026
James Macfie", and the root `package.json` says `"license": "MIT"`. The page and the footer link to
that file, and every mention of the license says MIT.

What landed:

- The page. Every claim was checked against the internal docs and the code, and links to the docs
  page that owns it. Its `meta` lists the docs it was written from, checked at `b8c018a90`.
- Five specimens in `apps/site/specimens/landing/`: `task-rows`, `agent-turn`, and `ship` for the three
  steps, `issues-pane` for the two clients, and `starter-pane`, the pane `npm create acorn-plugin`
  scaffolds, beside its manifest entry.
- `Specimen` takes `both`, which shows the desktop and terminal views side by side. `Snapshot` takes
  `instance`, which renames a scene's ids so a page can show it twice. `Feature` takes `level={3}`.
- `apps/site/src/install.ts` holds the install commands, for the landing page now and the download
  page in phase 10. The wireframe's `_landing.ts` reads them from there.
- A Playwright test that every link on the landing page goes to a page the build wrote.
- Subset JetBrains Mono files, about 20 KB each, and a preload of the regular and bold faces on
  marketing pages. [The site's design](../../site/design.md#fonts) has the command that makes them.

The acceptance checks: Lighthouse 13.5 against the production build in `astro preview` scores 99 for
performance on mobile and 100 for accessibility, the same in three runs, recorded in
[the site's design](../../site/design.md#lighthouse). axe finds nothing on the page, best-practice rules
included. The budget check passes with the snapshots: the page weighs 59.4 KB compressed, with 4.7 KB
of script. A preview build passes all 222 Playwright tests, and a production build still writes 17
pages and passes its tests. One acceptance line doesn't hold yet, which the deviations explain: most
docs pages the page links to are drafts.

### Decisions

- **The eyebrow is "Claude Code and Codex".** Four words, saying what acorn runs. It's recorded in
  [phase 1](./01-positioning.md#the-headline).
- **The primary action is Get acorn**, to `/download/`, because there's no release. A `shortcut:`
  comment marks it for phase 10.
- **The install block is in the hero too**, under the line that names the clients, so section 10
  repeats it, as the outline says.
- **The tour's scenes.** Tasks shows the command palette over a task, Agents the hero scene, Review the
  pull request, Desktop and terminal the 80 by 24 terminal, Task tools the Database pane, Plugins a
  plugin's permissions, Nodes Fleet home, and the last tab the browser extension. The page shows
  `hero` and `fleet` twice, and the second copy of each takes an `instance`. Each tab links to its
  feature page. The last tab links to the browser extension's page, because one tab gets one link.
- **New specimens for the steps.** The seed specimens are named for kit components, such as "Alert
  in each tone", which say nothing beside "Run agents in it". The new ones draw the fixture's tasks,
  an agent's steps, and a reviewed pull request with **Squash and merge** and **Archive task**, labels
  the app uses.

### Deviations

- **Links to draft docs pages.** "Every docs page it links to exists and isn't a draft" can't hold until
  phases 11 to 18 publish those pages. The links point where the docs will be, and the link test runs
  on preview builds only, behind a `shortcut:` comment. In a production build those links 404 until then.
- **The fonts are subsets**, not the full files phase 6 chose. On Lighthouse's simulated phone
  connection the two 90 KB faces held up the first paint. The landing page scored 90, and a page with
  almost no content scored 95. Inlining the stylesheets helped less than the fonts did, so the build
  doesn't inline them. The subsets keep the box-drawing, block, and shape ranges the terminal pictures
  need, and drop the programming ligatures, which the app doesn't draw.
- **The specimens avoid three kit bugs** that phase 3 recorded: the split handle's missing value
  attributes, muted row meta on a selected row, and a `Timeline` that puts cards straight into an `ol`.
  Lighthouse can't leave a specimen out the way the gallery tests do, so `issues-pane` is a table,
  `agent-turn` is cards in a stack, and no row is selected.
- **Two FAQ facts in [voice](./voice.md#the-faq) were wider than the code**, and both are corrected
  there. "acorn sends nothing anywhere" isn't true once you connect GitHub. "A harness never spends a
  key acorn holds" is documented for a harness generate, not for agent sessions. The security card
  says acorn never puts your GitHub token or API keys in an agent's environment, rather than that
  agents never see your credentials, because on a standalone Node agents run as the Node's user and
  can read its key file (`docs/node-distribution.md`).
- **The standalone Node's commands include `node scripts/prune-runtime.mjs`**, which the wireframe's
  copy left out and `docs/node-distribution.md` lists.
- **The manifest entry includes `glyph` and `order`**, as the scaffold writes it.

### What later phases need to know

- Phase 9: the tour links to `/features/tasks/`, `agents`, `review`, `desktop-and-terminal`,
  `task-tools`, `plugins`, `nodes`, and `browser`.
- Phase 10: make the hero's primary action **Download** once a release exists. The download page can
  import `installMethods` from `apps/site/src/install.ts`. The landing page's standalone tab assumes the
  reader has the tarball, so the download page has to say where it comes from.
- Phases 11 to 18: the landing page links to these docs pages, all drafts on this commit: `using/tasks-and-worktrees`,
  `using/archive-and-restore`, `agents/agent-sessions`, `agents/model-providers-and-generating-text`,
  `start/install`, `start/concepts`, `start/desktop-and-terminal`, `automation/the-command-line`,
  `browser-extension/set-up-the-extension`, `nodes`, `nodes/run-a-standalone-node`,
  `nodes/pair-a-device-or-a-remote-node`, the four `security/` pages, six `build-plugins/` guides, and
  `build-plugins/start/have-your-agent-build-it`. Once they're published, remove the skip from the link
  test in `apps/site/tests/site.spec.ts`.
- Phase 18: the three kit bugs above still fail axe.
- A character the site writes outside the font subset falls back to the next mono face. Add its range
  with the command in [the site's design](../../site/design.md#fonts).
- The design lab's landing page at `/lab/design/landing/` keeps the wireframe's draft copy.
- Nothing here needs a deploy, so nothing is left for phase 20.

## Goal

The page at `/` tells a developer what acorn is in five seconds, shows it in thirty, and gets it onto
their machine in three minutes. Every claim on it is something the reader can check: a picture, a
number, or a link to the docs page that explains it.

## Starting point

- [Phase 1](./01-positioning.md#decisions) chose the headline, the paragraph under it, the feature
  ranking, and the order of sections. The headline is "A workspace for working with coding agents,
  one task at a time." This phase writes the eyebrow and records it in phase 1.
- The license is MIT ([owner decision 1](./README.md#what-the-owner-decides)), and the repository has
  no `LICENSE` file.
- Phase 6 built the components. Phase 7 captured the snapshots.
- [Voice](./voice.md) has the rules, the words to avoid, and the FAQ facts.
- [Research](./research.md) has the patterns this page takes: herdr's hero and product picture, hunk's
  install tabs, orca's tabbed tour, paseo's explanation of a daemon with many clients, gh-dash's config
  beside its result, and opencode's privacy section.

## The page from top to bottom

Phase 1 kept this outline as written. Write each section's copy to [voice](./voice.md), with every claim
linked to the docs page that owns it.

1. **Hero.** The eyebrow, the headline, and the paragraph. A primary action: **Download** when a release
   exists, **Get acorn** pointing at `/download/` when it doesn't. A secondary action, **Read the docs**.
   One line under the actions names the clients: the desktop app for macOS and Windows, the terminal
   client, the command line, and the browser extension.
2. **The picture.** The hero snapshot, full width, with **Desktop** and **Terminal** tabs. Caption: the
   same task in both clients. There's one scene. James decided against the clickable hero from
   [phase 7](./07-shell-snapshots.md#5-optional-make-the-hero-clickable).
3. **How it works, in three steps.** Each step is a heading, two sentences, and a small specimen:
   - Open a task. It gets a branch, and a worktree the first time it needs files.
   - Run agents in it. Claude Code and Codex sessions with approvals, queued turns, and delegation.
   - Review and ship. The diff, the pull request, and merge, then archive the task and acorn cleans up.
4. **The tour.** A tabbed panel, one tab per feature group in phase 1's ranking. Each tab has one
   snapshot, one paragraph, and a link to its feature page.
5. **Two clients, one workspace.** A plugin pane as a specimen on both hosts, side by side, with the
   point stated plainly: the desktop app and the terminal client draw the same components, so a plugin
   written once works in both.
6. **Add what's missing.** A plugin manifest entry beside the pane it draws. A short list of what a
   plugin can add, each linked to its guide. One line on asking your agent to write the plugin, since
   acorn's agents can read the plugin vocabulary from your Node.
7. **Your machine, your keys.** Four facts, each linked: agents get a token scoped to their task and
   never see your credentials; credentials are encrypted at rest and left out of backups; installed
   plugins run sandboxed and get only the permissions you accept on each device; telemetry is off by
   default.
8. **Run it anywhere.** One paragraph: the desktop app runs a Node on your machine, and you can pair
   others, including a standalone Node on a server, and use them from any client. A small snapshot of
   Fleet home.
9. **FAQ.** The questions in [voice](./voice.md#the-faq), answered in two or three sentences each, in
   `<details>` elements so they work with no script. "What does it cost?" answers that acorn is free
   and open source under the MIT license, and links to the `LICENSE` file on GitHub.
10. **Install again.** The install block repeated, with **Read the docs** beside it.
11. **Footer.**

## Build notes

- Add a root `LICENSE` file with the standard MIT text, "Copyright (c) 2026 James Macfie". Add
  `"license": "MIT"` to the root `package.json`. Do this before writing any copy that says "open
  source".
- The page ships the scripts for the tabs, the copy buttons, and the appearance picker. Nothing else. With scripting off, every tab's panel shows in order and the copy buttons
  hide.
- Tabs follow the WAI-ARIA tabs pattern, with arrow keys moving between tabs.
- The headline is real text, never an image. The snapshot is HTML, so its text is searchable and
  readable by a screen reader. Give the snapshot frame an accessible name and keep the caption short.
- No social proof that isn't true. The star button follows [owner decision 4](./README.md#what-the-owner-decides).
  No logos of companies, no testimonials until there are real ones with permission to quote.

## Out of scope

Feature pages, the download page, and the docs. This page links to them.

## Acceptance

- The root `LICENSE` file exists, and every mention of the license on the page says MIT.
- Every claim on the page links to a docs page, and every docs page it links to exists and isn't a
  draft.
- Lighthouse, run against the production build served locally with `astro preview`, reports
  performance of at least 98 on mobile and 100 for accessibility. Record the numbers and the date in the
  site's internal page.
- The page passes the budget check with the snapshot included.
- The voice review checklist passes. James reviews the copy at the end of the run.
