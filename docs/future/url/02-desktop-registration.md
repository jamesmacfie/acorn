# Phase 02: desktop registration

## Completion note, October 7, 2026

Implemented installed-bundle `acorn` scheme registration through `apps/desktop/src-tauri/tauri.release.json`, included only
by `apps/desktop/scripts/dist.mjs`. Tauri's deep-link plugin receives cold and running-app URLs. Rust stores each
URL until the renderer subscribes, emits a wake event carrying the URL, and leaves parsing and routing
to phase 01's `openLink`. The single-instance plugin's deep-link feature handles second launches on
Windows and Linux. Dev and agent binaries have no scheme declaration; the agent driver sends links to
the same renderer handler with its `link` verb.

The renderer registers an address host after place restore, compiled plugin readiness, and a selected-
Node distribution pass that commits loaded contributions. The same wait runs when a link switches to
another paired Node. Content anchor clicks emit a link request into that handler. The external URL
command and agent web activity cards keep their `acorn:` refusals. The `connections` settings target
now aliases the live `integrations` page, so the phase's example lands on Services → Connections.

The [Tauri deep-link guide](https://v2.tauri.app/plugin/deep-linking/) and
[plugin source](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/deep-link/src/lib.rs)
establish the cold `get_current` read, the running `on_open_url` event, the single-instance feature,
and installed-bundle registration on macOS. No installed app was replaced or launched for this phase,
so OS delivery when running, minimised, and closed remains an installed-build acceptance check. Verify
those three states with a disposable installed bundle in `/Applications`, then verify a cold loaded
plugin path and a paired-Node switch with test data on that bundle. The agent session exercises the
renderer path, not macOS Launch Services.

Scoped checks: client-core lint, desktop lint, agents lint, architecture tests, four focused
plugin/content tests, and 65 Rust tests passed. The client-core suite passed 2,512 tests and retained
its two baseline failures in `scopes.test.ts` and `cssHygiene.test.ts` (log:
`/private/tmp/acorn-phase02-client-core.log`). The desktop suite passed 171 tests and retained its
11 baseline `clientPluginDisable.test.ts` failures (log: `/private/tmp/acorn-phase02-desktop.log`).
The agents suite passed 1,174 tests and had one sandbox process-table failure in `footprint.test.ts`;
its focused rerun outside the sandbox passed (log: `/private/tmp/acorn-phase02-agents.log`). The
architecture suite passed after staging generated the schema files (log:
`/private/tmp/acorn-phase02-arch.log`). In `dev:agent`, `link acorn://local/settings/connections`
opened Services → Connections; a screenshot is in the isolated session's `screenshots` directory.
An unpaired Node link returned the refusal and appeared in the notification ring.

Later phases should send every inbound link through this handler. Phase 04 can replace the dispatcher
refusal for `new-task` without changing OS delivery, content click routing, or the agent driver.

Date: October 7, 2026. Status: implemented. Dependencies: phase 01.
Read the [plan](./README.md), especially [the decisions](./README.md#decisions) about dev builds and
Node selection.

## Deliverable

Clicking an `acorn://` link anywhere on macOS opens the installed Acorn at that place. It works when
Acorn is running and when it starts because of the link. `acorn://` links inside Acorn's own content,
such as an agent's reply, open in the app.

## Steps

1. Add Tauri's deep-link plugin to `apps/desktop/src-tauri/Cargo.toml`, and declare the `acorn` scheme
   in the bundle configuration. Register it for the installed app only.
2. Forward links from Rust to the renderer as one event carrying the raw string. Rust doesn't parse
   it. The second-launch callback for `tauri-plugin-single-instance` in
   `apps/desktop/src-tauri/src/lib.rs` handles Windows and Linux. The deep-link plugin's open-URL
   event handles macOS.
3. Queue links in the renderer until the shell is ready to route. That's the same point workspace
   restore waits for in `docs/frontend/data-and-startup.md`: a Node is selected, and compiled and
   loaded plugins have registered. Then pass each link to `parseLink` and `openAddress`.
4. Make Acorn's own content open `acorn://` links in the app. Route them through `openAddress` from
   `handlePluginContentLinkClick` in
   `packages/client-core/src/host/registries/panes/contentLinks.ts`. Keep the two refusals that exist.
   `apps/desktop/src-tauri/src/external_urls.rs` stops the app asking the operating system to open an
   `acorn://` link, and `plugins/agents/src/client/sessions/webToolCard.test.tsx` covers web tool
   cards, which show what an agent fetched rather than links to follow.
5. Add a `link` verb to `pnpm dev:agent:ui` that hands a link to the renderer's handler. Dev builds
   don't register the scheme, and agent-automation builds skip the single-instance plugin, so this is
   how a session tests links.

## Acceptance

- With an installed build, a link opens the right place when Acorn is running, when it is minimised,
  and when it is closed.
- A link to a loaded plugin's page opens that page at a cold start. It doesn't fall to the "missing
  page" notice because the plugin registered late.
- A link to another paired Node switches Node and opens the place. A link to an unpaired Node shows
  the refusal notice.
- `pnpm dev:agent:ui -- --session <name> link acorn://local/settings/connections` opens that page in a
  dev session.
- `pnpm --filter @acorn/desktop test` and `pnpm --filter @acorn/arch-tests test` pass.

## Verify before building

- The deep-link plugin's behaviour on macOS for a cold start, including whether the link arrives
  before or after the window's first frame.
- Whether `pnpm dev` produces anything macOS can register. If it can, decide whether to suppress it.
- What `docs/managed-agents/activity.md` says about refusing acorn links in web activity, and update
  it if step 4 changes that.
