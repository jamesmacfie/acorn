# The references survey: what the neighbours do

Design notes from the ecosystem-feasibility session (2026-08-14). Source: the English READMEs of
the thirteen projects vendored under `references/` on that date — READMEs only, not code, except
where `docs/future/user-extensions/bb-reference.md` already recorded bb's internals. That folder
may move or be deleted; this file is written to outlive it. The question asked: which of these
could acorn-with-an-ecosystem mostly replace, and what would it have to match to win their users.

## Per project, one paragraph each

- **bb** — an agentic IDE that can modify itself; desktop, web, CLI, and HTTP API all first-class.
  The closest philosophical neighbour and the reason `docs/future/user-extensions/` exists. Its
  loop is real and its trust model is the warning prompt. Steal: every-surface-is-an-API, the
  `experimental_` prefix + audit ledger discipline for new plugin API members.
- **emdash** (YC W26) — Electron app for parallel agents in worktrees, local or SSH; pulls issues
  from nine trackers; review/PR/merge in-app; ACP structured agent sessions beside PTY. The
  closest like-for-like competitor. Steal: tracker-intake breadth, ACP as a provider-plugin
  registry.
- **orca** — open-source Electron orchestrator: fan one prompt across five agents, embedded
  browser with Design Mode (click an element, feed its HTML/CSS/screenshot to the prompt), diff
  comments shipped back to the agent, an `orca` CLI so agents drive the app, mobile companion.
  The most feature-dense direct competitor. Steal: Design Mode, the diff-comment review loop.
- **cmux (manaflow)** — native Swift/libghostty macOS terminal for parallel agent sessions:
  OSC-driven attention rings, scriptable in-app browser, socket API for everything, a skills
  marketplace repo. Steal: the attention system end to end, the trust model for auto-resumed
  sessions (approved env-bound command prefixes).
- **gouda** — private Electron app organizing parallel Claude sessions around GitHub PR state;
  detached PTY daemon so sessions survive app restarts; hook-driven attention states; "backburner
  is silent everywhere." Effectively someone's bespoke acorn. Steal: PR-reconciled workspaces
  (every PR you own/review gets a worktree, tombstoned on merge), the no-timer attention machine.
- **herdr** — single Rust binary, terminal-first agent multiplexer; detach/reattach over SSH;
  socket API shipped as an agent skill; **the only project here with a real hosted plugin
  marketplace** (herdr.dev/plugins) and manifest-driven, hot-reloadable agent-state detection.
- **verne** — macOS agent IDE; detached Rust daemon owns PTYs; Monaco+LSP; agent-drivable browser
  over MCP; per-workspace notes exposed to agents over MCP. Steal: notes-as-MCP-surface, the
  per-agent TOML detection manifests (same idea as herdr's).
- **cmux-craigsc** — ~560 lines of bash around the git-worktree lifecycle for parallel Claude
  sessions. acorn replaces it outright. One idea: `init` uses Claude itself to generate the
  repo's worktree setup hook.
- **bruno** — open-source API client; collections as plain-text files in the repo, Git-shared,
  offline-only, CLI for CI. acorn's http plugin is the same filesystem-first idea; Bruno wins on
  depth (environments, scripting, importers) and distribution spread. Steal: the CLI runner so
  saved requests run in CI.
- **agentfield** — a Go control plane turning agent functions into REST endpoints with durable
  queues, fan-out, audit. Server-side production infra, not a workspace; not acorn's to replace.
  Steal: the harness dispatch contract (budget caps, turn limits, per-dispatch tool allowlists),
  pause/resume approval.
- **agentmemory** — persistent memory for coding agents; local hybrid search; connects to ~20
  agents via MCP/hooks. A layer acorn could *host* as a plugin rather than replace. Steal: the
  one-command `connect <agent>` wiring, install-via-URL-you-hand-to-your-agent, published
  benchmarks as a trust signal.
- **roboco** — an autonomous 25-agent "company" with a task-lifecycle state machine and approval
  gates. Opposite philosophy (autonomous org vs human-driven workspace). Steal: the envelope
  pattern — every agent verb returns `next`/`remediate` so agents never guess state.
- **rastarbrain** — self-hosted second brain with tasks that carry an attached tmux session and a
  generic `POST /incoming` triage feed. Glancing overlap. Steal: tasks born with an env-injected
  session; the incoming-work feeder API.

## The five capabilities that recur — the table stakes

Across cmux, gouda, herdr, verne, orca, emdash, and bb, five things recur so consistently they
read as the category's entry requirements. For each: where it should live in acorn's model.

1. **Agent attention, reliably detected and surfaced.** Rings, dots, badges, jump-to-unread,
   deliberate silence rules. Detection is hooks/OSC/screen-heuristics; two projects made it
   manifest-driven and hot-reloadable. The first thing users compare. *Core-owned surface;
   detection rules are a plausible plugin/manifest seam.*
2. **Sessions that outlive the app.** Detached PTY daemons or native restore with agent resume.
   Anyone arriving from these tools treats app-lifetime PTYs as a dealbreaker. *Core.*
3. **Full programmability — the app as an API for agents.** CLI + socket/HTTP verbs to create
   workspaces, drive panes, read screens; packaged as an agent skill so agents drive the tool
   recursively. *The public `/api/v1` is the seam; it needs workspace/pane/session verbs and a
   shipped skill.*
4. **The intake-and-review loop.** Issues in from trackers, worktree+agent out, diff comments
   back to the agent, merge without leaving. *Exactly plugin-shaped; each tracker is a
   third-party plugin once the ecosystem opens.*
5. **An agent-drivable browser/verification surface.** Navigate, snapshot, click, read; orca's
   Design Mode is the standout form. *A host-owned surface with a borrowed contract, per the
   shell-vision stance.*

## The distribution lesson

The projects winning users install in one line — brew, npx, a single binary — and herdr shows a
small team can run a real marketplace. acorn's plugin breadth will not matter until installing
acorn and installing a plugin are both that friction-free; that is `work-plan.md § Phase 5`, and
it is last on purpose, not because it is unimportant.
