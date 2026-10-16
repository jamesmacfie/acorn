import { truncateBytes, type CoreServices, type PluginDatabase, type PluginFetchHandler } from '@acorn/plugin-api/node'
import type { BrowserHandoffResolution } from '@acorn/protocol/plugin/handoffs.ts'
import { formatMergeRequestRef, mergeRequestUrl, samePath } from '../shared/mergeRequestRef'
import { GITLAB_PROVIDER } from './gitlabApi'
import { mergeRequestDetail } from './mirror/detail'
import { resolveProject } from './mirror/projects'
import type { GitlabEmit } from './events'

// The route behind the merge request button the browser extension draws on gitlab.com
// (docs/plugin-authoring/browser-handoffs.md). The extension matches the page with the plugin's
// `{path+}` pattern; this reads the merge request through the mirror with each GitLab connection's own
// credential, and says which projects track its repository.

// The description is the author's text. The agent reads it in the extension's context block, which
// marks it as captured material; this keeps it to a size worth reading in a draft.
const BODY_MAX_BYTES = 8_000

type HandoffCore = { projects: Pick<CoreServices['projects'], 'checkouts' | 'byId'> }

export function createBrowserHandoffHandler(
  db: PluginDatabase,
  core: HandoffCore,
  emit: GitlabEmit,
): PluginFetchHandler {
  return async (request, context) => {
    if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 })
    const body = (await request.json().catch(() => null)) as { captures?: Record<string, unknown> } | null
    const path = text(body?.captures?.path)
    const number = Number(body?.captures?.number)
    if (!path || !Number.isSafeInteger(number) || number <= 0)
      return refusal(400, 'bad_request', 'That address is not a GitLab merge request.')

    // Each connection reads with its own credential, so two accounts that both see the merge request
    // answer as two items.
    const failures: string[] = []
    const answers = await context.providers.withConnections(GITLAB_PROVIDER, async (connection, token) => {
      if (connection.status !== 'connected') return undefined
      const session = { token }
      const project = await resolveProject(session, db, context.userId, path)
      if (!project.ok) {
        failures.push(project.failure.error)
        return undefined
      }
      const key = { userId: context.userId, projectId: project.value.id, path: project.value.path, iid: number }
      const read = await mergeRequestDetail(session, db, key, { emit })
      if (!read.ok || !read.value.request) {
        failures.push(read.ok ? 'not_found' : read.failure.error)
        return undefined
      }
      return { connection, path: project.value.path, request: read.value.request }
    })
    if (!answers.length)
      return failures.length
        ? refusal(
            404,
            'not_found',
            `GitLab couldn't show ${formatMergeRequestRef(path, number)} to the connected account (${failures[0]}).`,
          )
        : refusal(403, 'provider_not_connected', 'Connect GitLab in Acorn to open merge requests from the browser.')

    const items: BrowserHandoffResolution['items'] = []
    for (const { connection, path: canonical, request: mergeRequest } of answers) {
      const identifier = formatMergeRequestRef(canonical, number)
      const url = mergeRequestUrl(canonical, number)
      const title = mergeRequest.title.slice(0, 300) || identifier
      items.push({
        identifier,
        url,
        title,
        connection: { id: connection.id, label: connection.name ?? connection.label },
        projects: await projectsTracking(core, canonical),
        // The merge request becomes the task's primary change request. The link names its page, so the
        // extension finds the task from the merge request's address.
        seed: {
          origin: 'gitlab-mr',
          title,
          ...(mergeRequest.headRef ? { branch: mergeRequest.headRef } : {}),
          changeRequest: { number },
          links: [{ connectionId: connection.id, identifier, ref: { displayId: identifier, url } }],
        },
        context: {
          label: `GitLab merge request ${identifier}`.slice(0, 200),
          content: mergeRequestContext(identifier, url, mergeRequest),
        },
      })
    }
    return Response.json({ items } satisfies BrowserHandoffResolution)
  }
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const refusal = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status })

type Request = {
  title: string
  state: string
  draft: boolean
  author: string | null
  headRef: string | null
  baseRef: string | null
  body: string | null
}

function mergeRequestContext(identifier: string, url: string, request: Request): string {
  const state = request.draft ? `${request.state}, draft` : request.state
  const lines = [
    `${identifier}: ${request.title}`,
    url,
    `State: ${state}${request.author ? ` · opened by @${request.author}` : ''}`,
  ]
  if (request.headRef && request.baseRef) lines.push(`Branches: ${request.headRef} into ${request.baseRef}`)
  const description = request.body?.trim()
  if (description) lines.push('', truncateBytes(description, BODY_MAX_BYTES))
  return lines.join('\n')
}

// Every project whose repository is this one on gitlab.com. A person with two checkouts of one
// repository has to be able to choose, so this reads each project's facet rather than the oldest.
async function projectsTracking(core: HandoffCore, path: string): Promise<string[]> {
  const refs = await Promise.all((await core.projects.checkouts()).map((checkout) => core.projects.byId(checkout.id)))
  return refs.flatMap((ref) =>
    ref?.repository?.provider === GITLAB_PROVIDER && samePath(ref.repository.path, path) ? [ref.id] : [],
  )
}
