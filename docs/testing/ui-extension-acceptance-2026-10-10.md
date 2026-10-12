# UI extension acceptance

Date: October 10, 2026. Status: dated delivery evidence for the plugin UI extension programme. Record
later runs in a new dated page rather than editing this one.

This page records how the contextual extension points were checked, what each host drew, and what
acceptance is still open. The programme's phase records are in Git history,
and [places to fill](../contribution-kinds.md#places-to-fill) owns the shipped list.

## Regression commands

Run these after changing a point, its owner, or the authoring path:

1. `pnpm --filter create-acorn-plugin test`. It builds
   [the extension example](../plugin-authoring/extension-example.md) from its pages against the packed
   `acorn-plugin-sdk` and `acorn-plugin-types`, type-checks it, checks every tree entry its manifest
   names, and calls each route.
2. `pnpm --filter @acorn/desktop test`. `test/client/publicExtensionPoints.test.ts` holds the
   `plugin_authoring` point list against the client registry, and `clientPluginDisable.test.ts` checks
   that each point leaves with its owner.
3. `pnpm test --filter=@acorn/node-core` and `pnpm test --filter=@acorn/node`. They cover the
   manifest rules, the authoring guide, and the points bundled loaded plugins declare.
4. `pnpm test --filter=@acorn/client-core` and `pnpm test --filter=@acorn/tui` for the hosts.
5. `pnpm --filter @acorn/arch-tests test` for the docs and source citations.

## Host matrix

Phase 13 installed three loaded fixtures together, a client-only tree contributor, an own-route
provider, and a document service, in `pnpm dev:agent` and in `pnpm dev:tui:agent` at 80 by 24, 120 by
40, and 140 by 90. Node 26.8.1.

| Point | Desktop | Terminal |
| --- | --- | --- |
| Link previews | One match drew the tree. A tie and a miss drew the owner card. `http:` and credential URLs drew nothing | Links show their address. The picker wasn't reachable by keys |
| Transcript media | 105 cards read through the capability. A 70 KiB file got the contributor's refusal | Bodies drew in cells |
| Workflow body | `terminal:command` drew run, step, output, and revision | Not driven |
| File and tab menus | Owner rows, then the plugin row. The body carried no bytes | **Shift+F10** row ran on a folder |
| Message and turn menus | Three Copy rows, then two plugin rows. A 500 showed `uix-routes: action failed` | Menus drew. Keys didn't reach them |
| Selection | Markdown got Copy and one row. Escape kept the selection | **Actions for the whole text** drew |
| Detail region | Not run in the combined session. Phase 06 checked it in a real host | Not run |
| File marks | One batch of three keys. Malformed rows dropped. Text cut to 200 characters | Dots and legends |
| Document services | `bad.json` got one mark, which cleared once fixed | Not driven |
| Fences | Four viewers of six. **Preview** on the fifth sent the first back to source | The same, with **[Source]** and **Copy** |
| Preview toolbar | After the owner's controls, with the page's `url` | No Preview on this host |
| Terminal toolbar | A timer and a driver press got `needs_person` | Drew and updated in place |
| Source and pane marks | On Git's source and the Changes pane | `1 marks` and `+1` |
| Task marks | 300 sent, 256 drawn | `+257` on the row |

Each plugin bundle ran one worker for all its mounts: three workers for 105 media cards, 100 links,
2,000 files, and six fences. Over 20 transcript mount cycles, the DOM returned to 818 nodes each time,
and the web content process didn't keep the growth once the fixtures were off.

## The extension example in a real host

On October 10, 2026, the built example was installed into `pnpm dev:agent -- --session p14` through
`/v1/core/plugins/install`, the Node restarted, and the bundle was accepted on the device. In a
project-folder task:

- The **Review** pane drew its tree, and **Add to review** appeared after Editor's own file rows.
- Pressing it stored the file, and the tree row's label gained `Under review — acme-review`.
- `p14-scratch.csv` opened as the example's table with **Read-only preview**.
- A Markdown `TODO` got a warning, and hovering it showed `Resolve before merge.` with
  **From Review TODOs**.
- A note's `https://docs.example.com/guide/review` link previewed as **Review guide** with
  **From Acme review**.
- **Interrupt** sat beside the drawer's controls, disabled with no running session.

The window reports `document.hidden`, which stops plugin pushes from asking for marks again. The
check overrode `document.hidden` first. The tool card, the CSV artifact, and the Linear region weren't
drawn, because they need an agent turn, a `text/csv` artifact, and a Linear connection. The example's
terminal behavior wasn't driven.

## Open acceptance

- Native child-webview overlap and real focus: none of
  [native overlays](./native-overlays.md) A1 to A16 has a native pass.
- A trusted desktop press on a toolbar action. The driver can show only refusals.
- The Linear detail region in a combined session, which needs a working Linear connection.
- Terminal key paths for link previews, message menus, and toolbar presses. The cells tests in
  `apps/tui` cover them, and the driver can't place focus there.
- A heap-level leak check, which needs Web Inspector.
