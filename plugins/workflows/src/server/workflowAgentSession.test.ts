import { describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { makeTestPluginDb } from '@acorn/plugin-api/testkit'
import { agentProfileRegistry, DEFAULT_PROFILE_ID, type ExtensionPointId } from '@acorn/plugin-api/node'
import * as schema from '../node/schema'
import { WorkflowRunner, type RunnerDeps, type WorkflowExtensions } from './workflowRunner'

// When a step's row learns which managed session it is running in.
//
// It used to be the completion patch, which meant `runForSession` answered nothing for the whole time
// somebody might want to look: the Agent pane's "Workflow: …" chip appeared only once the step was
// over, and a reader watching a step work had no way from the session back to the run. The session id
// now rides along on the forwarded events, and the row takes the first one it sees.

const noExtensions: WorkflowExtensions = { entries: <T>(_point: ExtensionPointId<T>) => [] }

const ok = {
  status: 'ok' as const,
  exitCode: 0,
  capture: { result: 'done', structuredOutput: null, sessionId: null, costUsd: null, events: [] },
  stderrTail: '',
}

describe('which harness a step runs on', () => {
  it('resolves the workflow default before the step is run', async () => {
    const testDb = makeTestPluginDb('workflows')
    const profile = agentProfileRegistry.register({
      id: DEFAULT_PROFILE_ID, label: 'Claude Code', kind: 'agent', command: 'claude',
      backendPreference: 'tmux', transport: 'pty',
    })
    const asked: Array<string | undefined> = []
    try {
      const runner = new WorkflowRunner(testDb.db, {
        runStep: async (_taskId, _def, opts) => {
          asked.push(opts.profileId)
          return ok
        },
        writeHandoff: async () => {},
        assembleContext: async () => '',
        evaluatePolicy: async () => ({ pass: true }),
        failingChecks: async () => '',
        notify: () => {},
      }, noExtensions)
      // No harness named, which is what the editor's "The workflow default" leaves behind.
      await runner.start('task-1', { name: 'W', steps: [{ name: 'look', kind: 'agent', prompt: 'go' }] })

      // Not `undefined`. The managed path reads this to find a driver, and answers "no driver" for a
      // profile it cannot name — which used to send every default-harness step to a bare CLI process
      // with no session and no transcript.
      await vi.waitFor(() => expect(asked).toEqual([DEFAULT_PROFILE_ID]))
    } finally {
      profile()
      testDb.cleanup()
    }
  })
})

describe('a step running in a managed session', () => {
  it('records the session while the step is still working', async () => {
    const testDb = makeTestPluginDb('workflows')
    // Validation refuses a step whose profile nothing has registered, and in a bare test nothing has.
    const profile = agentProfileRegistry.register({
      id: DEFAULT_PROFILE_ID, label: 'Claude Code', kind: 'agent', command: 'claude',
      backendPreference: 'tmux', transport: 'pty',
    })
    let releaseStep: (() => void) | undefined
    const finished = new Promise<void>((resolve) => { releaseStep = resolve })
    const deps: RunnerDeps = {
      // The shape plugins/agents' session execute reports: one `managed-agent` event per streamed
      // frame, each naming the session it came from.
      runStep: async (_taskId, _def, opts) => {
        opts.onEvent?.({ type: 'managed-agent', sessionId: 'sess-9', sequence: 1, event: {} })
        await finished
        return ok
      },
      writeHandoff: async () => {},
      assembleContext: async () => '',
      evaluatePolicy: async () => ({ pass: true }),
      failingChecks: async () => '',
      notify: () => {},
    }

    try {
      const runner = new WorkflowRunner(testDb.db, deps, noExtensions)
      const runId = await runner.start('task-1', {
        name: 'Investigate',
        steps: [{ name: 'look', kind: 'agent', prompt: 'have a look' }],
      })

      await vi.waitFor(async () => {
        const [row] = await testDb.db.select().from(schema.workflowSteps)
          .where(eq(schema.workflowSteps.runId, runId))
        expect(row?.agentSessionId).toBe('sess-9')
        // The point of it: the row says this while the step is in flight, not afterwards.
        expect(row?.status).toBe('running')
      })

      releaseStep?.()
      await vi.waitFor(async () => {
        const [row] = await testDb.db.select().from(schema.workflowSteps)
          .where(eq(schema.workflowSteps.runId, runId))
        expect(row?.status).toBe('done')
        expect(row?.agentSessionId).toBe('sess-9')
      })
    } finally {
      releaseStep?.()
      profile()
      testDb.cleanup()
    }
  })
})

describe('what a step that runs an agent is given', () => {
  // Every kind that runs an agent honours the step's Upstream output setting, not just `agent`.
  // `decide` used to send its prompt alone: the editor showed it the Append control, defaulted to
  // Append, and the runner threw the upstream output away, so a step asked to judge an analysis was
  // handed nothing to judge.
  it('appends the upstream output to a decide step', async () => {
    const testDb = makeTestPluginDb('workflows')
    const profile = agentProfileRegistry.register({
      id: DEFAULT_PROFILE_ID, label: 'Claude Code', kind: 'agent', command: 'claude',
      backendPreference: 'tmux', transport: 'pty',
      aiArgv: (command) => ({ file: command, args: [] }),
    })
    const prompts: string[] = []
    try {
      const runner = new WorkflowRunner(testDb.db, {
        runStep: async (_taskId, def, opts) => {
          prompts.push(opts.prompt)
          return def.kind === 'decide'
            ? { ...ok, capture: { ...ok.capture, structuredOutput: { verdict: 'yes' } } }
            : { ...ok, capture: { ...ok.capture, result: 'the analysis' } }
        },
        writeHandoff: async () => {},
        assembleContext: async () => '',
        evaluatePolicy: async () => ({ pass: true }),
        failingChecks: async () => '',
        notify: () => {},
      }, noExtensions)
      await runner.start('task-1', {
        name: 'W',
        steps: [
          { name: 'analyze', kind: 'agent', prompt: 'analyse it' },
          { name: 'pick', kind: 'decide', after: ['analyze'], prompt: 'changes or none?', branches: { yes: 'apply' } },
          { name: 'apply', kind: 'agent', after: ['pick'], prompt: 'apply it' },
        ],
      })

      await vi.waitFor(() => expect(prompts).toHaveLength(3))
      expect(prompts[1]).toContain('changes or none?')
      expect(prompts[1]).toContain('## Output of analyze')
      expect(prompts[1]).toContain('the analysis')
    } finally {
      profile()
      testDb.cleanup()
    }
  })
})
