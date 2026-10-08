# Acorn links

Use `acorn://` links to open a place in the desktop app or with `acorn --link` in the terminal client.
The parser and builder live in `packages/client-core/src/host/registries/commands/addresses.ts`.
`packages/client-core/src/host/registries/commands/addressOpening.ts` owns desktop dispatch.
`apps/tui/src/chrome/link.ts` owns terminal navigation.

## Address forms

| Form | Destination |
| --- | --- |
| `acorn://<node>/t/<taskId>[?pane=<paneId>[&item=<itemId>]]` | Task, optional pane, and optional item in that pane. |
| `acorn://<node>/p/<projectId>[/<project path>]` | Project or a page under it. |
| `acorn://<node>/settings[/<pageId>][#<sectionId>]` | Settings root, page, or section. |
| `acorn://<node>/source/<sourceId>` | Rail source. |
| `acorn://<node>/open?url=<encoded URL>` | Destination claimed by a content-link recogniser. |
| `acorn://<node>/new-task?url=<encoded URL>` | Existing task or a confirmed promotion in the desktop app. |

The core forms and project root are stable. A plugin owns its path below `/p/<projectId>/` and can
rename or remove it. A missing plugin page opens the project with an unavailable-page notice. A
missing task pane opens the task with a notice in the desktop app.

`<node>` is a concrete lowercase Node ID, not its display name. `local` resolves to this device's
bundled home Node at open time. **Copy link** writes the concrete ID so another device cannot silently
open its own home Node instead. A device must already pair with that Node. A link grants no pairing,
plugin trust, or other authority, and does not carry a credential.

## Input and authority

`parseLink` validates the raw address before URL normalization changes its path. It decodes each
path, query, or fragment component once and refuses malformed escapes, dot traversal segments, bad
form combinations, and links over 4,096 characters. An item requires a pane. `open` and `new-task`
accept only HTTP or HTTPS URLs with a host. `buildLink` encodes each navigation value once and rejects
invalid or oversized output.

The desktop checks that the selected Node is paired and waits for its shell to restore its place and
commit that Node's plugin contributions. Rust buffers cold-start and running-app URLs until the
renderer subscribes. The desktop reports an unpaired Node, unavailable place, or timeout through a
notice and toast. Scheme registration lives only in
`apps/desktop/src-tauri/tauri.release.json`, which the release packaging script includes. Dev and
agent builds do not register a scheme handler.

Links navigate or open a confirmation dialog. They do not run palette commands, agent prompts, or
workflows. An outside URL is an input to a recogniser, not proof of authority over a project or task.
The Node's normal authorization and plugin trust checks still apply after navigation.

## Copy a link

Use **Copy link** in the palette, a task row or rail source menu, a project page's topbar menu, or
the Settings header. When Settings covers another place, its visible page and selected Node win.
Otherwise the command uses the visible task, the project route owned by the visible source, or the
rail source. Row menus use the clicked row even when another row is active. The task link includes
the focused pane. A pane contribution may report `selectedItem(task)` for its selected item, but no
production pane reports one. The desktop shows success only after the clipboard write completes and
shows a failure toast if it does not. The terminal uses OSC 52 and shows the link in its palette when
clipboard delivery is unavailable.

## Open outside items

`open?url=` asks the content-link registry for a destination. `new-task?url=` asks that registry for
a claim and project path, then finds a source promotion by provider ID. Its source ID stays distinct
from the provider ID. The promotion checks for an active task before fetching item details. An active
task opens directly. Otherwise the desktop loads the item and shows the promote dialog in its
project; canceling writes nothing. Task creation or attachment happens only after confirmation.

GitHub pull requests prefill the title and head branch. The dialog and pull list share the
unambiguous Linear reference mapping from the pull body. A URL without a claim, a tracked project,
or a source with link promotion gets a specific refusal. For an untracked repository, **Add project**
opens `settings/workspaces#projects`.

## Terminal limits

`acorn --link '<link>'` validates the address before connecting to or starting a Node. It refuses
`--task` or `--node` beside `--link`, an action link, a malformed link, and an unpaired concrete Node.
`local` uses the terminal's local data root, but attaching without a saved token does not begin
pairing. The linked place wins over restored task or source selection.

The terminal waits up to 15 seconds for selected-Node contributions when a task names a pane, a
project names a subpath, a source needs a registered view, an outside URL needs a recogniser, or
Settings names a page. A task without
a pane, a project root, and Settings root use the compiled roster directly. Deferred requests belong
to the mounted shell and selected Node; stale requests do not navigate after either changes. For a
task or project in another workspace, the terminal selects that workspace before checking source
visibility and opening the place.

The terminal opens only registered routes with an available terminal view. A plugin page without one
falls back to its project with a notice. An outside URL with only a reference panel, or no claim,
gets a refusal. Named Settings pages can open, but section fragments do not scroll in the terminal.
`new-task` needs the desktop confirmation dialog and exits before a Node connection starts.

## Extend and test links

Add a form to the `Place` union, `parseLink`, and `buildLink` in
`packages/client-core/src/host/registries/commands/addresses.ts`. Add desktop behavior in
`packages/client-core/src/host/registries/commands/addressOpening.ts` and terminal behavior in
`apps/tui/src/chrome/link.ts`. Cover parser refusals and
round trips in `packages/client-core/src/host/registries/commands/addresses.test.ts`; use
`packages/client-core/src/host/registries/commands/addressOpening.test.tsx` and
`apps/tui/src/chrome/link.test.tsx` for dispatch. Update this page when
the contract changes.

To exercise the desktop renderer without changing your operating system's scheme handler:

```sh
pnpm dev:agent -- --session links-docs
pnpm dev:agent:ui -- --session links-docs link acorn://local/settings/integrations
pnpm dev:agent:ui -- --session links-docs snapshot
pnpm dev:agent:ui -- --session links-docs stop
```

To exercise terminal startup, use the `tui-navigation` fixture and inspect its screen:

```sh
pnpm dev:tui:agent -- --session links-tui --fixture tui-navigation --link acorn://local/settings/integrations
pnpm dev:tui:agent:ui -- --session links-tui snapshot
pnpm dev:tui:agent:ui -- --session links-tui stop
```

Run `pnpm test:focus @acorn/client-core src/host/registries/commands/addresses.test.ts` for parser
changes. The renderer test checks dispatch, not operating-system delivery. Installed-release
acceptance remains unverified: three disposable macOS bundle attempts failed during host Rust
proc-macro compilation before an `.app` was produced. Use an installed disposable bundle to check
cold, running, and minimized delivery when that build is available.
