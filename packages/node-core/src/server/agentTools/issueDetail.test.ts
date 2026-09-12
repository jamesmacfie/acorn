import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestDb, type TestDb } from '../../testkit/db'
import { defaultBudgets, publicProvider } from '../integrations/providerShared'
import { connectionProviderRegistry } from '../integrations/connectionRegistry'
import { integrationProviderRegistry } from '../integrations/registry'
import { schema } from '../db'
import { ToolError } from './registry'
import { issueDetailTool } from './issueDetail'
import type { IntegrationProviderContribution, ProviderItemDetail } from '../integrations/types'

// A provider that answers from memory. The point of these tests is the loop over an owner's
// connections, not the resource runtime, which has its own suite.
const fakeProvider = (id: string, detail?: ProviderItemDetail): IntegrationProviderContribution =>
  publicProvider({
    id,
    label: id === 'tracker' ? 'Tracker' : id,
    glyph: 'brand:linear',
    kind: 'issue-tracker',
    connection: { authKind: 'api-key', connectable: true, disconnectable: true, fields: [], validate: async () => ({}), normalize: () => ({}), test: async () => ({ ok: true }) },
    capabilities: {},
    externalIds: { fromDisplay: (connectionId: string, displayId: string) => ({ providerId: id, connectionId, displayId }), parse: () => null },
    resources: [],
    budgets: defaultBudgets,
    memory: {},
    detail,
  } as never)

const ctx = { taskId: 'task-1', userLogin: 'owner' }

async function connect(db: TestDb, id: string, provider: string, status = 'connected'): Promise<void> {
  await db.db.insert(schema.integrations).values({
    id, userId: 'owner', provider, status, authRef: `secret:${id}`, label: id, createdAt: 1, updatedAt: 1,
  } as never)
}

describe('issue_detail', () => {
  let db: TestDb

  beforeEach(() => {
    db = makeTestDb()
  })

  afterEach(() => {
    connectionProviderRegistry.removeForPlugin('test')
    integrationProviderRegistry.removeForPlugin('test')
    db.cleanup()
  })

  const register = (provider: IntegrationProviderContribution) => {
    connectionProviderRegistry.register(provider, 'test')
    integrationProviderRegistry.register(provider, 'test')
  }

  it('asks each connection in turn and returns the first that has the item', async () => {
    const asked: string[] = []
    register(fakeProvider('tracker', async (_context, identifier) => {
      asked.push(identifier)
      return asked.length === 1 ? null : { identifier, description: 'the brief' }
    }))
    await connect(db, 'conn-a', 'tracker')
    await connect(db, 'conn-b', 'tracker')

    await expect(issueDetailTool({ db: db.db, secrets: db.secrets }).handler({ identifier: 'ENG-42' }, ctx)).resolves.toEqual({
      provider: 'tracker',
      connectionId: 'conn-b',
      identifier: 'ENG-42',
      detail: { identifier: 'ENG-42', description: 'the brief' },
    })
    expect(asked).toEqual(['ENG-42', 'ENG-42'])
  })

  it('skips a connection the owner disabled or that needs re-auth', async () => {
    const asked: string[] = []
    register(fakeProvider('tracker', async (_context, identifier) => {
      asked.push(identifier)
      return { identifier }
    }))
    await connect(db, 'conn-off', 'tracker', 'disabled')
    await connect(db, 'conn-stale', 'tracker', 'needs-auth')

    await expect(issueDetailTool({ db: db.db, secrets: db.secrets }).handler({ identifier: 'ENG-42' }, ctx))
      .rejects.toThrow(/no connected tracker workspace has 'ENG-42'/i)
    expect(asked).toEqual([])
  })

  // A 401 from the one workspace that owns the ticket must not read as "no such ticket", which is
  // what every other connection legitimately answers.
  it('reports a provider refusal rather than not-found', async () => {
    register(fakeProvider('tracker', async () => {
      throw new Error('provider_needs_auth')
    }))
    await connect(db, 'conn-a', 'tracker')

    await expect(issueDetailTool({ db: db.db, secrets: db.secrets }).handler({ identifier: 'ENG-42' }, ctx))
      .rejects.toThrow('provider_needs_auth')
  })

  it('is unavailable, and refuses a named provider, when nothing can return detail', async () => {
    register(fakeProvider('summaries-only'))
    const tool = issueDetailTool({ db: db.db, secrets: db.secrets })

    expect(await tool.when?.(ctx)).toBe(false)
    await expect(tool.handler({ identifier: 'ENG-42', provider: 'summaries-only' }, ctx)).rejects.toThrow(ToolError)
    await expect(tool.handler({ identifier: 'ENG-42', provider: 'nope' }, ctx)).rejects.toThrow(/No such provider/)
  })
})
