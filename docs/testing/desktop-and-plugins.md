# Desktop and plugin checks

Run these checks for the packaged shell, plugin installation, client bundles, and host webviews.
The numbers retain their original acceptance-check IDs.

## Packaged desktop and plugin surfaces

1. Install and launch; the window appears and the local node reaches online.
2. Pair a second node by code; fingerprint words match.
3. Open a terminal; a TUI renders and survives resize.
4. Open a preview pane against a task dev server through the tunnel. Navigate, go back, and cover it
   with an overlay; the child webview hides rather than floating above it.
5. Open a loaded plugin pane; it renders, and a network call from its frame fails.
   Install a client-only plugin on this device from a remote package. Accept its trust prompt, confirm
   its pane appears without restarting, then disable, re-enable, update, and remove it. A newer bundle
   on a Node must not displace it. Removal must clear its state and restore core in any chosen
   exclusive slot; a deliberately failing provider must also fall back to core.
6. Open a loaded plugin's webview surface; a link to a host its manifest does not name is refused.
7. Trigger the quit flow with an active agent; the concern prompt appears; quit drains cleanly.
8. Kill the node process five times; the recovery screen appears on the sixth.
9. Install a data-only harness plugin against an agent CLI on the machine; the trust prompt names the
   command under `Enforced`, and after approving it the agent appears in the Agent Center and completes
   a turn. Nothing automated can cover this one: the suites can prove the descriptor reaches the driver
   registry, and only a real CLI can prove the transcript.

For managed-session naming, run one detailed first prompt with both Claude Code and Codex. Confirm the
prompt fallback appears immediately and is replaced by a short title without interrupting the turn.
Repeat while renaming the session before the generated result arrives, and confirm the user title
wins. Signed-out CLIs and Aider must retain the fallback without adding a transcript warning.

10. Build the reference node provider into the running node's data root
    (`pnpm --filter @acorn/node build:plugin nodes-file`, with `ACORN_NODES_FILE` set), write one
    node into that file, and from Settings → Nodes adopt it, run a task on it, then create and destroy
    one. Same reason as the item above: the route, provider and merge halves each have automated
    coverage and the rendered surface has none ([plugins.md](../plugins.md) § Node providers).

The next six items came from the user-extensions landing review (2026-08-15; they lived in a
`live-qa` file under `docs/future` until 2026-08-28). Plugin suites run in a node environment with no Solid transform, so the
chrome the extension work added has never been seen rendering by a test. Each names the behaviour to
see, not the code to read:

11. Right-click a surface with a plugin-declared context menu row; the menu appears at the pointer
    and clamps to the viewport instead of overflowing at a screen edge.
12. A plugin's declared `topbar` slot item renders at the topbar's right end, beside the node chip and
    the bell, at a size that does not distort the bar.
13. A contribution from plugin B renders inside plugin A's declared `pane.footer` point under a pane,
    with sensible spacing, overflow, and empty state.
14. Force a render throw in a plugin's `coreSlot` replacement; the surface falls back to core's own
    implementation rather than going blank.
15. Select a plugin-contributed theme; the terminal and CodeMirror pick up the right light or dark
    self-description. Disable the plugin; the fallback to Light or Dark happens without the stored
    preference being rewritten.
16. Edit a dev-mode plugin's entry file and an imported route module. Reload the plugin after each
    edit; both changes take effect in the fresh worker without a node restart or a trust prompt.

The next two are the remote tree's, from layout phase 3 (2026-08-29). The suites cover the wire, the
renderer, the worker lifecycle and the two render paths producing identical DOM; what nothing
automated covers is a real worker started from a real bundle over the shell's own scheme.

17. Install a plugin declaring an `extensions` entry on `agents:tool-card`, accept its trust prompt,
    and run an agent turn that makes a matching tool call. The card draws from the
    plugin's worker and is indistinguishable from a compiled one: same spacing, same disclosure
    behaviour, same style pack. Reject the bundle instead and the built-in card draws.
18. Break that bundle so it throws on mount. The card shows the labelled placeholder, a row appears on
    the plugin's page, and the transcript around it keeps working — scrolling, selection, every other
    card.

The next four are the loaded four's, from layout phase 5 (2026-08-30). All four panes are trees now and
the automated tiers stop at the JSX preset, so these are the eyes-on pass on the shipped plugins.

19. Open the API pane on a task. The request tree, the URL bar, the tabs and the response all draw.
    Send a request; paste a curl command into the URL bar and press Enter — the whole request fills in,
    on the commit rather than on the paste. Save one through the dialog, then delete one: two clicks,
    with the label changing between them.
20. Open the Database pane on a task with a database. The SQL editor is above, the table list, grid and
    row detail below, and `⌘Enter` in the editor runs the query. Save a query, then load it back from
    the picker and delete it from the picker's own row control.
21. Open a task linked to a Linear ticket, then the same ticket's reference panel from a PR body. Both
    draw from one worker. Post a comment, open a sub-issue from the Overview tab and come back with
    the back affordance, and click a `linear.app` link inside the description — it re-points this view
    rather than opening a browser.
22. Open a task linked to a Rollbar item, pick an occurrence, and copy its context. Then reject one of
    the four bundles at the trust prompt: its pane draws the labelled placeholder and the other three
    keep working.

The last three are layout phase 9's (2026-08-30), and they are the pass the whole programme was
building towards. The kit invariants and the arch rules prove no plugin writes an element or a
stylesheet; only a person can tell whether the result is usable.

23. Traverse every pane with the keyboard and nothing else. Tab reaches each region in turn, arrow
    keys move inside a list, Enter opens a rectangle and Escape leaves it, and no pane is a place the
    keyboard can get stuck. Do the editor pane's file tree, the find-in-files results, the terminal
    drawer, the agents transcript and the PR pane's diff at minimum. Turn on a screen reader for one
    pass over the editor's sidebar: the file tree announces as a tree with levels and expanded state.
24. Scaffold a fresh plugin with `npm create acorn-plugin`, install it from disk, and accept its bundle.
    Open a task and run its **Open** command. Its own pane draws from a worker; press **Say hello** and
    check that the Node route's greeting appears. Then check the developer view on the plugin's page,
    disable the plugin, and uninstall it. The pane and command disappear at each step while the other
    panes stay available.
25. Scaffold the other shape with `--rectangle` and repeat the install. Its pane draws inside an
    iframe, and a network call from that iframe fails.

The last item is older than the rest. `docs/next-review.md`, deleted in the 2026-08-30 hygiene pass,
was a personal checklist with no inbound links. Every other line in it was already owned by this
checklist, by [shell.md](../shell.md) § Signing gates and the updater, or by
[caching.md](../caching.md). This one was not.

26. Run the Rollbar pane against a live project rather than the recorded fixtures, and check that the
    privacy allowlist holds on real payloads: no request header, cookie, or `person` field outside the
    allowlist reaches the pane or the copied context
    ([integrations.md](../integrations.md) § Rollbar). Then narrow the window to the smallest width the
    context pane and the Notes pane still support, and make one context section answer slowly. Both
    panes keep their layout, and the slow section reports itself without stalling the others
    ([notes-and-memory.md](../notes-and-memory.md) § Context integration).

## Loaded plugin lifecycle

86. On two paired Nodes with different accepted versions of one loaded plugin, switch between them.
    Each Node shows contributions from its own running version. Update the inactive Node, reject then
    reconsider its new client hash, and switch again: its old runtime remains visible until its Node
    commits the update. After restart, the new version appears only when its exact bytes are accepted.
    Disconnect, reconnect, and unpair one Node; stale or removed observations authorize no loaded UI.
87. Open two remote trees from one loaded bundle with different task or project scopes. Select in one,
    invoke a scoped action in each, then unmount the first. The second remains functional and never
    receives the first tree's selection, document effects, or gesture authority. Revoke the accepted
    hash while a tree is mounted; its worker and registrations disappear immediately.
88. On a Node without a loaded plugin, check its settings page, project importer, task footer, command,
    shortcut, and cooperative slot. They are absent or disabled, and a previously open importer closes.
    Repeat with a failed load and with an unaccepted active runtime. In the terminal client, confirm
    the same selection and trust behavior for a remote tree.

The plugin lifecycle checks are supported by `distributionModel.test.ts`,
`distribution.test.ts`, `availabilityModel.test.ts`, the Node state and bundle-route tests, and the
worker/remote-tree suites. The real desktop driver reaches the main renderer but not native dialogs
or host-owned child webviews; use the release pass for those surfaces. On 2026-09-26 an isolated Tauri
session verified Settings → Plugins and a Findings remote settings tree, including its two controls.
