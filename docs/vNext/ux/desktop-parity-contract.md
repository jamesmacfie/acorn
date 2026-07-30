# Desktop parity contract

Status: Normative<br>
Requirement prefix: `UX-PARITY`

A fresh V2 Electron installation MUST look and behave like the shipped application before new Fleet,
Node and plugin-management surfaces are considered. This is behavioral/visual parity, not a
requirement to retain current implementation boundaries or V1 wire/storage compatibility.

## Shell and navigation baseline

- **UX-PARITY-001:** Preserve left TabRail, topbar and main view structure; collapsible rail;
  workspace and repository pickers; breadcrumb; notification bell; terminal toggle; account menu;
  command/file/workspace palettes; settings and task/source switching.
- **UX-PARITY-002:** Preserve top-level modes: contributed source, active TaskView, GitHub classic
  PR browser and create-PR flow. Fleet/Node selection is additive and may add disambiguating chrome.
- **UX-PARITY-003:** Preserve workspace behavior: Default bootstrap, one workspace per repository,
  identity color/icon, repository assignment/hide/show, mapped checkout, external project links and
  per-repository execution/database/preview configuration.
- **UX-PARITY-004:** Preserve task creation from PR, Linear, Rollbar and local-first flows; lazy
  worktree creation; PR inheritance by branch; external links; rename, pin, drag order, archive and
  guarded teardown.
- **UX-PARITY-005:** Preserve task rail decorations: workspace accent/icon, PR checks, working agent,
  unread needs-you, dirty/missing worktree and Docker badges.

## Sources

The default profile MUST present:

| Source | Visibility and behavior |
| --- | --- |
| GitHub/Reviews | always when GitHub is configured; repository PR browse/create/review fallback |
| Docker | always available when Node capability exists; projects/containers/images/volumes/networks |
| API Requests | always installed; saved repository requests and task-aware execution |
| Linear | visible when compatible connection/project capability is configured |
| Rollbar | visible when compatible connection/project capability is configured |
| Agent Center | Fleet/workspace-aware managed agent sessions, status, usage and actions |

- **UX-PARITY-006:** Source selection clears active task presentation and displays the source in the
  main region. Promoting an item creates/links a task and selects its default pane as today.

## Task panes

The default profile MUST register these thirteen pane IDs and behavior:

| Pane | Baseline |
| --- | --- |
| `agents` | managed Claude/Codex conversation, requests, queue, context, artifacts and lifecycle |
| `pr` | linked PR navigator/diff/review; unavailable when no PR |
| `changes` | uncommitted worktree diff and inline review notes sent to agent |
| `notes` | task/workspace/global Markdown note library and scratchpad |
| `context` | select, preview, size and sync assembled agent context |
| `editor` | worktree file tree, open tabs and code editing |
| `search` | worktree content search and editor reveal |
| `database` | task PostgreSQL browse/edit, saved queries and model-assisted SQL |
| `docker` | matched task containers, lifecycle/logs/stats/exec |
| `preview` | kept-alive Electron browser preview with safe chrome and agent-driving capability |
| `http` | repository/task saved or draft API requests and encrypted variables |
| `linear` | linked Linear issue targets; only when task has link |
| `rollbar` | linked Rollbar items; only when task has link |

- **UX-PARITY-007:** Preserve the flat pane row, switcher order, click-to-show, Meta/Ctrl-click-to-add,
  close/pin/move, adjacent resize, double-click equalize, session focus/maximize, minimum widths,
  kept-alive preview semantics and per-task layout restoration.
- **UX-PARITY-008:** Editor supplies standard editor/file/search renderers; Changes and GitHub
  consume the standard diff/review renderer. This ownership rewrite MUST NOT alter visible diff,
  file navigation, review or editor behavior.
- **UX-PARITY-009:** Preview splits Node target companion from Electron browser renderer while
  preserving URL/port/script resolution, browser chrome, task lifetime and cleanup.

## Keyboard and commands

Preserve pane defaults:

| Chord | Pane | Chord | Pane |
| --- | --- | --- | --- |
| `⌘⇧R` | PR review | `⌘⇧G` | Changes |
| `⌘⇧D` | Notes | `⌘⇧X` | Context |
| `⌘⇧E` | Editor | `⌘⇧F` | Find in Files |
| `⌘⇧J` | Database | `⌘⇧B` | Browser preview |
| `⌘⇧H` | API requests | `⌘⇧A` | Agents |
| `⌘⇧L` | Linear | `⌘⇧O` | Rollbar |
| `⌘⇧T` | Toggle task Terminal drawer | — | — |

Docker remains contribution-available without a default pane chord.

- **UX-PARITY-010:** Preserve global command palette, file palette, workspace palette, `⌘1–⌘9`
  visible task selection, `⌘⇧N` new task, Settings, save, close-pane, source cycling and reserved
  chord conflict behavior.
- **UX-PARITY-010A:** `task.terminal.toggle` has default task-context chord
  `meta+shift+t` (`Cmd+Shift+T` on macOS). It appears in Settings and the
  topbar tooltip, opens/closes the drawer, obeys typing protection and the same
  reserved/conflict/user-override/reset/accessibility policy as every command.
  A conflict leaves it unbound while the palette command remains available.
- **UX-PARITY-011:** Preserve typing-target protection, user override/reset, grouped Settings →
  Shortcuts rows and effective key tooltip. A conflict leaves later binding unbound.

## Settings baseline

- **UX-PARITY-012:** Preserve pages and behavior for Workspaces, workspace detail, Appearance,
  Integrations, MCP, Agent tools, Agent pricing, Workflows, Terminal, Docker, API requests,
  Shortcuts, Permissions and automation API. The automation page uses V2 credentials/contracts;
  `/api/v1` tokens and compatibility are not retained.
- **UX-PARITY-013:** Preserve twelve themes, four orthogonal style packs, follow-system theme,
  typography/density/chrome behavior, no flash of incorrect default and protected editor/terminal
  palette bridge semantics.
- **UX-PARITY-014:** Preserve current state restoration outcomes: last workspace/repository/path,
  source/task, pane layout, rail order/collapse, theme/style/shortcuts, terminal height/font/default
  profile, notices, open editor files, filters/context selection and onboarding completion.
  Storage keys/formats may change and MUST include Node scope.

## Feature behavior

- **UX-PARITY-015:** GitHub retains virtualized open/closed PR list, detail/timeline/checks/labels/
  reviewers, unified/split highlighted diff, inline review threads, viewed state, gap expansion,
  merge/auto-merge, close/reopen, draft/ready, comments/reviews, labels/reviewers, thread resolution,
  failed Action rerun and create-PR compare preview.
- **UX-PARITY-016:** Terminal retains per-task sessions, profiles, run targets, drawer resize/font,
  tmux/session status and safe focus/input; Agents retain managed/direct sessions, normalized
  transcript, queue, approvals/tools/context/artifacts, usage/pricing and notifications.
- **UX-PARITY-017:** Docker retains browse, task matching, badges, daemon-event refresh, guarded
  lifecycle/prune, logs/stats and exec. HTTP retains encrypted URLs/headers/bodies/auth/variables,
  plain/secret/command variables, lazy resolution/redaction and interactive-send policy.
- **UX-PARITY-018:** Database, Notes, Memory, Context, Workflows, Linear, Rollbar, model-provider and
  profile behaviors are defined by their current-plugin specifications and are release-blocking
  when included in the default profile.

## Visual and failure parity

- **UX-PARITY-019:** Preserve existing theme/style token system, spacing/density, icons/glyph
  fallbacks, pane geometry, virtualized row metrics, diff geometry, modal/picker focus, loading/
  empty/error treatment and keyboard-first interaction. Additive Node badges MUST not cause
  unnecessary layout regression in local-only mode.
- **UX-PARITY-020:** Local-only first run hides advanced Fleet complexity until relevant: the local
  Node appears as Acorn's default context, while Add Node and Plugin management remain discoverable.
- **UX-PARITY-021:** V2 may improve security/error clarity, but cannot silently remove an existing
  successful action, state indicator, shortcut, pane, source or setting. Any intentional behavior
  change requires a recorded decision and acceptance update.

## Acceptance suite

- **UX-PARITY-022:** Capture a versioned V1 baseline fixture set and run matching V2 end-to-end
  scenarios for every item above at fresh install, restore and degraded states.
- **UX-PARITY-023:** Required visual comparisons cover local-only shell, each source/pane/settings
  page, PR list/detail/diff/create, active terminal/agent, all theme/style primitives and common
  modal/notification/error states at representative desktop sizes.
- **UX-PARITY-024:** Cutover is blocked by missing functionality, incorrect task/workspace state,
  broken shortcut/focus/accessibility, material visual regression, cross-Node identity ambiguity or
  a system/default-profile plugin that cannot recover from failure.
