# 11-16. Preview: an empty state that points the wrong way, and three names

**Status:** not started. Batch B11. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

The Preview pane's "No preview URL yet" state tells the person to press "the pane switcher's ▶ button",
check `url` in `.acorn/config.toml`, or "the preview URL in Settings → workspace". The setting is on the
project's **Preview** tab, not a workspace page. The remote case talks about "remote Nodes" and "the
Node machine" with capital letters. The pane is "Browser preview" in the switcher, "Open Preview" in the
palette, and "Browser preview URL" in settings.

## Where to see it

The Preview pane shows only when a task has a preview address, and area 11 could not make it appear in
the driver. Read it from `plugins/preview/src/client/PreviewPane.tsx`.

## Already done

- K3's `IconButton` tip default gave the toolbar's six glyph buttons hover labels.

## The fix

The partial fix. An **Open Preview settings** action has no confirmed way for the plugin to open a
project's Preview tab, so it is deferred (see [deferred.md](../deferred.md)).

- `plugins/preview/src/client/PreviewPane.tsx:131-166`: both empty states per the copy below, pointing
  at the project's Preview tab.
- `plugins/preview/src/client/paneContribution.ts:10`: "Preview".

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `PreviewPane.tsx:131-133` | Preview unavailable on remote Nodes / A page loaded here could reach services on this computer's network. Run Acorn on the Node machine to inspect its preview. | Rewrite | Title: "Preview works on this computer only". Body: "A page from another computer could reach your local network, so acorn doesn't load it here. Open acorn on that computer to preview it." |
| `PreviewPane.tsx:137-140` | No preview URL yet / Start the run target from the pane switcher's ▶ button. If it is already running, check its url in .acorn/config.toml or the preview URL in Settings → workspace. | Rewrite | Title: "No preview address". Body: "Start the app from the pane switcher's run button, or set an address in the project's Preview settings." |
| `PreviewPane.tsx:147-164` | … / Back to the run target's URL / Copy the page address / Toggle preview DevTools | Rewrite the last three | … / Go to the app's start page / Copy page address / Show developer tools |
| `PreviewPane.tsx:123` | Copied the page address | Keep | |
| `paneContribution.ts:10` | Browser preview / Live preview of the app | Rewrite | Preview / The app running in this task |
| `plugins/preview/src/client/index.ts:28-29` | Open Preview / the running app for this task | Keep | "Preview" now matches the pane. |

The `:137-140` body is the plan's overrule on row 655: "Start the app from the pane switcher's run
button."

## Risk and checks

- Before you start, check whether settings search or docs quote "Browser preview".
- Screens: none reachable in the driver; check by test and by reading the code.
- Tests: `plugins/preview`.
