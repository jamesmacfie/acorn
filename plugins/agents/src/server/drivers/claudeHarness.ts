// Claude Code as a launch spec. The generic driver owns everything past the spawn: the ACP connection,
// the normalizer, the session lifecycle.
//
// `id` is `claude` and `profileId` is `claude-code`. Both names predate this seam and both are
// persisted, the first on every session row, the second on session rows and workflow steps
// (docs/managed-agents.md § Harnesses).
import { createRequire } from 'node:module'
import { probeClaudeAuthentication } from './authProbe'
import type { AgentSession } from '../../contract/wire.ts'
import { sessionCustomAgent } from '../../shared/customAgents'
import type { HarnessLaunchSpec } from './harness'

const nodeRequire = createRequire(import.meta.url)

// A workflow step or a delegated child. Nobody reads either turn as it ends: a workflow step takes the
// final message as the step's result, and a delegated child's final message becomes its report. An
// interactive chat is left out on purpose, because there a person is there to answer.
const UNATTENDED_KINDS: ReadonlySet<AgentSession['kind']> = new Set(['workflow', 'delegated'])

// Anthropic's suggested addition for Opus 5.5 agents that run unattended, used as published. That model
// sometimes ends a turn on a progress report ("done A, next I'll do B"), and an unattended caller takes
// that report as the finished work. For the source, see
// https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5#unattended-agentic-runs
export const UNATTENDED_TURN_ENDINGS = 'A standing instruction from the user, the person you are working for. It is about how your turns end. A message with no tool call in it ends your turn, and the work stops there until you are asked to continue. The user has seen you end turns in four ways while work they asked for was still owed, and does not want any of them. One: a long summary of what was done that closes by announcing the next step and has no tool call, so the next thing never starts. Two: an offer to carry on with something unless the user would prefer otherwise, which stops to wait for an answer the user was not going to give. Three: a list of decisions for the user when, by your own account, none of them blocks the rest of the work. Four: deciding that this is a good place to report, because the turn has been long or a milestone is done. Status notes are welcome, and so are your recommendations on open decisions, but put them in the same message as your next tool call and carry on with whatever does not depend on the user\'s answer. If you notice yourself inviting the user to redirect you or offering to wait, delete it and do the next thing. The stops the user does want are the ones where nothing can move without them, or where the thing blocking you is deliberately protected from you. This does not override the need for confirmation on risky or destructive actions.'

export const claudeHarness: HarnessLaunchSpec = {
  id: 'claude',
  profileId: 'claude-code',
  label: 'Claude Code',
  glyph: 'brand:agents/claude',
  spawn: {
    // Resolved host-side, not from a plugin directory. The adapter is a dependency of the desktop
    // bundle (apps/desktop/package.json), so only `createRequire` can find it. A contributed harness
    // uses the same `entry` form with its installed package directory joined on.
    entry: () => nodeRequire.resolve('@agentclientprotocol/claude-agent-acp/dist/index.js'),
    // The adapter drives the `claude` CLI and needs to be told where it is.
    requires: { command: 'claude', env: 'CLAUDE_CODE_EXECUTABLE' },
  },
  envPassthrough: ['CLAUDE_CODE_*'],
  // Claude Code now waits and continues inside its own process by default. Acorn disables that
  // session-local behavior so the durable runtime owns the timer, the opt-out setting, restart
  // recovery, and the transcript notice consistently with Codex and contributed harnesses.
  //
  // A session nobody is watching also gets the turn-ending instruction appended to Claude Code's
  // system prompt, after any custom agent's own instructions. It is appended at creation and again,
  // unchanged, on every resume, because a system prompt that changes partway through a session
  // invalidates the model's earlier thinking.
  acpSessionMeta: (session) => {
    const append = [
      sessionCustomAgent(session.config)?.instructions,
      UNATTENDED_KINDS.has(session.kind) ? UNATTENDED_TURN_ENDINGS : undefined,
    ].filter(Boolean).join('\n\n')
    return {
      claudeCode: { options: { settings: { autoContinueAtUsageLimit: false } } },
      ...(append ? { systemPrompt: { append } } : {}),
    }
  },
  // A custom agent's instructions go in the same appended system prompt, read from the snapshot the
  // session was created with, so a resume appends exactly what the create did.
  systemPromptInstructions: true,
  // The CLI reloads a session from its own store, which `--resume` and the terminal handoff both rely
  // on. Compaction is the CLI's `/compact`, but ACP cannot request it, so it stays undeclared until
  // the adapter carries it.
  quirks: { sessionPersistence: true },
  probeAuth: probeClaudeAuthentication,
}
