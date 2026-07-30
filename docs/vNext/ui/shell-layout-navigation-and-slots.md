# Shell, layout, navigation and slots

Status: Normative<br>
Requirement prefix: `UI-SHELL`

Electron presents one Fleet across all paired Nodes while preserving the shipped Acorn task and
review experience.

## Shell regions

```text
┌──────────┬──────────────────────────────────────────────────────────────┐
│ Fleet /  │ topbar: Node · Workspace · Repo · Task · status · account   │
│ workspace├──────────────────────────────────────────────────────────────┤
│ rail     │ main: Fleet source | workspace source | TaskView | PR browse│
│ sources  │                                                              │
│ tasks    │ task: flat left-to-right contributed pane row                │
│ +        │                                                              │
└──────────┴──────────────────────────────────────────────────────────────┘
                    task terminal drawer / overlays / notifications
```

- **UI-SHELL-001:** The top-level shell is always Electron-owned and usable if every Node or plugin
  is unavailable.
- **UI-SHELL-002:** The rail groups Fleet sources, paired Nodes, Node-owned workspaces, contextual
  workspace sources and workspace-scoped tasks. Every remote item exposes its Node identity and
  connection state without requiring hover.
- **UI-SHELL-003:** Selecting a workspace retains its owning Node. Selecting a repository or task
  cannot silently switch to a same-named resource on another Node.
- **UI-SHELL-004:** Agent Center, attention, notifications, activity and search can aggregate
  authorized projections across connected Nodes. Each result preserves Node origin and mutations
  target exactly one Node.
- **UI-SHELL-005:** The main region selects exactly one top-level mode: Fleet contribution,
  workspace source, active task, or GitHub browse/create/review fallback.

## Canonical navigation

Electron route state contains Node and resource identity. Human-readable owner/repository labels may
appear in the path but are not authoritative.

- **UI-SHELL-006:** Internal navigation targets are typed:
  `fleet`, `node`, `workspace`, `repository`, `task`, `resource`, `settings`, `plugin`,
  `wizard`, `pane`, or `external`.
- **UI-SHELL-007:** Resource routes MUST resolve canonical `acorn://` identity before rendering.
  Deleted, unauthorized, disconnected and relocated resources get distinct host states.
- **UI-SHELL-008:** External navigation displays destination origin, strips credentials, validates
  scheme, and opens through the Electron safe-navigation policy. Plugin UI never calls
  `window.open` directly.
- **UI-SHELL-009:** Back/forward records top-level mode, node-qualified resource and local
  presentation selection. It does not replay mutations or resurrect expired view sessions.
- **UI-SHELL-010:** Deep links require an already paired Node or start the host pairing flow after
  owner confirmation. Link content cannot auto-pair, install a plugin or grant authority.

## Task layout

The V2 task layout preserves the current model:

```ts
type TaskLayout = {
  panes: string[]                  // unique, left-to-right, at least one
  weights?: Record<string, number> // positive finite relative widths
  pinned?: string[]                // subset protected from ordinary close
}
```

- **UI-SHELL-011:** Core owns the pure transitions `show`, `add`, `close`, `pin`, `move`, `resize`,
  `equalize`, `replace`, `focus`, and `maximize`. Plugins can request transitions but cannot mutate
  layout storage.
- **UI-SHELL-012:** The row has no split tree. Adjacent dividers resize; double-click equalizes;
  minimum widths derive from renderer and contribution; focus/maximize remain client-session state.
- **UI-SHELL-013:** Closing the last unpinned pane falls back to the GitHub PR pane when available,
  otherwise the first available default-profile pane.
- **UI-SHELL-014:** Unknown or unavailable persisted pane IDs remain as labeled placeholders.
  Reinstall/reactivation restores them in place after compatibility checks.
- **UI-SHELL-015:** Layout recipes contain only registered pane IDs and bounded weights/pins.
  Applying a recipe is an atomic client presentation operation.

## Named slots

| Slot | Context | Policy |
| --- | --- | --- |
| `topbar.left` | active Node/workspace/task | compact, non-modal |
| `topbar.right` | connection/task/owner controls | compact; host controls last |
| `fleet.rail` | Fleet summary | bounded rows |
| `workspace.rail` | selected workspace | bounded rows |
| `task.switcher.extra` | active task | icon action |
| `task.footer` | task ID/status | quiet additive status |
| `acorn.task.activity` | active task, bounded activity projection | host-composed semantic items |
| `tabrail.task-row` | task ID/status | badge only |
| `statusbar` | active view/session | bounded status |
| `overlay` | shell context | declared modal/non-modal |

- **UI-SHELL-016:** Slot order is host group, contribution order, canonical ID. Plugins cannot
  position before mandatory security, connection or owner controls.
- **UI-SHELL-017:** Slot content uses semantic UI or isolated bespoke host and receives only the
  slot context. The host sets size, overflow and focus policy.
- **UI-SHELL-018:** A failing compact/quiet slot is omitted and logged with an accessible aggregate
  warning when user action is required. A failing overlay is replaced by a host error dialog.
- **UI-SHELL-019:** Overlay focus is trapped, Escape behavior is declared, focus returns to the
  invoker and security prompts occupy a host-exclusive top stacking class.
- **UI-SHELL-027:** `acorn.task.activity` composes items from Agents, Workflows and other declared
  providers using host-owned ordering, virtualization, privacy redaction and accessible grouping.
  A contribution cannot import or invoke another provider's Client implementation.

## Shortcuts and command palette

- **UI-SHELL-020:** Commands are the source of truth; keybindings invoke command IDs. Every
  keybound plugin action remains discoverable without its key.
- **UI-SHELL-021:** Scopes are global, Fleet, workspace, task, pane and typing-exempt. Typing targets
  retain editor shortcuts; only documented terminal meta chords bypass ordinary typing protection.
- **UI-SHELL-022:** Electron owns reserved chords, conflict detection, override persistence,
  reset-to-default and effective-chord tooltips. A conflict leaves the later command unbound.
- **UI-SHELL-023:** Preserve the current global behavior: command palette, file palette, workspace
  palette, settings, pane close, save, task create, source cycling and task shortcuts. Exact parity
  appears in [desktop parity](../ux/desktop-parity-contract.md).

## Appearance

- **UI-SHELL-024:** Preserve orthogonal theme and style axes. Themes own colors; styles own shape,
  typography, spacing, density, chrome and motion. Their token sets MUST remain disjoint.
- **UI-SHELL-025:** Code, diff, terminal and tabular surfaces remain monospace and geometry-stable.
  State is never communicated by color alone.
- **UI-SHELL-026:** Theme/style are paired-client presentation settings. Plugin-provided compatible
  packs are client artifacts and cannot affect Node state or bespoke guest security.
