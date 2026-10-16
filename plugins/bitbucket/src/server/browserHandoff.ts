import { truncateBytes, type CoreServices, type PluginDatabase, type PluginFetchHandler } from '@acorn/plugin-api/node'
import type { BrowserHandoffResolution } from '@acorn/protocol/plugin/handoffs.ts'
import type { PullRequestDetail } from '../shared/api'
import { formatPullRequestRef, pullRequestUrl, sameRepository } from '../shared/pullRequestRef'
import { BITBUCKET_PROVIDER } from './bitbucketApi'
import { pullRequestDetail } from './mirror/detail'
import { resolveRepository } from './mirror/repositories'
import type { BitbucketEmit } from './events'

// The route behind the pull request button the browser extension draws on bitbucket.org
// (docs/plugin-authoring/browser-handoffs.md). The extension matches the page with the plugin's
// pattern; this reads the pull request through the mirror and says which projects track its
// repository.

// The description is the author's text. The agent reads it in the extension's context block, which
// marks it as captured material; this keeps it to a size worth reading in a draft.
const BODY_MAX_BYTES = 8_000

type HandoffCore = { projects: Pick<CoreServices['projects'], 'checkouts' | 'byId'> }

export function createBrowserHandoffHandler(
  db: PluginDatabase,
  core: HandoffCore,
  emit: BitbucketEmit,
): PluginFetchHandler {
  return async (request, context) => {
    if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 })
    const body = (await request.json().catch(() => null)) as { captures?: Record<string, unknown> } | null
    const workspace = text(body?.captures?.workspace)
    const repo = text(body?.captures?.repo)
    const number = Number(body?.captures?.number)
    if (!workspace || !repo || !Number.isSafeInteger(number) || number <= 0)
      return refusal(400, 'bad_request', 'That address is not a Bitbucket pull request.')
    const asked = formatPullRequestRef(`${workspace}/${repo}`, number)

    const failures: string[] = []
    const answers = await context.providers.withConnections(BITBUCKET_PROVIDER, async (connection, auth) => {
      if (connection.status !== 'connected') return undefined
      const session = { auth }
      const repository = await resolveRepository(session, db, connection.id, `${workspace}/${repo}`)
      if (!repository.ok) {
        failures.push(repository.failure.error)
        return undefined
      }
      const key = { connectionId: connection.id, repository: repository.value.repo, number }
      const read = await pullRequestDetail(session, db, key, { emit })
      if (!read.ok || !read.value.request) {
        failures.push(read.ok ? 'not_found' : read.failure.error)
        return undefined
      }
      return { connection, path: repository.value.path, detail: read.value }
    })
    if (!answers.length)
      return failures.length
        ? refusal(404, 'not_found', `Bitbucket couldn't show ${asked} to the connected account (${failures[0]}).`)
        : refusal(403, 'provider_not_connected', 'Connect Bitbucket in Acorn to open its pull requests here.')

    const items: BrowserHandoffResolution['items'] = []
    for (const { connection, path, detail } of answers) {
      const pull = detail.request!
      const identifier = formatPullRequestRef(path, number)
      const url = pullRequestUrl(path, number)
      const title = pull.title.slice(0, 300) || identifier
      items.push({
        identifier,
        url,
        title,
        connection: { id: connection.id, label: connection.name ?? connection.label },
        projects: await projectsTracking(core, path),
        // The pull request becomes the task's primary change request, checked out from its source
        // branch, on its fork when it has one. The link names its page, so the extension finds the
        // task from the pull request's address.
        seed: {
          origin: 'bitbucket-pr',
          title,
          ...(pull.headRef ? { branch: pull.headRef } : {}),
          changeRequest: {
            number,
            ...(pull.headRef ? { sourceBranch: pull.headRef } : {}),
            ...(detail.sourceRepository ? { sourceRepository: detail.sourceRepository } : {}),
          },
          links: [{ connectionId: connection.id, identifier, ref: { displayId: identifier, url } }],
        },
        context: {
          label: `Bitbucket pull request ${identifier}`.slice(0, 200),
          content: pullRequestContext(identifier, url, detail),
        },
      })
    }
    return Response.json({ items } satisfies BrowserHandoffResolution)
  }
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const refusal = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status })

function pullRequestContext(identifier: string, url: string, detail: PullRequestDetail): string {
  const pull = detail.request!
  const state = pull.draft ? `${pull.state}, draft` : pull.state
  const lines = [
    `${identifier}: ${pull.title}`,
    url,
    `State: ${state}${pull.author ? ` · opened by ${pull.author}` : ''}`,
  ]
  if (pull.headRef && pull.baseRef)
    lines.push(
      `Branches: ${detail.sourceRepository ? `${detail.sourceRepository}:` : ''}${pull.headRef} into ${pull.baseRef}`,
    )
  const description = pull.body?.trim()
  if (description) lines.push('', truncateBytes(description, BODY_MAX_BYTES))
  return lines.join('\n')
}

// Every project whose repository is this one. A person with two checkouts of one repository has to be
// able to choose, so this reads each project's facet rather than the oldest.
async function projectsTracking(core: HandoffCore, path: string): Promise<string[]> {
  const refs = await Promise.all((await core.projects.checkouts()).map((checkout) => core.projects.byId(checkout.id)))
  return refs.flatMap((ref) =>
    ref?.repository?.provider === BITBUCKET_PROVIDER && sameRepository(ref.repository.path, path) ? [ref.id] : [],
  )
}
