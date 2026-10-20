import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type { DataSourceDescription, DataSourceRegistration } from '../../packages/protocol/src/data/dataSources.ts'
import { registeredDataSource } from '../../packages/node-core/src/server/dataSources/registry.ts'
import '../../packages/node-core/src/server/dataSources/coreTasks.ts'
import '../../packages/node-core/src/server/dataSources/localGitRegistration.ts'
import '../../packages/node-core/src/server/dataSources/coreSchedulesRegistration.ts'
import { approvalSourceDescription } from '../../plugins/agents/src/shared/approvalSource.ts'
import { sessionSource, sessionSourceDescription } from '../../plugins/agents/src/shared/sessionSource.ts'
import { sessionTotalsSourceDescription } from '../../plugins/agents/src/shared/sessionTotalsSource.ts'
import {
  approvalSource,
  sessionTotalsSource,
  toolCallSource,
  turnSource,
  usageSource,
} from '../../plugins/agents/src/shared/sourceRegistrations.ts'
import { toolCallSourceDescription } from '../../plugins/agents/src/shared/toolCallSource.ts'
import { turnSourceDescription } from '../../plugins/agents/src/shared/turnSource.ts'
import { usageSourceDescription } from '../../plugins/agents/src/shared/usageSource.ts'
import { commitSourceDescription } from '../../plugins/git/src/shared/commitSource.ts'
import { commitSource } from '../../plugins/git/src/shared/sourceRegistrations.ts'
import { codeMatchSourceDescription } from '../../plugins/editor/src/shared/codeMatchSource.ts'
import { codeMatchSource } from '../../plugins/editor/src/shared/sourceRegistrations.ts'
import { actionsSource } from '../../plugins/github/src/shared/actionsRegistration.ts'
import { actionsSourceDescription } from '../../plugins/github/src/shared/actionsSource.ts'
import { branchSource } from '../../plugins/github/src/shared/branchSource.ts'
import { issueSource as githubIssueSource } from '../../plugins/github/src/shared/issueSource.ts'
import { issueSourceDescription as githubIssueSourceDescription } from '../../plugins/github/src/shared/issueSourceDescription.ts'
import { pullSource } from '../../plugins/github/src/shared/pullSource.ts'
import { pullSourceDescription } from '../../plugins/github/src/shared/pullSourceDescription.ts'
import { branchDescription } from '../../plugins/github/src/server/data/branchSourceHandler.ts'
import { reviewCommentSource as githubReviewCommentSource } from '../../plugins/github/src/shared/reviewCommentSource.ts'
import { reviewCommentSourceDescription as githubReviewCommentSourceDescription } from '../../plugins/github/src/shared/reviewCommentSourceDescription.ts'
import { reviewCommentSource as gitlabReviewCommentSource } from '../../plugins/gitlab/src/shared/sources.ts'
import { reviewCommentSourceDescription as gitlabReviewCommentSourceDescription } from '../../plugins/gitlab/src/server/data/sourceDescriptions.ts'
import { reviewCommentSource as bitbucketReviewCommentSource } from '../../plugins/bitbucket/src/shared/sources.ts'
import { reviewCommentSourceDescription as bitbucketReviewCommentSourceDescription } from '../../plugins/bitbucket/src/server/data/sourceDescriptions.ts'
import { cycleSource, cycleSourceDescription } from '../../plugins/linear/src/shared/cycleSource.ts'
import { issueSource, issueSourceDescription } from '../../plugins/linear/src/shared/issueSource.ts'
import { projectSource, projectSourceDescription } from '../../plugins/linear/src/shared/projectSource.ts'
import { memorySourceDescription } from '../../plugins/memory/src/shared/memorySource.ts'
import { memorySource } from '../../plugins/memory/src/shared/memorySourceRegistration.ts'
import { errorSource, errorSourceDescription } from '../../plugins/rollbar/src/shared/errorSource.ts'
import {
  occurrenceCountSource,
  occurrenceCountSourceDescription,
} from '../../plugins/rollbar/src/shared/occurrenceCountSource.ts'
import { runSourceDescription as terminalRunSourceDescription } from '../../plugins/terminal/src/shared/runSource.ts'
import { runSource as terminalRunSource } from '../../plugins/terminal/src/shared/sourceRegistrations.ts'
import { runSourceDescription } from '../../plugins/workflows/src/shared/runSource.ts'
import { runSource } from '../../plugins/workflows/src/shared/runSourceRegistration.ts'

// The field lists `fixtures()` in acorn-plugin-sdk/testing builds test records from
// (docs/plugin-authoring/testing.md § Test a derived source). They're checked in, so a change to a
// built-in or first-party source's fields shows up as a diff in review, and an author's tests fail the
// same way the app would. Each list is what that source's describe answers. Regenerate with
// `UPDATE_SOURCE_FIELDS=1 pnpm --filter @acorn/arch-tests test sourceFields`.
const FILE = join(import.meta.dirname, '../../packages/plugin-sdk/src/testing/sourceFields.json')

async function core(sourceId: string): Promise<[DataSourceRegistration, DataSourceDescription]> {
  const source = registeredDataSource({ pluginId: 'core', sourceId })
  if (!source?.coreHandler) throw new Error(`core:${sourceId} isn't registered`)
  const description = (await source.coreHandler(
    { operation: 'describe', source: { pluginId: 'core', sourceId }, scope: { parameters: {} } },
    {} as never,
    new AbortController().signal,
  )) as DataSourceDescription
  return [source, description]
}

async function fieldLists() {
  const localBranches = await core('local-branches')
  const sources: Record<string, [DataSourceRegistration, DataSourceDescription]> = {
    'core:tasks': await core('tasks'),
    'core:local-branches': localBranches,
    'core:local-worktrees': await core('local-worktrees'),
    'core:schedules': await core('schedules'),
    'agents:sessions': [sessionSource, sessionSourceDescription],
    'agents:usage-records': [usageSource, usageSourceDescription],
    'agents:turns': [turnSource, turnSourceDescription],
    'agents:session-totals': [sessionTotalsSource, sessionTotalsSourceDescription],
    'agents:tool-calls': [toolCallSource, toolCallSourceDescription],
    'agents:approvals': [approvalSource, approvalSourceDescription],
    'editor:code-matches': [codeMatchSource, codeMatchSourceDescription],
    'git:commits': [commitSource, commitSourceDescription],
    'github:pull-requests': [pullSource, pullSourceDescription],
    'github:actions-jobs': [actionsSource, actionsSourceDescription],
    'github:issues': [githubIssueSource, githubIssueSourceDescription],
    'github:local-branches': [branchSource, branchDescription(localBranches[1])],
    'github:review-comments': [githubReviewCommentSource, githubReviewCommentSourceDescription],
    'gitlab:review-comments': [gitlabReviewCommentSource, gitlabReviewCommentSourceDescription],
    'bitbucket:review-comments': [bitbucketReviewCommentSource, bitbucketReviewCommentSourceDescription],
    'linear:cycles': [cycleSource, cycleSourceDescription],
    'linear:issues': [issueSource, issueSourceDescription],
    'linear:projects': [projectSource, projectSourceDescription],
    'memory:memories': [memorySource, memorySourceDescription],
    'rollbar:error-groups': [errorSource, errorSourceDescription],
    'rollbar:occurrence-counts': [occurrenceCountSource, occurrenceCountSourceDescription],
    'terminal:runs': [terminalRunSource, terminalRunSourceDescription],
    'workflows:runs': [runSource, runSourceDescription],
  }
  return Object.fromEntries(
    Object.entries(sources)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, [registration, description]]) => [
        id,
        { name: registration.name, schema: description.schema, fields: description.fields },
      ]),
  )
}

it('keeps the SDK field lists equal to what each source describes', async () => {
  const actual = `${JSON.stringify(await fieldLists(), null, 2)}\n`
  if (process.env.UPDATE_SOURCE_FIELDS) writeFileSync(FILE, actual)
  expect(
    readFileSync(FILE, 'utf8'),
    'Run UPDATE_SOURCE_FIELDS=1 pnpm --filter @acorn/arch-tests test sourceFields',
  ).toBe(actual)
})
