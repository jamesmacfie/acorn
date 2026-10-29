# Shell snapshots

This page covers shell snapshots on the public site: the invented fixture they draw, the scenes, how
the capture drives the running apps, and how to add a scene. [The public site](../site.md#shell-snapshots)
has the command and when to run it. The landing page's phone screens aren't snapshots
([the phone pictures](./snapshots/phone-pictures.md)).

A _shell snapshot_ is a whole acorn window captured from a running app. A desktop scene is HTML
copied from the window and styled on the site by the app's own stylesheets, so it follows the
visitor's theme. A terminal scene is the terminal client's cells, in the format
[specimens](./specimens.md) use. Unlike a specimen, nothing checks a snapshot against the code. It
records the commit it was captured at, and `pnpm --filter @acorn/site stale` lists it once the
shell's sources change.

## The scenes

| Scene | What it shows | Drawn by |
| --- | --- | --- |
| `hero` | A task with its agent session, the Changes pane with a diff, and a terminal | Desktop |
| `hero-terminal` | The same task, 120 by 36 | Terminal client |
| `palette` | The command palette over that task | Desktop |
| `permissions` | Settings, on the Database plugin's **Permissions** tab | Desktop |
| `database` | The Database pane with the schema, a query, and its result | Desktop |
| `review` | A pull request with an inline review thread and its checks | Desktop |
| `workflow` | A workflow run on its graph, waiting at a gate | Desktop |
| `notes` | The webhooks task's Notes pane, with its plan open | Desktop |
| `editor` | The webhooks task's Editor pane, with a changed file open | Desktop |
| `context` | The webhooks task's Context pane | Desktop |
| `fleet` | Fleet home with two Nodes | Desktop |
| `browser` | The extension's panel beside the pull request's page | Chrome |
| `terminal-small` | The task's Git pane, 80 by 24 | Terminal client |

`apps/site/src/snapshots.ts` holds each scene's caption, which only screen readers hear, and its window size. The steps that drive
the app to each scene are in `apps/site/scripts/capture-shell.mjs`.

## The fixture

Every scene draws one invented world, so pictures on different pages agree. It lives in
`apps/site/snapshots/fixture/`:

| File | What it holds |
| --- | --- |
| `world.json` | The workspace, its projects and tasks, notes, the agent session's turns, the pull request, and the workflow. |
| `billing-api/` | The main project. `base/` is committed, `pull/` is committed on the pull request's branch, and `head/` is laid over `base/` as the task's uncommitted changes. |
| `web-app/` | A second project, committed as it is. |
| `billing.sql`, `overdue.sql` | The Database pane's schema and rows, and the query in its editor. |
| `shell.sh` | The login shell the capture gives the apps. A terminal shows its fixed screen instead of a real prompt, and a command runs in `/bin/sh`. |
| `bin/` | Stand-ins for `claude`, `codex`, and `uv`, first on `PATH`. The usage meter reads nobody's account, and the workflow's steps have something to run. |

`--fixture site-snapshots` seeds it, for both `pnpm dev:agent` and `pnpm dev:tui:agent`, through
`apps/desktop/scripts/agent/siteSnapshots.ts`. To look around in it:

```sh
pnpm dev:agent -- --session look --fixture site-snapshots
```

People, organizations, and repositories are invented. Email addresses are on `example.com`.

## How a capture runs

`capture-shell.mjs` runs the apps the way the [agent drivers](../local-development/agent-drivers.md)
and the [extension loop](../local-development/extension-dev-loop.md) do, as commands, because apps
never import each other:

1. It starts a terminal session on the fixture at 120 by 36, and captures the terminal scenes with the
   driver's `cells` verb.
2. It starts a desktop session on the fixture. Each scene's steps run in the window through
   `pnpm dev:agent:ui run`, after `apps/site/scripts/shellPage.js`, which supplies helpers such as
   `click` and `open` and the `capture` function that copies the window.
3. For the browser scene, it starts the extension loop in Chrome, pairs the panel with the terminal
   session's Node, opens the pull request beside it with the driver's `panel` verb, and copies the
   panel the same way.
4. It stops every session, deletes its folder, and writes `apps/site/src/generated/snapshots/`.

Every process it starts runs with the fixture's shell, its `bin/` first on `PATH`, `TZ=UTC`, and a
`DOCKER_HOST` that points at nothing, so no real container is listed. A scene that needs a service
gets a stand-in:

| Scene | Stand-in |
| --- | --- |
| `database` | A throwaway PostgreSQL, loaded from `billing.sql`, as the Node's `DATABASE_URL`. |
| `review` | A fake GitHub (`apps/site/scripts/fakeGithub.mjs`). |
| `fleet`, `browser` | The terminal session's Node, as the second Node and as the extension's Node. Each pairs with a code that Node gives the terminal client's own device token. |

### The fake GitHub

The pull request scene needs a GitHub connection and a pull request, and the fixture can't have a
real one of either. `fakeGithub.mjs` is a proxy the desktop session's processes reach through Node's
own proxy support: `NODE_USE_ENV_PROXY=1` and `HTTPS_PROXY`. It answers `api.github.com` from
`world.json` and the commits on the pull request's branch, under a certificate it makes for the run
and the Node trusts through `NODE_EXTRA_CA_CERTS`. It tunnels every other host untouched. After a run
the capture prints each GitHub request the fake didn't answer, which is where to look when the
scene shows an error.

### What the page script changes

The agent window is never on screen, so before the first scene `shellPage.js` makes it behave like
one that is: animation frames run on a timer, the document reports itself visible, and animations are
off. It also refuses WebGL, so xterm falls back to drawing its rows as text.

`capture` copies the page and rewrites the copy so the site can draw it as a static picture:

- It leaves out hidden elements, scripts, frames, canvases, and event handler attributes.
- It leaves out tooltips, which a picture never shows and which can carry the machine's time zone.
- It leaves out `app:` and `acorn:` links, images from another site, and attributes that hold a
  commit or a digest.
- It writes input, text area, and checkbox state into attributes.
- It replaces a terminal with a `.cells` block, its colors as palette slots, and a webview with a
  labeled box.
- It keeps a scrolled region's place by moving its children.
- It prefixes every id with the scene, except `root`, which the app's stylesheet sizes the window by.
- It carries the custom properties the shell keeps on `<html>`, such as the terminal drawer's height.
- It keeps the rules the window writes at runtime, such as CodeMirror's, minus any declaration in a
  fixed color.

## On the site

Draw a snapshot with the `Snapshot` component:

```astro
---
import Snapshot from '../components/Snapshot.astro'
---

<Snapshot id="hero" />
```

A page that shows one scene twice passes `instance` on the second copy, such as
`<Snapshot id="fleet" instance="tour" />`. It renames the scene's ids in that copy, so each id stays
unique on the page.

A desktop or browser scene draws at its window's size and scales to the column. A terminal scene sizes
its text to fit its columns. The snapshot is `inert`, so nothing in it can be focused or clicked.

The [specimen stylesheet](./specimens.md#the-specimen-stylesheet) styles snapshots too. It reads
every stylesheet in client-core, not only the manifest's, and keeps a rule when a specimen or a
snapshot uses it. The extension panel's own sheet applies only inside a browser scene's panel,
because its class names overlap the shell's.

Compressed sizes on October 15, 2026, with Brotli:

| File | Size |
| --- | --- |
| `hero.html` | 8.5 KB |
| `palette.html` | 9.5 KB |
| `permissions.html` | 9.7 KB |
| `review.html` | 6.5 KB |
| `database.html` | 4.6 KB |
| `workflow.html` | 4.2 KB |
| `editor.html` | 6.3 KB, on October 16 |
| `notes.html` | 3.5 KB, on October 16 |
| `context.html` | 3.5 KB, on October 16 |
| `fleet.html` | 2.8 KB |
| `browser.html` | 0.9 KB |
| `hero-terminal.cells.json` | 1.1 KB |
| `terminal-small.cells.json` | 0.7 KB |
| The specimen stylesheet, with the snapshots' rules | 13.3 KB |

## Add a scene

1. Add the scene's steps to `DESKTOP` or `TERMINAL` in `capture-shell.mjs`. Add any data it needs to
   the fixture.
2. Add its caption and size to `apps/site/src/snapshots.ts`.
3. Run `pnpm --filter @acorn/site snapshots <scene>`, then restart `pnpm dev:site`, which builds the
   stylesheet when it starts.
4. Look at it on `/lab/snapshots/` in a light and a dark theme, and run
   `node --test apps/site/scripts/snapshotPrivacy.test.mjs`.

A step is a function run in the window. It gets the ids the fixture seeded, and WebDriver gives it
about 30 seconds, so split a long scene into several steps.

## What a snapshot can't show

- The SQL editor's syntax colors, because CodeMirror picks them for one theme.
- The desktop window's clock in UTC. The renderer takes the machine's time zone, so the transcript's
  times are local to whoever captured it. The Node and the terminal client run in UTC.
- The pull request's web page in the browser scene, which is a labeled box.
- Staleness from a plugin's pane. `SNAPSHOT_SOURCES` in `apps/site/scripts/stale.mjs` lists the
  shell's chrome, layouts, and stylesheets, so a change to the Database pane alone doesn't list the
  `database` scene.
