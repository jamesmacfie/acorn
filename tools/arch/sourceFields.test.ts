import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type { DataSourceDescription, DataSourceRegistration } from '../../packages/protocol/src/data/dataSources.ts'
import { registeredDataSource } from '../../packages/node-core/src/server/dataSources/registry.ts'
import '../../packages/node-core/src/server/dataSources/coreTasks.ts'
import '../../packages/node-core/src/server/dataSources/localGitRegistration.ts'
import { sessionSource, sessionSourceDescription } from '../../plugins/agents/src/shared/sessionSource.ts'
import { usageSource } from '../../plugins/agents/src/shared/usageRegistration.ts'
import { usageSourceDescription } from '../../plugins/agents/src/shared/usageSource.ts'
import { actionsSource } from '../../plugins/github/src/shared/actionsRegistration.ts'
import { actionsSourceDescription } from '../../plugins/github/src/shared/actionsSource.ts'
import { branchSource } from '../../plugins/github/src/shared/branchSource.ts'
import { pullSource } from '../../plugins/github/src/shared/pullSource.ts'
import { pullSourceDescription } from '../../plugins/github/src/shared/pullSourceDescription.ts'
import { branchDescription } from '../../plugins/github/src/server/data/branchSourceHandler.ts'
import { issueSource, issueSourceDescription } from '../../plugins/linear/src/shared/issueSource.ts'
import { errorSource, errorSourceDescription } from '../../plugins/rollbar/src/shared/errorSource.ts'

// The field lists `fixtures()` in acorn-plugin-sdk/testing builds test records from
// (docs/plugin-authoring/testing.md § Test a derived source). They're checked in, so a change to a
// built-in or first-party source's fields shows up as a diff in review, and an author's tests fail the
// same way the app would. Each list is what that source's describe answers. Regenerate with
// `UPDATE_SOURCE_FIELDS=1 pnpm --filter @acorn/arch-tests test sourceFields`.
const FILE = join(import.meta.dirname, '../../packages/plugin-sdk/src/testing/sourceFields.json')

async function core(sourceId: string): Promise<[DataSourceRegistration, DataSourceDescription]> {
  const source = registeredDataSource({ pluginId: 'core', sourceId })
  if (!source?.coreHandler) throw new Error(`core:${sourceId} isn't registered`)
  const description = await source.coreHandler({ operation: 'describe', source: { pluginId: 'core', sourceId }, scope: { parameters: {} } },
    {} as never, new AbortController().signal) as DataSourceDescription
  return [source, description]
}

async function fieldLists() {
  const localBranches = await core('local-branches')
  const sources: Record<string, [DataSourceRegistration, DataSourceDescription]> = {
    'core:tasks': await core('tasks'),
    'core:local-branches': localBranches,
    'core:local-worktrees': await core('local-worktrees'),
    'agents:sessions': [sessionSource, sessionSourceDescription],
    'agents:usage-records': [usageSource, usageSourceDescription],
    'github:pull-requests': [pullSource, pullSourceDescription],
    'github:actions-jobs': [actionsSource, actionsSourceDescription],
    'github:local-branches': [branchSource, branchDescription(localBranches[1])],
    'linear:issues': [issueSource, issueSourceDescription],
    'rollbar:error-groups': [errorSource, errorSourceDescription],
  }
  return Object.fromEntries(Object.entries(sources).sort(([a], [b]) => a.localeCompare(b)).map(([id, [registration, description]]) =>
    [id, { name: registration.name, schema: description.schema, fields: description.fields }]))
}

it('keeps the SDK field lists equal to what each source describes', async () => {
  const actual = `${JSON.stringify(await fieldLists(), null, 2)}\n`
  if (process.env.UPDATE_SOURCE_FIELDS) writeFileSync(FILE, actual)
  expect(readFileSync(FILE, 'utf8'), 'Run UPDATE_SOURCE_FIELDS=1 pnpm --filter @acorn/arch-tests test sourceFields').toBe(actual)
})
