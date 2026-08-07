# Parity checklist

The half of [ui.md § Parity first](./ui.md) that a machine cannot check.

Everything that is a declared literal — the 13 panes with their orders and chords, the 6 sources with
their rail order, 12 themes, 4 style packs, ⌘⇧T / ⌘⇧N / ⌘1–9 / ⌘, / ⌘⇧↵ — is asserted in
`apps/desktop/test/client/parity.test.ts` and does not need a person. What is below is what only a
person can answer: whether the thing that renders is the thing V1 rendered, and whether the flows still
feel like flows.

**Walk it twice.** Once single-node, once with a second node paired. The fleet surfaces are gated on
`nodes().length > 1` — deliberately, because ui.md says first-run must never mention nodes — so a
single-node walk cannot see any of them, and a two-node walk cannot see what first-run looks like.

## Getting a build up

```
pnpm --filter @acorn/desktop dist     # the real thing; launch release/*.dmg
pnpm dev                              # faster, and enough for everything except packaging
```

Use a **fresh data root** for the single-node pass — the point is first-run behaviour, and an existing
root has been onboarded. `ACORN_E2E_DATA_DIR` is how the e2e suite does it; for a packaged build, move
`~/Library/Application Support/acorn` aside.

For the second node: `pnpm dev:node` on another root (it prints an endpoint, a fingerprint and a
device token), then Settings → Nodes → Add node. `pairTwoNodes()` in `apps/desktop/e2e/twoNode.spec.ts`
is the same sequence if you would rather read code than click.

---

## Pass 1 — single node, fresh install

### First run
- [ ] The app opens without mentioning nodes, fleets, or pairing **anywhere**.
- [ ] The onboarding modal offers workspace setup, and Done dismisses it for good.
- [ ] With a V1 install present, the importer panel appears above the mapping and its counts are right.
- [ ] Import moves the repos, and the panel is replaced by a summary rather than offering again.
- [ ] Connecting GitHub through Settings → Integrations works (device flow: code, then github.com).

### Shell
- [ ] The rail shows sources, then workspaces, then tasks, in that order.
- [ ] Typing protection: a chord pressed inside a text field or terminal types rather than firing.
- [ ] ⌘K palette opens, finds tasks and workspaces, and closes on Escape.
- [ ] ⌘⇧T opens and closes the terminal drawer; its tabs remember the per-task last-active one.

### The task view
- [ ] Panes add, close, pin, move, resize, equalize and maximize with the mouse.
- [ ] Closing the last unpinned pane falls back to the PR pane.
- [ ] Every pane's chord opens it, and ⌘1–9 activates the Nth task rather than focusing a pane.
- [ ] A pane's content survives switching tasks and coming back.

### Task creation — all four origins
- [ ] From a PR (GitHub browse → a row).
- [ ] From a Linear issue.
- [ ] From a Rollbar item.
- [ ] Local (⌘⇧N).
- [ ] Lazy worktree: a task has no worktree until a terminal, editor or changes pane needs one.
- [ ] A repo with a branch prefix set produces `<prefix>/<slug>` for an invented branch name, and
      leaves an explicitly typed branch alone.

### Appearance
- [ ] All 12 themes render legibly — this is the one that needs eyes, not a count.
- [ ] All 4 style packs change shape/type/space/density without breaking a layout.
- [ ] A theme and a style chosen together look deliberate rather than accidental.
- [ ] The choice survives a relaunch (it is a device pref now, in localStorage).

### The recorded divergences — confirm each is the NEW behaviour, not a bug
- [ ] Editor autosave surfaces a conflict instead of overwriting.
- [ ] There is no `/api/v1` and no automation-token UI.
- [ ] Preview has no raw shell URL-script mode.

### Settings
- [ ] Every page opens and renders: Workspaces, Appearance, Integrations, MCP, Agent tools, Agent
      pricing, Workflows, Terminal, Docker, API requests, Shortcuts, Nodes, Plugins, Security.
- [ ] Security shows the disk-encryption state and an audit trail with real rows in it.
- [ ] Backing up writes an archive; unpacking it shows databases and no credentials.

---

## Pass 2 — with a second node paired

Every item here must have been **absent** in pass 1.

- [ ] A Fleet source appears at the head of the rail, with a card per node.
- [ ] A node switcher appears in the topbar, listing both nodes by label.
- [ ] The workspace picker groups workspaces by node.
- [ ] Agent Center offers a scope toggle (this node / the fleet).
- [ ] The attention section in the notice bell carries node badges.
- [ ] ⌘K palette rows carry node hints.
- [ ] Settings → Plugins and Settings → Security both show a node picker.

### Remote behaviour
- [ ] Selecting a workspace on the other node switches node context and restores that workspace's
      last source/task/layout.
- [ ] A terminal on a remote task streams.
- [ ] An agent session on a remote task runs.
- [ ] A preview pane on a remote task loads through the tunnel.
- [ ] Stopping the remote node leaves its rows rendered with a stale/offline badge, and the local
      node unaffected.
- [ ] A mutation against the stopped node fails fast and keeps the typed text.
- [ ] Revoking this client from the other node shows it as `revoked`, not merely offline.

---

## Recording the result

Anything that fails is either a bug to fix or a divergence to record in
`docs/release-notes-vnext.md` — not a checkbox to leave unticked. Three divergences are already
recorded there; a fourth is fine, an unexplained gap is not.
