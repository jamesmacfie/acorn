// Claude Code as a launch spec. The generic driver owns everything past the spawn: the ACP connection,
// the normalizer, the session lifecycle.
//
// `id` is `claude` and `profileId` is `claude-code`. Both names predate this seam and both are
// persisted, the first on every session row, the second on session rows and workflow steps
// (docs/managed-agents/harnesses.md § Harnesses).
import { createRequire } from 'node:module'
import { sessionCustomAgent } from '../../shared/customAgents'
import { LOOP_HOOK_TIMEOUT_SECONDS, type AgentLoopHookEvent } from '../../contract/loopHook.ts'
import type { HarnessLaunchSpec } from './harness'
import type { AgentDriverLoopHooks, AgentDriverReadBlock } from './types'

const nodeRequire = createRequire(import.meta.url)

const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`

/** The `hooks` entry for Claude's settings: one command hook per point that has a handler. Claude runs
 *  these beside the person's own hooks, and a deny from any of them refuses the call. */
export function claudeLoopHookSettings(bridge: AgentDriverLoopHooks): Record<string, unknown> {
  const entry = (event: AgentLoopHookEvent) => [{
    matcher: '*',
    hooks: [{
      type: 'command',
      command: [bridge.command, ...bridge.args, 'claude', event].map(shellQuote).join(' '),
      timeout: LOOP_HOOK_TIMEOUT_SECONDS,
    }],
  }]
  return {
    ...(bridge.beforeTool ? { PreToolUse: entry('PreToolUse') } : {}),
    ...(bridge.afterTool ? { PostToolUse: entry('PostToolUse') } : {}),
  }
}

/** Claude Code's settings for a session kept out of the data root (docs/managed-agents/read-block.md).
 *  The sandbox confines every shell command and the processes it starts. Claude's own Read and Edit
 *  tools run outside it, so deny rules keep them out of the entries that hold nothing this session
 *  reads. The Edit rules also stop the agent planting files there, such as a `.env` or a key file. */
export function claudeReadBlockSettings(block: AgentDriverReadBlock): { sandbox: Record<string, unknown>; deny: string[] } {
  return {
    sandbox: {
      enabled: true,
      // Without this, the agent can rerun a refused command outside the sandbox, and in
      // skip-permissions mode nothing asks first.
      allowUnsandboxedCommands: false,
      // A machine that can't run the sandbox refuses the session rather than running it unconfined.
      failIfUnavailable: true,
      filesystem: { denyRead: [block.dataDir], allowRead: block.readable, allowWrite: block.writable, denyWrite: block.writeDenied },
      ...(block.loopback ? { network: { allowedDomains: [block.loopback] } } : {}),
    },
    // `//` anchors at the filesystem root, as the skill allow rules below do.
    deny: block.hidden.flatMap((path) => [`Read(/${path})`, `Read(/${path}/**)`, `Edit(/${path})`, `Edit(/${path}/**)`]),
  }
}

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
  // Host attendance is fixed at session creation and supplies bootstrap instructions. The runtime
  // also supplies per-turn instructions for legacy sessions and other harness prompt channels.
  // Claude Code 2.1.292 keeps the appended prompt a session was created with and ignores a new one on
  // resume, so nothing that can change between starts goes here. The skills index goes ahead of a turn
  // instead (docs/managed-agents/skills.md § Delivery). Each skill's folder gets a read-only allow rule
  // (`//` anchors at the filesystem root), so the agent reads a body without a prompt and gains no write
  // access anywhere new. Flag settings are per process, so the rule follows the current index.
  //
  // The skills themselves go in as session plugins, the Agent SDK's `plugins` option, which the adapter
  // passes through unchanged and the SDK turns into `--plugin-dir` on a create and a resume alike. Unlike
  // the appended prompt, a resume loads the plugins it's given now. See
  // docs/managed-agents/native-skills.md § Native skills.
  nativeSkills: true,
  // acorn's bridge goes in as command hooks in the same flag settings, which Claude Code runs beside the
  // person's own and never writes anywhere (claudeLoopHookSettings above, docs/managed-agents/loop-hooks.md).
  // Like the allow rules, flag settings follow each process, so a resume installs what has a handler now.
  loopHooks: true,
  // The read block goes in the same flag settings, so like the hooks it applies from each start.
  readBlock: true,
  acpSessionMeta: (session, skills, loopHooks, attendanceInstructions, readBlock) => {
    const append = [
      sessionCustomAgent(session.config)?.instructions,
      attendanceInstructions,
      typeof session.config.standingContext === 'string' ? session.config.standingContext : undefined,
    ].filter(Boolean).join('\n\n')
    const block = readBlock ? claudeReadBlockSettings(readBlock) : null
    const allow = skills.folders.map((dir) => `Read(/${dir}/**)`)
    const permissions = allow.length || block ? { permissions: { ...(allow.length ? { allow } : {}), ...(block ? { deny: block.deny } : {}) } } : {}
    const plugins = skills.plugins.length ? { plugins: skills.plugins.map((path) => ({ type: 'local', path })) } : {}
    const hooks = loopHooks ? { hooks: claudeLoopHookSettings(loopHooks) } : {}
    return {
      claudeCode: { options: { settings: { autoContinueAtUsageLimit: false, ...permissions, ...hooks, ...(block ? { sandbox: block.sandbox } : {}) }, ...plugins } },
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
  probeAuth: async (executable) => (await import('./authProbe')).probeClaudeAuthentication(executable),
}
