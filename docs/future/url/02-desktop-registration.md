# Phase 02: desktop registration

Date: October 7, 2026. Status: planned; implementation not started. Dependencies: phase 01.
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
