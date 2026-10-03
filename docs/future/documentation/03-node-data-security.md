> **Completed 2026-10-03** by the "Phase 3 Node, data, and security" task.
>
> **What landed:** All 13 docs were checked against the code, restyled, and cut to 200 lines or fewer.
> `api-reference`, `security`, `data-layer`, `state-ownership`, `telemetry`, `schedules`, and `cli` are
> landing pages over 41 topic pages in folders of the same names, with old-heading `<a id>` anchors on
> each landing page. `caching`, `authentication`, `node-enrollment`, `node-distribution`, and `mcp`
> stayed single pages. About 440 source comments cite the new pages, every source section citation of
> these docs resolves to a real heading, and the citation allowlist shrank from 412 to 354 lines.
>
> **Deviations:** (1) More pages than planned. The API reference has five, not four:
> `workflow-routes.md` splits off from plugin routes to stay under 200 lines. Telemetry has seven, not
> four: `renderer.md`, `logging.md`, and `surface-health.md` split off for the same reason. (2) The plugin
> security owner is `docs/security/node-plugin-security.md`, rewritten as a landing page over six
> `security/plugin-*.md` topic pages, because this phase doc links to that path and I couldn't edit its
> body. (3) The Postgres pane section left `data-layer.md` and is linked from
> `data-layer/plugin-databases.md` § The database plugin, which keeps the URL resolution order and the
> generation caps. Database pane source comments now cite `docs/database.md`. (4) "Not built yet" from
> `schedules.md` moved to `docs/future/schedules.md`, which I added to the future README. (5) Code won
> over the docs in these places: the broker deadline has three `timeoutMs` callers, and workflow
> generation asks for 240 seconds, not 150; core has 18 audit verbs, not 17; there are nine migration
> chains, not 11, and `database` is a second loaded plugin with a chain; `agent-run` is not reserved
> anywhere in code; the terminal plugin worker uses an allowlist from the shared builtin policy, not a
> hand-written denylist; the API reference was missing about 30 routes, including plugin
> install/update/review/uninstall, `/v1/core/runs`, `/v1/core/data-sources`, and most agents routes,
> and listed a deleted `/v1/core/tasks/:id/mcp`. (6) `docs/README.md` is 209 lines, because it lists
> every new page.
>
> **For later phases:** The scripts I used aren't committed. The approach:
> list registered routes with `createApp().routes` in a throwaway node-core test, and read
> `apps/node/test/integration/routeRegistry.snapshot.json` for compiled plugin routes. Loaded plugin
> routes (database, http, linear, rollbar, preview, browser) aren't in that golden list, so grep their
> `src/node` and `src/server`. When a heading moves, rewriting a citation from the landing page to its topic page on the
> citation line is safe only if the topic page keeps the heading text, so keep heading text when you
> split. `docs/security.md` anchors cover old plugin-security headings, so a comment citing them passes,
> but cite the topic page in new comments. Phase 5 owns `database.md`, which should absorb the
> generation caps from `data-layer/plugin-databases.md`. `integrations.md` and `testing/workflows.md` cite a
> workflows heading that no longer exists, "Generating one from a description". Generation lives in
> `docs/workflows/authoring.md` § Generating and editing with AI. I ran `pnpm lint` and the arch suite,
> not the package test suites, because the source changes are comments only, plus one test title.

# Phase 3: Node, data, and security

Date: October 3, 2026. Status: proposed, not started. Part of the
[documentation overhaul](./README.md). Do [phase 1](./01-guardrails.md) first.

These pages describe the Node service: its routes, storage, auth, security model, telemetry, and the
headless CLI. Source cites them heavily, so phase 1's citation check matters most here.

## Docs in this phase

| Doc | Lines | Source citations |
| --- | --- | --- |
| [api-reference.md](../../api-reference.md) | 821 | 85 |
| [data-layer.md](../../data-layer.md) | 519 | 92 |
| [state-ownership.md](../../state-ownership.md) | 372 | 14 |
| [caching.md](../../caching.md) | 232 | 34 |
| [authentication.md](../../authentication.md) | 163 | 5 |
| [security.md](../../security.md) | 904 | 156 |
| [security/node-plugin-security.md](../../security/node-plugin-security.md) | 553 | 0 |
| [node-enrollment.md](../../node-enrollment.md) | 185 | 22 |
| [node-distribution.md](../../node-distribution.md) | 229 | 33 |
| [telemetry.md](../../telemetry.md) | 860 | 116 |
| [schedules.md](../../schedules.md) | 373 | 55 |
| [cli.md](../../cli.md) | 332 | 1 |
| [mcp.md](../../mcp.md) | 197 | 47 |

`security/review-2026-10-01.md` is dated evidence. Fix its links only.

## Known problems

### api-reference.md

"Plugin routes" runs 295 lines and "WebSocket" runs 156. Split it into a `docs/api-reference/`
folder: transport, pairing, and versioning in one page, then core routes, plugin routes, and
WebSocket in their own pages. Check every route against the Hono route registrations in
`packages/node-core` and the plugin `server` folders. Routes are the claims most likely to have
drifted.

### security.md

Only `plugins.md`, `ui-design.md`, and `tui.md` are cited more often. "Third-party plugin bundles"
runs 256 lines and duplicates
[security/node-plugin-security.md](../../security/node-plugin-security.md). "Node-half plugin
security" is a six-line pointer. Make one owner for plugin security, then split the rest by trust
boundary: transport and auth, credentials, process and path controls, the control plane, the
renderer, webviews, and audit.

`security/node-plugin-security.md` came out of an earlier split as a single 553-line section. Split
it again by topic.

### data-layer.md

"Database plugin: the Postgres pane" belongs to [database.md](../../database.md). Move it there in
phase 5, or link to it now. "Runs: a merged read, and the trigger for ever making it a table" is
design reasoning. Keep the rule and drop the story.

### state-ownership.md

"Scope rules" runs 224 lines. Split it into its own page. Fifteen source comments cite
a deleted `docs/state.md`. Phase 1 points them here or at the right section.

### telemetry.md

At 860 lines, this mixes the contract, the plugin API, the sink API, per-runtime detail, and a
diagnosis guide. "The renderer" alone runs 204 lines. A split:

| New page | Takes |
| --- | --- |
| `docs/telemetry/model.md` (new) | The switch, the five kinds, span admission, attributes, privacy, and traces |
| `docs/telemetry/plugins-and-sinks.md` (new) | Writing telemetry from a plugin, writing a sink, the first sink |
| `docs/telemetry/runtimes.md` (new) | Node seams, the renderer, the terminal client, the shell, and other runtimes |
| `docs/telemetry/diagnosis.md` (new) | Diagnosing an unresponsive view, and what the page shows |

### schedules.md

"Not built yet" and "What deliberately is not a schedule" are proposals and refusals. Move proposals
to `docs/future/`. Keep a short "Limits" section.

### cli.md

Check every command and flag against the CLI's argument parser and its output schemas. The doc is
cited once from source, so splitting it is cheap.

## Done means

- Each doc in the table follows the [house style](./style.md) and is 200 lines or shorter.
- Plugin security has one owning page.
- Every route in the API reference matches a registered route.

## Verify before you start

- List the registered routes from source and diff them against the API reference.
- Re-count citations of `docs/security.md` and `docs/telemetry.md` sections with phase 1's check.
- Read `docs/security/review-2026-10-01.md` for remediations that changed behavior.
