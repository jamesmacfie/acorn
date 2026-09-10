// The harness half of `CoreServices.models`: one turn of an installed agent CLI, spent as text.
//
// The connection runtime beside this reads a database row, reveals a secret and checks a status. A CLI
// has none of those, so nothing here is a synthesized connection: it is a profile id, a command on
// PATH, and a child process that gets an empty room to answer in.
//
// What a generate here deliberately is not: `agents.sessionExecute`. That path needs a task, creates a
// durable session row, and appends to the transcript ledger per call. A commit message is not a
// session.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HARNESS_BACKEND_PREFIX, type ModelBackend } from '@acorn/protocol/modelProviders.ts'
import { agentProfileRegistry } from '../agentProfiles'
import { AGENT_TOOL_PASSTHROUGH } from '../agentProfiles/toolEnv'
import type { StreamEvent } from '../agentProfiles/types'
import { spawnsReady } from '../core/loginShellPath'
import { brokerEnv } from '../core/proc'
import { providerRequestScheduler, type ProviderRequestScheduler } from '../integrations/budgetRuntime'
import type { ProviderRequestBudgets } from '../integrations/types'
import { ProviderOperationError } from '../integrations/types'
import { runHeadless } from '../headless'
import { profileAvailable, resolveCommand, type ProfileDef } from '../profiles'
import { DEFAULT_TIMEOUT_MS, validateInput } from './runtime'
import type { GenerateTextInput, GenerateTextResult } from './types'
import { createLogger } from '../telemetry/logger'

const log = createLogger('harness-generate')

// Two at a time, per profile and in total for that profile. Four Generate dialogs opened at once
// should not put four agent CLIs on the machine, and a CLI start costs far more than an HTTP request
// does. The lane is keyed by profile id rather than by a provider id, which the scheduler is happy
// with: it treats both arguments as plain map keys and never looks either up in a registry.
const HARNESS_BUDGETS: ProviderRequestBudgets = { maxConcurrentRequests: 2, maxConcurrentRequestsPerConnection: 2 }

export type GenerateTextForHarnessArgs = {
  profileId: string
  input: GenerateTextInput
  timeoutMs?: number
}

/** Every profile that declares a one-shot text mode, split by whether its command is on this machine. */
export async function harnessBackends(): Promise<{ backends: ModelBackend[]; missing: ModelBackend[] }> {
  // The login-shell PATH probe, before any `which`. Off a packaged macOS build it can still be running
  // when the first read lands, and `which claude` before it settles answers "not installed" for a CLI
  // that is (../core/loginShellPath.ts). `runHeadless` waits on the same gate before spawning, so this
  // read and the call it leads to agree.
  await spawnsReady()
  const backends: ModelBackend[] = []
  const missing: ModelBackend[] = []
  for (const profile of agentProfileRegistry.list()) {
    if (!profile.aiArgv) continue
    ;(profileAvailable(profile) ? backends : missing).push(harnessBackend(profile))
  }
  return { backends, missing }
}

const harnessBackend = (profile: ProfileDef): ModelBackend => ({
  id: `${HARNESS_BACKEND_PREFIX}${profile.id}`,
  kind: 'harness',
  label: profile.label,
  ...(profile.glyph ? { glyph: profile.glyph } : {}),
  models: profile.models ?? [],
  defaultModelId: profile.defaultModelId ?? '',
})

/**
 * One turn of an agent CLI, contained.
 *
 * The containment is the whole of this function: tools off (the profile's `aiArgv` does that), an
 * empty directory to run in, an environment with no acorn token in it, and the same bounds a
 * connection generate gets.
 */
export async function generateTextForHarness(
  args: GenerateTextForHarnessArgs,
  scheduler: ProviderRequestScheduler = providerRequestScheduler,
): Promise<GenerateTextResult> {
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS
  // The same bounds as the connection runtime, called rather than restated: 60 seconds, 100,000 system
  // characters, 1,000,000 prompt characters, 128,000 output tokens. `maxOutputTokens` is validated here
  // and then ignored, because neither Claude Code nor Codex has a flag for it — a bound the caller
  // states and the backend cannot honour is still worth refusing when it is absurd.
  validateInput(args.input, timeoutMs)

  await spawnsReady()
  const profile = agentProfileRegistry.get(args.profileId)
  // A profile that went missing between the read and the call, or one that never declared a one-shot
  // mode, gets the status a deleted connection gets. `require` would throw a plain Error and surface as
  // a 500, and an id a client no longer holds is not an internal failure.
  if (!profile?.aiArgv || !profileAvailable(profile)) throw new ProviderOperationError('provider_not_connected', 404)

  const argv = profile.aiArgv(resolveCommand(profile), {
    prompt: args.input.prompt,
    system: args.input.system,
    ...(args.input.modelId?.trim() ? { model: args.input.modelId.trim() } : {}),
  })
  // Empty on purpose, and removed either way. Claude Code reads `CLAUDE.md` from cwd and Codex reads
  // `AGENTS.md`, so a generate started in a worktree would silently answer with that repo's house
  // rules in front of the caller's prompt. Everything the caller wants the model to see is in the
  // prompt already.
  const cwd = await mkdtemp(join(tmpdir(), 'acorn-generate-'))
  const started = Date.now()
  try {
    const lane = `${HARNESS_BACKEND_PREFIX}${profile.id}`
    const run = await scheduler.run(lane, lane, HARNESS_BUDGETS, () =>
      runHeadless(argv, {
        cwd,
        // No `ACORN_API_URL`, no `ACORN_API_TOKEN`, no `ACORN_TOOL_CEILING`: there is no task, no MCP
        // server in the child, and nothing for a tool to call. `AGENT_TOOL_PASSTHROUGH` is
        // configuration only, so the CLI still authenticates with its own stored login and still works
        // behind a proxy, and no key acorn holds is anywhere in this environment.
        env: brokerEnv({ passthrough: AGENT_TOOL_PASSTHROUGH }),
        timeoutMs,
        ...(args.input.signal ? { signal: args.input.signal } : {}),
        ...(profile.streamJson ? { adapter: profile.streamJson } : {}),
      }),
    )
    const text = run.capture.result?.trim() ?? ''
    if (run.status !== 'ok' || !text) {
      // The stderr tail goes to the log and never to the client, which is the flatten rule in
      // docs/integrations.md § Provider boundaries. A CLI's stderr can quote a config file or a path,
      // and a failed generate is not the place to find out what else.
      log.warn(`${profile.id} ${run.status} in ${Date.now() - started}ms: ${run.stderrTail.trim().slice(-500)}`)
      throw new ProviderOperationError('provider_unavailable', 502)
    }
    return {
      text,
      providerId: profile.id,
      backendId: lane,
      modelId: reportedModel(run.capture.events) || args.input.modelId?.trim() || 'default',
      ...(run.capture.usage ? { usage: usageOf(run.capture.usage) } : {}),
    }
  } finally {
    await rm(cwd, { recursive: true, force: true }).catch(() => undefined)
  }
}

// Which model the CLI says it used. `HeadlessCapture` has no field for it, so this reads the raw
// events: claude reports it on both its init and its result event, and a CLI that reports none falls
// back to what was asked for. Last one wins, because a stream that names the model twice named it
// second after resolving an alias.
const reportedModel = (events: StreamEvent[]): string => {
  for (let i = events.length - 1; i >= 0; i--) {
    const model = events[i].model
    if (typeof model === 'string' && model.trim()) return model.trim()
  }
  return ''
}

// The two counts a caller can compare across backends. A CLI's cached-token split is real but has no
// column on `GenerateTextUsage`, and inventing one for a number nothing reads is not worth the wire.
const usageOf = (usage: { inputTokens?: number; outputTokens?: number }): GenerateTextResult['usage'] => ({
  ...(usage.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
  ...(usage.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
})
