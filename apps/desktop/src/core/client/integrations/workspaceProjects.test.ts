import { describe, expect, it } from 'vitest'
import type { Integration, WorkspaceProject } from '../../shared/api'
import { replaceWorkspaceProjectsForProvider, workspaceProjectsForProvider } from './workspaceProjects'

const integration = (id: string, providerId: string): Integration => ({
  id,
  providerId,
  label: id,
  status: 'connected',
  authKind: 'api-key',
  account: null,
  scopes: [],
  capabilities: {},
  createdAt: 1,
  updatedAt: 1,
})

const integrations = [integration('linear-a', 'linear'), integration('rollbar-a', 'rollbar')]
const projects: WorkspaceProject[] = [
  { integrationId: 'linear-a', externalId: 'linear-project' },
  { integrationId: 'rollbar-a', externalId: 'rollbar-project' },
]

describe('provider-owned workspace project mappings', () => {
  it('selects only mappings belonging to the requested provider', () => {
    expect(workspaceProjectsForProvider(projects, integrations, 'rollbar')).toEqual([
      { integrationId: 'rollbar-a', externalId: 'rollbar-project' },
    ])
  })

  it('replaces one provider without deleting sibling-provider mappings', () => {
    expect(replaceWorkspaceProjectsForProvider(projects, integrations, 'rollbar', [
      { integrationId: 'rollbar-a', externalId: 'rollbar-project-2' },
    ])).toEqual([
      { integrationId: 'linear-a', externalId: 'linear-project' },
      { integrationId: 'rollbar-a', externalId: 'rollbar-project-2' },
    ])
  })
})
