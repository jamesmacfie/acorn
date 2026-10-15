// What the Node, agent, data, and browser guides say their examples do (docs/site/plugin-guides.md).
// Each Node half runs on the testkit's real context, and each answer is parsed with the schema the
// host applies to it.
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { ClientSideConnection, ndJsonStream } from '@agentclientprotocol/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { validatePanelPlan } from '@acorn/dashboards-core/plan.ts'
import { makeTestNodeContext, readPackageSkill, schema, SecretService } from '@acorn/plugin-api/testkit'
import { panelPlanSchema } from '@acorn/protocol/dashboards.ts'
import { dataSourceDescriptionSchema, dataSourcePageSchema } from '@acorn/protocol/dataSources.ts'
import { validatePluginCliValue } from '@acorn/protocol/plugin/cliCommands.ts'
import {
  browserHandoffResolution,
  browserPanelView,
  matchHandoffPage,
  taskAddressList,
} from '@acorn/protocol/plugin/handoffs.ts'
import { qualifiedPluginToolName } from '@acorn/protocol/plugin/runtimeContributions.ts'
import { EXAMPLES, readExample, startNode, type NodeHalf } from './harness.ts'
import { copyNodeTypes, linkTool, run, TSC, unpackPublishedPackage } from './packed.ts'

const OWNER = 'owner-1'
const TASK = '5b0d7c39-2d6e-4f7a-9c1e-1f2a3b4c5d6e'
/** An agent's credential, bound to one task, as the host builds it for a tool call or a context read. */
const agent = { kind: 'internal' as const, userId: OWNER, scope: 'task' as const, taskId: TASK, sessionId: 's1' }
/** The Node's own credential, as a schedule run gets it. */
const service = { kind: 'internal' as const, userId: OWNER, scope: 'service' as const }

let node: NodeHalf | undefined
afterEach(async () => {
  vi.unstubAllGlobals()
  await node?.cleanup()
  node = undefined
})

const json = async (response: Response | Promise<Response>) => (await response).json()
const post = (body: unknown, principal?: typeof agent | typeof service) => ({ method: 'POST', body, principal })

/** A connection the owner made, stored the way Settings › Connections stores one. */
async function connect(half: NodeHalf, provider: string, key: string, capabilities = '{}') {
  const id = randomUUID()
  await half.ctx.db.insert(schema.integrations).values({
    id,
    userId: OWNER,
    provider,
    label: `${provider} account`,
    encryptedCredentials: await new SecretService(half.ctx.encryptionKey).seal(key),
    authKind: 'api-key',
    capabilities,
    status: 'connected',
    createdAt: 1,
    updatedAt: 1,
  })
  return id
}

/** Answers Acme's API for the one key the test connected with. */
function fakeAcmeApi(routes: Record<string, unknown>) {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get('authorization')
    if (auth !== 'Bearer acme-key') return new Response('unauthorized', { status: 401 })
    const answer = routes[new URL(url).pathname]
    return answer === undefined ? new Response('not found', { status: 404 }) : Response.json(answer)
  })
}

describe('acme-agent', () => {
  // #region tool-test
  it('names its tools <pluginId>_<id> and serves them to an agent on the task', async () => {
    const { manifest } = readExample('acme-agent')
    expect(
      (manifest.contributions.agentTools ?? []).map((tool) => qualifiedPluginToolName(manifest.id, tool.id)),
    ).toEqual(['acme-agent_list_notes', 'acme-agent_add_note'])
    node = await startNode(readExample('acme-agent'))
    const call = (path: string, args: object, callId: string) =>
      node!.call(`/v1/p/acme-agent/tools/${path}`, {
        ...post({ arguments: args, origin: { taskId: TASK } }, agent),
        headers: { 'x-acorn-tool-call-id': callId },
      })
    expect(await json(call('add-note', { text: 'Retry with backoff' }, 'call-1'))).toEqual({ saved: true, count: 1 })
    // A retry of the same call saves nothing new.
    expect(await json(call('add-note', { text: 'Retry with backoff' }, 'call-1'))).toEqual({ saved: true, count: 1 })
    expect((await json(call('list-notes', {}, 'call-2'))).notes).toMatchObject([{ text: 'Retry with backoff' }])
    // The device has no task credential, so the tool refuses it.
    expect((await node.call('/v1/p/acme-agent/tools/list-notes', post({ arguments: {} }))).status).toBe(403)

    const context = await json(
      node.call('/v1/p/acme-agent/context/notes', post({ origin: { taskId: TASK }, scope: 'task' }, agent)),
    )
    expect(context.compact).toBe('## Acme notes\n- Retry with backoff')
    expect(context.items).toMatchObject([{ kind: 'note', label: 'Note 1', body: 'Retry with backoff' }])
  })
  // #endregion

  it('stops a force push and reminds the agent to test after an edit', async () => {
    node = await startNode(readExample('acme-agent'))
    const subject = {
      sessionId: 's1',
      taskId: TASK,
      providerId: 'claude',
      unattended: false,
      root: '',
      toolCallId: 't1',
      toolName: 'Bash',
      title: '',
      paths: [],
    }
    const before = (command: string) =>
      json(node!.call('/v1/p/acme-agent/hooks/before-tool', post({ ...subject, kind: 'command', command })))
    expect(await before('git push --force origin main')).toMatchObject({
      ok: false,
      reason: expect.stringContaining('--force-with-lease'),
    })
    expect(await before('git push -f')).toMatchObject({ ok: false })
    expect(await before('git push --force-with-lease origin main')).toEqual({ ok: true })
    const after = (kind: string) =>
      json(
        node!.call(
          '/v1/p/acme-agent/hooks/after-tool',
          post({ ...subject, kind, command: '', succeeded: true, note: '' }),
        ),
      )
    expect((await after('edit')).payload.note).toBe('You changed a file. Run the tests before you finish.')
    expect((await after('read')).payload.note).toBe('')
  })

  it('summarizes the notes with the model the owner picked, and refuses before they pick one', async () => {
    node = await startNode(readExample('acme-agent'), { userId: OWNER })
    await node.call('/v1/p/acme-agent/tools/add-note', post({ arguments: { text: 'Retry with backoff' } }, agent))
    await node.call('/v1/p/acme-agent/tools/add-note', post({ arguments: { text: 'Cap retries at one hour' } }, agent))
    const summarize = () => node!.call('/v1/p/acme-agent/summary', post({ item: TASK }))

    const refused = await summarize()
    expect(refused.status).toBe(409)
    expect((await refused.json()).error.message).toContain('Pick a model for Acme agent kit')

    // A fake model provider, the way a model-provider plugin registers one.
    const prompts: { system: string; prompt: string }[] = []
    const models = makeTestNodeContext({ plugin: { name: 'fake-models' } })
    try {
      const connection = { authKind: 'api-key' as const, fields: [], connectable: true, disconnectable: true }
      models.providers.connection({
        id: 'fake-models',
        label: 'Fake models',
        glyph: 'F',
        kind: 'model-provider',
        connection: {
          ...connection,
          validate: async () => '',
          normalize: () => ({}) as never,
          test: async () => ({ ok: true }),
        },
        capabilities: { textGeneration: true },
        budgets: { maxConcurrentRequests: 1, maxConcurrentRequestsPerConnection: 1 },
        toPublic: () => ({
          id: 'fake-models',
          label: 'Fake models',
          kind: 'model-provider',
          glyph: 'F',
          connection,
          capabilities: { textGeneration: true },
        }),
      } as never)
      models.providers.model({
        providerId: 'fake-models',
        recommendedModelId: 'fake-1',
        generateText: async ({ input }) => {
          prompts.push(input)
          return { text: 'Retry with backoff, for up to an hour.', modelId: 'fake-1', usage: { outputTokens: 9 } }
        },
      })
      // The owner connects it, and picks it for this plugin on its Settings page.
      const id = await connect(node, 'fake-models', 'model-key', '{"textGeneration":"available"}')
      await node.ctx.db.insert(schema.pluginModelGrants).values({
        ownerId: OWNER,
        pluginId: 'acme-agent',
        backendId: `connection:${id}`,
        modelId: '',
        dailyOutputTokens: 10_000,
        updatedAt: 1,
      })

      expect(await json(summarize())).toEqual({ ok: true })
      expect(prompts).toMatchObject([{ prompt: '- Retry with backoff\n- Cap retries at one hour' }])
      const notes = await json(node.call('/v1/p/acme-agent/tools/list-notes', post({ arguments: {} }, agent)))
      expect(notes.notes.at(-1).text).toBe('Summary: Retry with backoff, for up to an hour.')
    } finally {
      models.cleanup()
    }
  })

  it('ships a skill the Node reads', () => {
    const { dir, manifest } = readExample('acme-agent')
    for (const skill of manifest.contributions.skills ?? [])
      expect(readPackageSkill(dir, skill)).toMatchObject({ ok: true })
  })
})

describe('acme-harness', () => {
  const { manifest, dir } = readExample('acme-harness')
  const harness = manifest.contributions.harnesses![0]!
  // The fake `acme-code` is found on PATH, as the real one would be.
  const env = { PATH: `${join(dir, 'test')}:${process.env.PATH ?? ''}` }

  it('speaks the Agent Client Protocol when spawned as the manifest says', async () => {
    const { command, args = [] } = harness.spawn as { command: string; args?: string[] }
    const child = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'inherit'] })
    const said: string[] = []
    const connection = new ClientSideConnection(
      () => ({
        sessionUpdate: async ({ update }) => {
          if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text')
            said.push(update.content.text)
        },
        requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
      }),
      ndJsonStream(
        Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      ),
    )
    try {
      // What acorn's driver sends: every client capability declined but forms.
      await connection.initialize({
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
          elicitation: { form: {} },
        },
      })
      const { sessionId } = await connection.newSession({ cwd: tmpdir(), mcpServers: [] })
      expect(await connection.prompt({ sessionId, prompt: [{ type: 'text', text: 'Hello there' }] })).toEqual({
        stopReason: 'end_turn',
      })
      expect(said).toEqual(['You said: Hello there'])
    } finally {
      child.kill()
    }
  })

  it('passes the conformance script the guide tells an author to run', () => {
    const report = execFileSync(process.execPath, [join(dir, 'test/conformance.mjs')], { env, encoding: 'utf8' })
    expect(report).toBe(
      'ok Acme Code: protocol 1, said "You said: Reply with one word.", stopped: end_turn\n' +
        'ok Acme Code one-shot: "Acme Code (default) read 4 words."\n',
    )
  })

  it('answers one prompt with the argv acorn builds from oneShot', () => {
    const oneShot = harness.oneShot!
    const command = oneShot.command ?? harness.terminal!.command
    // Fixed positions: your args, then the model flag and model when a caller names one, then the
    // system text and the prompt joined by a blank line.
    const argv = [...oneShot.args, oneShot.modelFlag!, 'acme-large', 'Be brief.\n\nSummarize the change']
    expect(execFileSync(command, argv, { env, encoding: 'utf8' })).toBe('Acme Code (acme-large) read 5 words.\n')
  })
})

describe('acme-data', () => {
  type StepKind = { handler(step: object): Promise<{ status: string; structured?: object; error?: string }> }
  /** Workflows opens the point, and reads what plugins put in it. */
  function stepKinds() {
    const workflows = makeTestNodeContext({ plugin: { name: 'workflows' } })
    workflows.extensionPoints.declare('workflows:step-kind', 'Workflow step kinds')
    const kinds = workflows.extensionPoints.handlers<StepKind>('workflows:step-kind')
    workflows.cleanup()
    return kinds
  }

  it('stores deploys in its own database, from a workflow step, and checks them before an archive', async () => {
    node = await startNode(readExample('acme-data'))
    const [step] = stepKinds()
    expect(step).toMatchObject({ id: 'acme-data:record-deploy' })
    const run = (sha: string) =>
      step!.value.handler({ run: { taskId: TASK }, def: { with: { environment: 'staging', sha } } })
    expect(await run('a1b2c3d')).toMatchObject({ status: 'done', structured: { environment: 'staging' } })
    expect(await run('not a sha')).toMatchObject({ status: 'failed' })

    // The CLI command's answer fits the output schema it declares.
    const command = readExample('acme-data').manifest.contributions.cliCommands![0]!
    const listed = await json(node.call('/v1/p/acme-data/cli/deploys', post({ nodeId: 'n1', taskId: TASK })))
    expect(listed.deploys).toMatchObject([{ environment: 'staging', status: 'succeeded', sha: 'a1b2c3d' }])
    expect(validatePluginCliValue(command.outputSchema, listed)).toEqual([])

    // A commit on the task's branch, heard as core's `head:changed`, gets a pending deploy.
    const core = makeTestNodeContext({ plugin: { name: 'core-events' } })
    try {
      core.events.send({
        channel: 'head:changed',
        projectId: 'p1',
        taskId: TASK,
        branch: 'retry',
        head: 'f00dfeed',
        dirty: false,
      })
    } finally {
      core.cleanup()
    }
    expect(
      (await json(node.call('/v1/p/acme-data/cli/deploys', post({ nodeId: 'n1', taskId: TASK })))).deploys[0],
    ).toMatchObject({
      sha: 'f00dfeed',
      status: 'pending',
    })

    const check = () => json(node!.call(`/v1/p/acme-data/archive/check?taskId=${TASK}`))
    expect(await check()).toEqual({ concern: null })
    node.ctx.storage.open().$client.prepare("UPDATE deploys SET status = 'running' WHERE sha = 'f00dfeed'").run()
    expect((await check()).concern).toMatchObject({
      message: '1 Acme deploy is still running for this task',
      details: ['staging f00dfee'],
      action: { label: 'Mark them cancelled', checked: false },
    })
    expect(await json(node.call('/v1/p/acme-data/archive/apply', post({ taskId: TASK })))).toEqual({ ok: true })
    expect(await check()).toEqual({ concern: null })
  })

  it('describes its source with a starter panel that fits it, and pages its records', async () => {
    node = await startNode(readExample('acme-data'))
    const source = { pluginId: 'acme-data', sourceId: 'deploys' }
    const description = dataSourceDescriptionSchema.parse(
      await json(
        node.call('/v1/p/acme-data/source', post({ operation: 'describe', source, scope: { parameters: {} } })),
      ),
    )
    for (const starter of description.starterPlans ?? []) {
      const plan = panelPlanSchema.parse(starter)
      const sources = plan.sources.map((entry) => {
        if (entry.reference.kind !== 'inline') throw new Error('A starter reads its source inline')
        return { instanceId: entry.id, label: entry.label, query: entry.reference.content.query, description }
      })
      expect(validatePanelPlan(plan, sources), plan.title).toEqual([])
    }
    const [step] = stepKinds()
    for (const sha of ['a1b2c3d', 'b2c3d4e', 'c3d4e5f'])
      await step!.value.handler({ run: { taskId: TASK }, def: { with: { environment: 'production', sha } } })
    const query = (cursor?: string) => ({
      operation: 'query',
      mode: 'execution',
      evaluationTime: 1,
      pageSize: 2,
      ...(cursor ? { cursor } : {}),
      query: { source, scope: { parameters: {} }, sort: [] },
    })
    const first = dataSourcePageSchema.parse(await json(node.call('/v1/p/acme-data/source', post(query()))))
    expect(first.records).toHaveLength(2)
    expect(first.records[0]).toMatchObject({ taskId: TASK, data: { environment: 'production', status: 'succeeded' } })
    expect(first.completeness).toEqual({ kind: 'more', cursor: '2' })
    const second = dataSourcePageSchema.parse(await json(node.call('/v1/p/acme-data/source', post(query('2')))))
    expect(second.records).toHaveLength(1)
    expect(second.completeness).toEqual({ kind: 'complete' })
  })

  it('syncs deploys on its schedule with the Acme Cloud key, without storing it', async () => {
    node = await startNode(readExample('acme-data'))
    const deploy = {
      id: 'd-cloud-1',
      taskId: TASK,
      environment: 'production',
      status: 'succeeded',
      sha: 'abc1234',
      at: 5,
    }
    fakeAcmeApi({ '/v1/deploys': { deploys: [deploy] } })
    const sync = () => node!.call('/v1/p/acme-data/schedules/sync', post({ scheduleId: 'sync' }, service))
    // No connection yet: nothing to sync, and the run still succeeds.
    expect(await json(sync())).toEqual({ synced: 0 })
    await connect(node, 'acme-cloud', 'acme-key')
    expect(await json(sync())).toEqual({ synced: 1 })
    expect(
      (await json(node.call('/v1/p/acme-data/cli/deploys', post({ nodeId: 'n1', taskId: TASK })))).deploys,
    ).toMatchObject([{ sha: 'abc1234' }])
    // One span per run, from `ctx.telemetry.startSpan`, which a test reads without a sink of its own.
    expect(node.ctx.recorded.filter((record) => record.kind === 'span')).toMatchObject([
      { name: 'sync-deploys', status: 'ok' },
      { name: 'sync-deploys', status: 'ok' },
    ])
  })
})

describe('acme-browser', () => {
  const issueUrl = 'https://example.com/issues/ACME-12'

  it('matches an issue page and resolves it with the person’s Acme Issues connection', async () => {
    const { manifest } = readExample('acme-browser')
    const handoff = manifest.contributions.browserHandoffs![0]!
    expect(matchHandoffPage(handoff, issueUrl)).toEqual({ key: 'ACME-12' })
    expect(matchHandoffPage(handoff, 'https://example.com/issues')).toBe(null)

    node = await startNode(readExample('acme-browser'))
    const resolve = () =>
      node!.call('/v1/p/acme-browser/browser/issue', post({ url: issueUrl, captures: { key: 'acme-12' } }))
    // Not connected: a 403 with what to do, never a 401, which would ask the person to pair again.
    const refused = await resolve()
    expect(refused.status).toBe(403)
    expect((await refused.json()).error.message).toContain('Connect Acme Issues')

    const connection = await connect(node, 'acme-issues', 'acme-key')
    fakeAcmeApi({
      '/v1/issues/ACME-12': { title: 'Webhooks give up after one retry', description: 'Retry for an hour.' },
    })
    const answer = browserHandoffResolution.parse(await json(resolve()))
    expect(answer.items).toMatchObject([
      {
        identifier: 'ACME-12',
        connection: { id: connection },
        seed: { links: [{ connectionId: connection, identifier: 'ACME-12', ref: { url: issueUrl } }] },
      },
    ])
  })

  it('lists a task’s app and its panel only while the app runs', async () => {
    node = await startNode(readExample('acme-browser'))
    const addresses = async () =>
      taskAddressList.parse(await json(node!.call('/v1/p/acme-browser/task-addresses'))).addresses
    const panel = () => node!.call(`/v1/p/acme-browser/browser-panel?taskId=${TASK}`)
    expect(await addresses()).toEqual([])
    expect((await panel()).status).toBe(404)

    const core = makeTestNodeContext({ plugin: { name: 'core-events' } })
    try {
      core.events.send({ channel: 'run:changed', taskId: TASK, targetId: 'web', running: true })
      expect(await addresses()).toEqual([
        {
          taskId: TASK,
          origin: 'https://acme-5b0d7c39.localhost:5173',
          label: 'Acme app',
          state: 'running',
          severity: 'info',
        },
      ])
      expect(browserPanelView.parse(await json(panel())).blocks.map((block) => block.kind)).toEqual(['status', 'links'])
      // An agent's task credential never reads the extension's routes.
      expect((await node.call('/v1/p/acme-browser/task-addresses', { principal: agent })).status).toBe(403)
      core.events.send({ channel: 'run:changed', taskId: TASK, targetId: 'web', running: false })
      expect(await addresses()).toEqual([])
    } finally {
      core.cleanup()
    }
  })
})

describe('acme-readiness', () => {
  it('passes its own test, builds, and serves its source from the packed SDK outside the repository', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acme-readiness-'))
    try {
      cpSync(join(EXAMPLES, 'acme-readiness'), dir, { recursive: true })
      const modules = join(dir, 'node_modules')
      unpackPublishedPackage('plugin-sdk', join(modules, 'acorn-plugin-sdk'))
      unpackPublishedPackage('plugin-types', join(modules, 'acorn-plugin-types'))
      copyNodeTypes(modules)
      for (const tool of ['vite', 'vitest']) linkTool(tool, modules)
      const node_ = (...args: string[]) => run(process.execPath, args, dir)
      expect(node_('node_modules/vitest/vitest.mjs', 'run')).toMatch(/1 passed/)
      node_(TSC, '--noEmit')
      node_('node_modules/vite/bin/vite.js', 'build', '--logLevel', 'error')
      // The build writes the manifest's source entry from the code, and the committed one already matches.
      node_('scripts/manifest.mjs')
      expect(readFileSync(join(dir, 'acorn-plugin.json'), 'utf8')).toBe(
        readFileSync(join(EXAMPLES, 'acme-readiness/acorn-plugin.json'), 'utf8'),
      )

      node = await startNode({ ...readExample('acme-readiness'), dir })
      const description = await json(
        node.call(
          '/v1/p/acme-readiness/source',
          post({
            operation: 'describe',
            source: { pluginId: 'acme-readiness', sourceId: 'acme-readiness' },
            scope: { parameters: {} },
          }),
        ),
      )
      expect(description.fields.map((field: { pointer: string }) => field.pointer)).toEqual([
        '/title',
        '/stage',
        '/deploys',
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120_000)
})
