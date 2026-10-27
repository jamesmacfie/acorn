# Side questions: a btw thread beside a running session

Date: October 27, 2026. Status: done. Phases 1, 2, and 3 are done.

Claude Code's `/btw` lets you ask a quick question while the agent keeps working. The answer can see
the whole conversation, and the question never enters the main thread. This folder plans the same
thing for Acorn's managed sessions. A **btw** button in the Agent pane opens a side thread beside the
open session. The side thread is its own managed session, seeded with a copy of the source session's
transcript, and the task sidebar lists side threads in their own section, the way it lists inline
chats.

[Client surfaces](../../managed-agents/client-surfaces.md) owns the Agent pane and the task sidebar.
[Sessions](../../managed-agents/sessions.md) owns session creation and forks. Both pages win if this
plan disagrees with them.

## Phases

| Phase | What it delivers | Depends on |
| --- | --- | --- |
| [1. Side sessions on the Node](./01-side-sessions.md) | A route that starts a read-only side session from any session, even mid-turn, tagged with a `btw` origin. | Nothing |
| [2. The side split in the Agent pane](./02-side-split.md) | A **btw** button that opens the side session in a split beside the open conversation, with the copied history attached and the message field focused. | Phase 1 |
| [3. Side questions in the task sidebar](./03-sidebar-section.md) | A **Side questions** section in the task sidebar, plus the other places that read a session's origin. | Phase 1 |

Phases 2 and 3 can run in parallel once phase 1 lands.

## Decisions

- **A side thread is a fork with an origin, not a new session kind.** `runtime.fork` already copies a
  session's history into a new one and sets `parentSessionId`. Inline chats already use `origin` to
  leave the managed-sessions list, because the sidebar's list keeps only sessions with no origin. A
  `btw` origin gets both behaviors with no schema change. `origin` is stored as JSON in
  `originJson`, so no migration is needed either.
- **Copy the transcript, never fork natively.** `runtime.fork` refuses while a turn runs, and asking
  mid-turn is the point of a side question. Acorn's context copy (`buildForkContext`) reads the stored
  events, so it works for Claude and Codex at any moment. Codex's native `thread/fork` is cheaper, but
  nobody has checked whether it accepts a thread with a turn in flight.
- **Read-only by default.** A side question must not edit files the main session is editing. Inline
  chats already pick the harness's own read-only permission mode when it advertises one
  (`InlineDiffCard.tsx`, `readonlyProfile`), and fall back to an instruction in the prompt when it
  doesn't. Side threads do the same. The permission mode is a real limit. The prompt fallback isn't.
- **Side threads persist.** Claude Code's `/btw` answer disappears when you dismiss it. Acorn keeps
  the session and lists it in the sidebar, so a useful answer can be found again. Archiving is how you
  get rid of one, the same as every other session.
- **A split inside the Agent pane, not the reference panel.** The reference panel (`RefPanelBox`) is
  a modal drawer: a backdrop, focus trapped inside, and Escape closes it. You couldn't watch the main
  session while reading the answer. A split drawn inside the pane's detail region belongs to the
  Agents plugin ([regions](../../panes/regions.md#a-split-inside-a-region-is-the-plugins)), so it
  needs no shell change.

## Rules for every phase

- A side session never sends a turn to its source session, and the source session's queue, drafts,
  and attention are untouched.
- Starting a side session is a device action, like fork. Task credentials get `403`.
- The copied history is frozen at the moment you ask. It includes the in-flight turn's events up to
  that point and nothing after.
- Run the agents plugin's tests for each slice and the root lint steps by hand. Under pnpm 11,
  `pnpm lint` fails with "eslint not found".
- When a step ships a contract, update the owning page under `docs/managed-agents/` in the same
  change.

## Starting point

Recheck these against the checkout before you start.

| Piece | Where |
| --- | --- |
| Fork, which refuses mid-turn and picks native fork or context copy | `plugins/agents/src/server/sessions/runtime.ts` (`fork`) |
| The context copy built from stored events | `plugins/agents/src/server/sessions/runtimeContext.ts` (`buildForkContext`) |
| Requested options applied to delegated, inline, and custom-agent sessions | `plugins/agents/src/server/sessions/runtime.ts`, the `applyRequested` branch in session start |
| The fork route and body schema | `plugins/agents/src/server/routes/managed.ts` (`/sessions/:sessionId/fork`) |
| The bridge the route calls | `plugins/agents/src/server/routes/managedBridge.ts` |
| The create schema and its `origin` union | `plugins/agents/src/shared/schemas.ts` (`createAgentSessionSchema`) |
| The origin's wire type | `plugins/agents/src/contract/wire.ts` (`origin?: InlineDiffOrigin \| null`) and `contract/inlineDiff.ts` |
| Origin read from the row | `plugins/agents/src/server/sessions/rowMapping.ts` |
| The read-only permission pick | `plugins/agents/src/client/inlineDiff/InlineDiffCard.tsx` (`readonlyProfile`) |
| Session actions, including **Fork session** | `plugins/agents/src/client/sessions/agentPaneModel.ts` (`sessionActions`) |
| The detail region that mounts `AgentConversation` | `plugins/agents/src/client/sessions/AgentPane.tsx` |
| The kit's split handle | `packages/client-core/src/kit/components/layout/ListDetail.tsx` (`SplitHandle`) |
| How the first draft picks up a fork's copied history | `plugins/agents/src/client/composer/AgentComposer.tsx` (`pendingForkContext`) |
| The sidebar's sections, including **Inline chats** | `plugins/agents/src/client/sessions/AgentTaskSidebar.tsx` |
| Per-group order choice | `plugins/agents/src/client/sessions/sessionOrder.ts` |
| The command-line tool's `inline` flag | `apps/cli/src/browser/agents.ts` |

## Open questions

- Does Claude Code's own `/btw` work through Acorn's composer? Acorn runs Claude through ACP, and
  `/btw` is likely a feature of the terminal app only. Check this first in phase 1. If it works, the
  Node half of this plan may be unnecessary for Claude.
- How large can a copied transcript get? Every side question resends it, so on a long session each
  one costs many tokens. Check whether `renderSessionConversation` caps its output.
- Should a side thread offer **Allow edits** to switch to full access, as inline chats do?
- Should the **btw** button have a keyboard shortcut?
