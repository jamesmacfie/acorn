# Phase 14: write the Nodes, browser extension, automation, and reference docs

Date: October 15, 2026. Status: done. Needs phases 2 and 4. Follows the page rules in
[phase 11](./11-docs-start-and-core.md#how-every-docs-page-is-written).

## Completion note

October 16, 2026. All 28 pages are written, published, and marked checked: six Nodes and devices pages,
eight browser extension pages, eight Automation pages, and six Reference pages. The docs home's **Use
acorn** card links to each section. Every label was read from the code or seen in a `dev:agent` session,
and every behavior was checked against the page's sources, and against the code where a doc was thin.

What landed:

- The pages, in `apps/site/src/content/docs/docs/nodes/`, `browser-extension/`, `automation/`, and
  `reference/`.
- Two `Graph` diagrams: `device-and-nodes` for Nodes, and `workflow-run` for Workflows.
- The extension's panel as a third picture host. `apps/extension/src/sidebar/pictures.test.tsx`
  mounts the real sidebar under jsdom against a scripted Node and commits four scenes to
  `apps/site/src/generated/sidebar/`: pairing, Home, a conversation, and the handoff card.
  `SidebarPicture.astro` draws them, styled by the panel's own sheet through the specimen
  stylesheet. `pnpm --filter @acorn/site specimens` runs it, and so does the extension's suite.
- Generated references, each with a check:
  - **Command line reference.** `apps/site/scripts/cliHelp.mjs` runs the built `acorn` with `--help`
    for each command. The site's `build` and `dev` build `@acorn/cli` first.
  - **Keyboard shortcuts reference.** `apps/site/scripts/keybindings.mjs` reads every default chord
    from the code that registers it, and the bundled packages' manifest keybindings.
    `keybindings.test.mjs` fails on a registration it can't describe.
  - **Configuration files.** The device config fields come from `.describe()` on
    `deviceConfigSchema`, with a test that every field has one. The workflow file fields come from
    `WORKFLOW_FILE_TABLES` in `plugins/workflows/src/contract/workflowFile.ts`, held to the TOML
    writer and loader by `workflowFile.test.ts`.
  - **Environment variables.** `apps/site/scripts/envVars.mjs` scans the Node, the command line, the
    terminal client, and custody for `ACORN_*` names. `envVars.test.mjs` fails on one the page
    doesn't list or `INTERNAL` doesn't excuse, and on a fixture that reads an undocumented one.
  - **JSON Schemas.** `apps/site/src/pages/schemas/[...file].ts` serves the four schemas at their
    `$id`, the command line's under `/schemas/cli/`. A Playwright test checks each.
- `docs/site/references.md` (new) describes the generated pages. `docs/site/specimens.md` describes
  the sidebar host.
- Links later phases asked for: Concepts, Install, and the quick start link the Nodes, pairing,
  standalone Node, and extension pages. Keyboard shortcuts keeps five common chords and links the
  reference. Project configuration, Docker, and Terminal link the configuration reference. The
  Workflows plugin page links the Automation pages. Agent sessions links the browser and command line
  pages. Settings > Machines and Automation link pairing and schedules.

The acceptance checks: a production build and a preview build both pass the site's tests, 36 script
tests with 144 and 263 Playwright tests. `astro check` finds no errors, and the specimen comparison
passes on all three hosts. In a `dev:agent` session, a desktop app paired with a standalone Node from
**Add a node**, through the six identity words, to **Live**, and showed **Fleet**. The command line
paired with the same Node in a pseudo-terminal. A backup of a standalone Node was restored into a
fresh data folder by the page's steps, and its project came back. Every example workflow file on the
pages loads through the real loader. The browser extension pages weren't walked in a real browser.

### Decisions

- **The keyboard reference reads chords from source text.** Defaults are registered in about 30
  places, mostly when a component mounts, so there's no table to export. The script reads each
  registration's literal fields, and `OVERRIDES` supplies words for the 15 whose text is computed. A
  test fails on any registration it can't describe, so a new chord can't go missing quietly. It runs
  as its own process, because Vite's config runner can't import the manifest configs, and a bundled
  page can't find the repository's files.
- **The terminal client's table lists only its own keys.** Every other shortcut works there with Ctrl
  for ⌘, as the Keyboard shortcuts page already says.
- **Sidebar pictures follow the specimen pattern**: committed, compared byte for byte, and
  regenerated with `UPDATE_SPECIMENS=1`, rather than recaptured like shell snapshots.
- **The workflow field reference lives in the plugin's `contract/`**, beside nothing else that would
  drift, and its test sits beside the writer, because the architecture rules keep tests out of
  `contract/`.

### Deviations

- **The sidebar's composer has no capture buttons.** They were removed on October 14, 2026, but
  `docs/browser-extension/page-capture.md` and `setup.md` still describe three. Text comes in through
  **Add to Acorn chat**, a page link through the chip's **New chat about this page**, and a screenshot
  only with **Ask Acorn about this element**. The pages describe the code. `setup.md` also lists an
  **Agents** section on Home, which is a tab in the bottom bar.
- **Every workflow input needs `schema_json`.** The loader refuses an input without one, so a plain
  `default` is never used. The field reference says so.
- **The Workflows list's button is New**, not **New workflow**, which is the palette's name. The
  Workflows plugin page said otherwise and is fixed.
- **A backup leaves out notes and memory**, which are Markdown files outside the databases.
  `docs/data-layer/backup-and-retention.md` doesn't say so. The page tells you to copy them.
- **The desktop app's Node keeps memory in `~/.acorn/memory`**, outside its data folder, because the
  helper doesn't set `ACORN_DATA_DIR`.
- **`.acorn/config.toml` has a `[docker]` table** that `docs/workspaces-and-tasks/project-config.md`
  doesn't list. The configuration reference does.
- **The app has no button that makes a saved query.** It picks and edits them. The page says so.
- **No plugin acorn ships has a browser panel.** The page says a plugin you install can add one.
- **Dashboards has no picture.** Panels are host components, not plugin trees, so the specimen
  generator can't draw them, and no shell snapshot scene places panels yet.
- **`acorn browser --help` says "acorn install"** where it means `acorn browser install`. The command
  line reference prints it as the binary does.

These need fixing in the internal docs or the code by their owners.

### What later phases need to know

- A new default shortcut whose description, category, or scope isn't a literal needs an entry in
  `OVERRIDES` in `apps/site/scripts/keybindings.mjs`, or the site's tests fail.
- A new `ACORN_*` variable needs a row on Environment variables or an entry in `INTERNAL` in
  `apps/site/scripts/envVars.mjs`.
- A new key in the workflow TOML writer needs a row in `WORKFLOW_FILE_TABLES`, and a new device config
  field needs a `.describe()`.
- A change to the extension's sidebar can fail `pictures.test.tsx`. Regenerate with
  `UPDATE_SPECIMENS=1 pnpm --filter @acorn/site specimens` and look at the pictures.
- Phase 15: the Glossary links "compiled plugin, loaded plugin" and "kit, component" to
  `/features/plugins/`. Point them at How plugins work and One kit, two hosts once those publish.
- Phase 17: Show a panel in the browser sidebar can link Workflows and plugin panels.
- Phase 20: walk the extension pages in Chrome and Firefox, and add a dashboard scene to the shell
  snapshots so Dashboards gets a picture.
- The architecture checks fail on this base as earlier phases recorded, with nothing from this change.
  Three files outside this change fail `oxfmt --check`. `docs/site.md` sits at the 200-line limit.
- Nothing here needs a deploy, so nothing is left for phase 20 beyond the review above.

## Goal

A developer can run acorn on another machine, connect the browser extension, automate work with
workflows and schedules, script acorn from the command line, and look up any shortcut, file, or
environment variable. These are the docs for people who've used acorn for a week and want more from it.

## Nodes and devices

| Page | What it must cover |
| --- | --- |
| Nodes | What a Node owns and what a client owns, in a picture. The Node the desktop app runs for you. Why there's no shared database between Nodes. |
| Pair a device or a remote Node | Advertising a Node, pairing from the desktop app, the terminal client, and the command line, comparing the six identity words, and what a device token can do. |
| Run a standalone Node | The tarball, its environment variables, `acorn node start --background`, `status`, and `stop`, running it as a service, and which plugins it has. |
| The fleet view | Fleet home, Node labels, attention and search across Nodes, and offline and partial states. |
| Where your data lives | The data folder, `node.json`, what each database holds, and what's on your device instead. |
| Back up and restore | Making a backup, what it leaves out and why, and restoring into a fresh data folder. |

## Browser extension

| Page | What it must cover |
| --- | --- |
| Set up the extension | Installing the bridge with `acorn browser install`, loading the extension in Chrome or Firefox, pairing, the permissions the browser asks for and why, and every sidebar state with its next step. |
| Talk to an agent from the browser | Opening a task's conversation, sending, and retries. |
| Send pages, selections, and screenshots | Each capture, page access, and where the attachment lands. |
| Ask about an element | The element picker and what it sends. |
| Task chips and handoffs | The chip a plugin draws on a site, the handoff card, and creating a linked task. Matching a page to its task, and Home's **This page** section. |
| Project sites | Tying web addresses to a project, and overrides. |
| Workflows and plugin panels | Starting a workflow from the sidebar, and a plugin's read-only panel. |
| Waiting requests and notifications | The toolbar badge, the waiting list, and operating system notifications. |

Pictures for these pages come from the extension's own sidebar markup. Its tests already mount the
sidebar under jsdom, so add the sidebar to phase 3's pipeline as a third host, using the extension's
built stylesheet.

## Automation

| Page | What it must cover |
| --- | --- |
| Workflows | What a workflow is, a run, a step, and a gate, with a run drawn as a `Graph` specimen. |
| Write a workflow | The two homes for a definition: `.acorn/workflows/*.toml` in a repository and definitions written in the app. The editor. Generating a draft with a model. Exporting to a file. A field reference for the TOML format, generated from the workflow definition schema in the workflows plugin's contract, with a test that every field has a description. |
| Steps, gates, and budgets | Every built-in step kind with an example, typed step output and conditions, waiting on other steps, joins, budgets, polling gates, retries, and child workflows. |
| Start and schedule runs | Starting from the palette, from an item such as a pull request, from the command line, and on a schedule. |
| Schedules | Plugin schedules and your own, the 300-second floor, consent, and the run history. |
| Dashboards | Panels over data sources, the editor, placements, sampling, trends, and starter panels from plugins. Panel specimens. |
| Data sources and saved queries | What a typed source is, scope and reach, the workspace query library, and derived sources. |
| The command line | Selecting a Node, reading resources, writing workspaces, projects, and tasks, agent sessions, workflow runs, plugin commands, output formats, and exit codes. |

## Reference pages

| Page | How it's made |
| --- | --- |
| Command line reference | Every command and its options. The command line has no declarative command table. Its help text comes from `helpFor` in `apps/cli/src/args.ts`. At build, run the built command line with `--help` for each command and render the output, so the page can't disagree with the binary. The site may run another app's binary. It may not import its source. |
| Keyboard shortcuts reference | Every default chord, with what it does and where it works, generated from the default keymap and command catalog. Find the module that registers the defaults, export the table for tests if it isn't already, and render it. |
| Configuration files | `.acorn/config.toml`, `.acorn/workflows/*.toml`, and the device config file, with the field reference for each. The device config reference renders `acorn-device.schema.json`. |
| Environment variables | Every variable a person sets, such as `ACORN_DATA_DIR`, `ACORN_PORT`, `ACORN_ADVERTISE_HOST`, and `ACORN_TUI_NOTIFY`, with what each does. A test greps the Node, the command line, and the terminal client for `ACORN_*` reads and fails on any variable the page doesn't list or explicitly excludes as internal. |
| JSON Schemas | The four published schemas, with their URLs and how to point an editor at each. |
| Glossary | Every term in [voice](./voice.md#names-and-terms), defined in one or two sentences, linked to its page. |

Publish the command line's output schemas at `/schemas/cli/`, copied from `apps/cli/schemas/` at build.

## Out of scope

Writing a workflow step kind, a schedule, or a data source in a plugin. Those are plugin guides in
[phase 17](./17-plugin-guides-node-and-agents.md).

## Acceptance

- Every page above is out of draft and cleared in phase 4's report.
- The command line reference updates when a command's help text changes, with no edit to the site.
- The environment variable test passes, and fails when a fixture reads an undocumented variable.
- Someone pairs a second Node and the browser extension from these pages alone.
