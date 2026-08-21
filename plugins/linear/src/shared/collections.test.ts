import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { validatePluginConfig } from '@acorn/plugin-api/testkit'
import { pluginCollectionResponseSchema } from '@acorn/protocol/collections.ts'
import type { LinearProjectIssue } from './api'
import { LINEAR_ISSUES_COLLECTION_ID, linearIssuesCollection } from './collections'

const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url))

const issue = (over: Partial<LinearProjectIssue> = {}): LinearProjectIssue => ({
  identifier: 'ENG-42',
  title: 'Fix the checkout',
  url: 'https://linear.app/acme/issue/ENG-42',
  state: { name: 'In Review', type: 'started', color: '#f2c94c' },
  assignee: 'Ada',
  integrationId: 'conn-1',
  branchName: 'ada/eng-42',
  priority: 1,
  priorityLabel: 'Urgent',
  updatedAt: 1_700_000_000_000,
  labels: [],
  ...over,
})

describe('linear as a collection', () => {
  it('answers a page the host schema accepts', () => {
    // Half of the phase-1 acceptance test: one field vocabulary has to fit both providers. This is the
    // Linear half; plugins/github/src/contract/collections.test.ts is the other.
    const parsed = pluginCollectionResponseSchema.safeParse(linearIssuesCollection([issue()]))
    expect(parsed.success).toBe(true)
  })

  it('groups by the state TYPE and labels the group with the workspace\'s own name', () => {
    // The one place Linear strains the vocabulary, and the place self-describing responses pay for
    // themselves (docs/dashboards.md § Self-describing responses, and the cold case).
    const page = linearIssuesCollection([issue(), issue({ identifier: 'ENG-9', state: { name: 'Shipped', type: 'completed', color: '#0f0' } })])
    expect(page.rows.map((row) => row.values.status)).toEqual(['started', 'completed'])
    const status = page.schema.fields.find((field) => field.role === 'status')
    expect(status?.values?.map((value) => [value.id, value.label])).toEqual([
      ['triage', 'Triage'],
      ['backlog', 'Backlog'],
      ['unstarted', 'Todo'],
      ['started', 'In Review'],
      ['completed', 'Shipped'],
      ['canceled', 'Cancelled'],
    ])
  })

  it('carries the connection in the row id, because a Linear identifier is not globally unique', () => {
    // Two connected workspaces can share a team prefix, so `ENG-42` alone would make one issue evict
    // the other on a board that dedupes by row id.
    expect(linearIssuesCollection([issue()]).rows[0]?.id).toBe('conn-1:ENG-42')
  })

  it('declares the collection in the manifest, at the route the router mounts', async () => {
    // A manifest change does nothing until the package is rebuilt, so this is the check that the
    // declaration and the route agree at test time rather than at somebody's next boot.
    const config = await validatePluginConfig(PACKAGE_ROOT)
    expect(config.ok, config.ok ? '' : config.reason).toBe(true)
    const declared = config.ok ? config.manifest.contributions.collections : []
    expect(declared.map((entry) => entry.items)).toEqual([`/v2/p/linear/collections/${LINEAR_ISSUES_COLLECTION_ID}`])
    // No static schema on purpose: the workspace's own state names are not knowable at build time.
    expect(declared[0]?.schema).toBeUndefined()
  })
})
