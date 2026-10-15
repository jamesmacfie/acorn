# Phase 13: document every built-in plugin

Date: October 15, 2026. Status: done. Needs phases 2 and 4. Follows the page rules in
[phase 11](./11-docs-start-and-core.md#how-every-docs-page-is-written).

## Completion note

October 16, 2026. The Built-in plugins overview and 19 plugin pages are written, published, and marked
checked, and `/plugins/` lists every plugin acorn ships. Both checks the phase asked for land with them.

What landed:

- The pages, in `apps/site/src/content/docs/docs/built-in-plugins/`, all `.mdx`, in the shape this
  doc gives. The docs home's **Use acorn** card links to the overview.
- `apps/site/src/data/plugins.ts`, one entry per plugin: name, sentence, Lucide icon, compiled or
  package, whether it's required, which clients draw it, its docs page, and, for an installed package,
  a reason for each permission. `/plugins/` and the overview both read it.
- `PluginFacts.astro`, the facts box. **Ships as** and **Works in** come from the data module. For an
  installed package, **Can reach** is generated from the manifest through `permissionKeys` in
  `apps/site/src/lib/pluginPermissions.ts`, and the build fails on a grant with no reason.
- `apps/site/scripts/pluginPages.test.mjs`. It reads the desktop, terminal client, and Node activation
  lists and `BUNDLED_PLUGINS`, and fails on a shipped plugin with no entry or no docs page, an entry
  nothing ships, a wrong compiled-or-package claim, a permission with no reason, and a reason for a
  permission nobody asks for. Fixture cases prove each failure, and a planted gap against the real
  rosters failed as expected.
- `/plugins/`, a card per plugin with its icon, sentence, **Ships as**, and **Works in**, and a short
  section on building your own. `lucide-static` is a site dependency for the icons, at the version
  client-core already pins.
- Three shell snapshot scenes, `notes`, `editor`, and `context`, captured on the fixture. Playwright
  tests check every link on `/plugins/` on both builds and run axe on `/plugins/` and the Database page.
- `docs/site/built-in-plugins.md` describes the data module and the test. `docs/site.md`,
  `docs/plugins/adding-a-contribution.md`, `docs/site/snapshots.md`, and `docs/README.md` point at it.

The acceptance checks: a production build and a preview build both pass the site's tests, 31 script
tests with 112 and 259 Playwright tests, and the link validator finds every internal link and anchor
valid. `astro check` finds no errors. In a `dev:agent` session, the setup steps for Database (with a
throwaway PostgreSQL behind **Connection URL command**), HTTP, Editor, and Terminal were walked, and
**Settings** > **Plugins** > **Installed** was read for the plugin names and the **Enabled** switch.

### Decisions

- **Permission keys follow the manifest's own fields**, such as `node.net:api.linear.app`, and the
  page shows them as code beside the reason. Showing the trust prompt's own sentences would mean
  importing client-core's `permissions.ts`, which isn't a package export and doesn't load in plain Node,
  where the test runs.
- **Onboarding has an entry and no page.** Its docs link is Install's first-run section, so it's on
  `/plugins/` and the overview and the test still covers it.
- **Pictures where the fixture can draw one.** Database, Git, GitHub, Agents, Terminal, and Workflows
  reuse existing scenes, and Notes, Editor, and Context get new ones. Linear, Rollbar, and Docker need a
  service the fixture fakes nothing for, Preview is a native webview the capture draws as a box, and
  Agent browser, Agent cost, Memory, Model providers, and Sentry telemetry have no pane worth a window.
  Those pages have no picture.
- **The Workflows page links no Automation page**, and `/plugins/`' build-your-own section links
  `/features/plugins/`, because those docs are still drafts and a production build fails on a link to
  a draft.

### Deviations

- **Context and Onboarding aren't on Settings > Plugins > Installed**, because they have no Node half,
  so neither can be turned off. `docs/plugins/activation.md` says every plugin but the four required
  ones can be. The overview and the Context page say what the app does.
- **The Database pane has no paging.** `docs/database/pane.md` lists paged rows, and the route takes an
  offset, but the pane always asks for the first 500 rows of a table. The page says so.
- **A loaded pane's availability isn't read again in a hidden window.** The `dev:agent` window counts
  as hidden, so the Database pane appeared only after faking visibility, as `shellPage.js` does. A
  visible window reads it every two minutes and on focus, and the page says the button can take that
  long to appear.
- **Rollbar only reads, and Linear writes only comments.** The permission reasons say so, rather than
  "reads and updates".

These need fixing in the internal docs by their owners.

### What later phases need to know

- Phase 14: link the Workflows plugin page to the Automation pages once they publish, and the Docker
  and Terminal pages' run target mentions to the command line and configuration reference.
- Phase 15: point `/plugins/`' **Build your own** link at How plugins work once it publishes. Its
  Permissions reference can link each built-in page's facts box as a worked example.
- A new built-in plugin, or a new permission on an installed package, needs its entry and reason in
  `apps/site/src/data/plugins.ts`, or the site's tests fail.
- Linear, Rollbar, GitHub, and Sentry setup steps follow the code and the connection forms. Nobody
  walked them against a real account. Phase 20's review should.
- The architecture checks fail on this base as earlier phases recorded, with nothing from this change.
  `docs/site.md` sits at the 200-line limit.
- Nothing here needs a deploy, so nothing is left for phase 20.

## Goal

Every plugin acorn ships has a page that says what it adds, what it needs from you, how to set it up,
how to use it, what it can reach, and how it behaves in the terminal. `/plugins/` lists them all. A
reader who wants to know "can acorn talk to my Postgres database, and how" finds the answer on one
page.

## Starting point

- 13 compiled plugins ship in the app: agents, browser, context, docker, editor, git, github, memory,
  notes, onboarding, preview, terminal, and workflows.
- Seven loaded plugins ship as installed packages: agent-cost, database, http, linear, model-providers,
  rollbar, and sentry-telemetry. `BUNDLED_PLUGINS` in `apps/desktop/scripts/build-bundled-plugins.mjs`
  is the list.
- Each loaded plugin's `acorn-plugin.config.mjs`, such as `plugins/database/acorn-plugin.config.mjs`,
  declares its manifest and explains each permission it asks for in comments.
- `docs/first-party-plugins/terminal.md` says what each plugin loses in the terminal client.
- The onboarding plugin is the first-run wizard. The Install page in phase 11 covers it, so it gets no
  page here.

## The page shape

Every plugin page has the same parts, in this order:

1. **One sentence** on what the plugin adds.
2. **A picture**: its pane, rail source, or settings page, as a specimen or snapshot.
3. **The facts box**, a short table:

   | Fact | Example, for Database |
   | --- | --- |
   | Adds | The **Database** pane, palette commands, two workflow steps, and a command-line command. |
   | Ships as | An installed package, on by default. |
   | Works in | Desktop and terminal. |
   | Needs | A PostgreSQL connection URL, from the project's `.env` or a script. For generating SQL: an API key or an agent command line. |
   | Can reach | The permissions its manifest asks for, each with what it's for. Generated, for installed packages. |

4. **Set it up**: numbered steps from nothing to working, with a checkpoint.
5. **Use it**: one task section per thing a person does with it.
6. **From the command palette**: its commands.
7. **For agents**: the agent tools and context sections it adds, if any.
8. **In workflows**: its step kinds, if any.
9. **Settings**: what it adds to Settings, linked to the settings reference.
10. **In the terminal**: what's the same and what's missing.
11. **Limits.**

For the installed packages, generate the **Can reach** rows from each plugin's manifest at build, so the
page can't claim a permission the plugin doesn't ask for. Pair each permission with a one-line reason,
written by hand from the comments in its `acorn-plugin.config.mjs`. A test fails when a manifest asks
for a permission that has no reason on the page.

## The pages

| Plugin | What the page has to explain well |
| --- | --- |
| Agents | Managed sessions and Agent Center. Links to the Agents section in phase 12 rather than repeating it. |
| Agent browser | The browser agents drive for themselves, which has no pane, and what it can reach. |
| Agent cost | What it measures, from which providers, and where it shows. |
| Context | Choosing, sizing, and sending task context. |
| Database | Connecting through a URL or a script, the task-scoped connection, the schema, paging rows, editing primary-key values, running SQL, saved queries per project, generating SQL with a model, the two workflow steps, and `acorn plugin database query`. This is the page the owner named as an example, so make it complete. |
| Docker | How containers are matched to a task, logs, stats, exec, lifecycle actions, the trust check on executable configuration, and teardown on archive. |
| Editor | Files, editing, saving and recovery, find in files, navigation, file renderers, and line annotations from other plugins. |
| Git | The Changes tab: staging, the commit editor, push and pull. History, revision diffs, stashes, worktrees, merge, rebase, cherry-pick, revert, conflicts, and **Explain commit**. |
| GitHub | Connecting with device sign-in, repositories, pull requests, review threads, checks and Actions logs, merge, creating a pull request, and starting a task from one. |
| HTTP | Requests, variables, auth helpers, encryption at rest, sending only from an interactive device, and the workflow step. |
| Linear | Connecting, the pane, the reference panel beside a pull request, and starting a task from an issue. |
| Memory | What agents write and how you review it. Links to phase 11's Memory page. |
| Model providers | Adding an OpenAI or Anthropic key, and what uses it. Links to phase 12. |
| Notes | Task, workspace, and global notes. |
| Preview | The hardened preview pane, what it loads, and why a remote Node's preview is refused. |
| Rollbar | Connecting, the pane, and starting a task from an item. |
| Sentry telemetry | Sending acorn's own telemetry to your Sentry project, and what's sent. |
| Terminal | The drawer, shells, run targets, raw provider sessions, tmux reconciliation, and replay. |
| Workflows | The pane and the run view. Links to the Automation section in phase 14. |

Write the overview page, "Built-in plugins", as a table of every plugin with its one sentence and its
**Works in** fact, and one paragraph on turning a plugin off per Node.

## The `/plugins/` page

A marketing page with a card per plugin: icon, name, one sentence, **Ships as**, and **Works in**, each
linking to its docs page. Read the list from one data module, `apps/site/src/data/plugins.ts` (new),
which the docs overview also reads. Under the cards: a short section on building your own, linking to
the Build plugins docs.

Add a test that fails when a plugin in the compiled roster or in `BUNDLED_PLUGINS` has no entry in the
data module or no docs page, so a new built-in plugin can't ship undocumented.

## Out of scope

Plugins that aren't bundled, such as nodes-file and the consumer plugins that moved to their own
repositories. The site lists what acorn ships.

## Acceptance

- Every plugin in the table has a page out of draft, cleared in phase 4's report.
- Each page's setup steps work on a clean `dev:agent` session.
- The permissions test and the roster coverage test pass, and each fails on a planted gap.
- `/plugins/` lists every bundled plugin.
