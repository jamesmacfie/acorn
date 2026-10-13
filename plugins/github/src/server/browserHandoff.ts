import { truncateBytes, type PluginDatabase, type PluginFetchHandler, type RouteResult } from '@acorn/plugin-api/node'
import type { BrowserHandoffResolution } from '@acorn/protocol/plugin/handoffs.ts'
import { and, eq } from 'drizzle-orm'
import { repos } from '../node/schema'
import { formatPullRef } from '../shared/pullRef'
import type { PullDetail } from '../shared/api'
import { readPullDetail } from './routes/pulls/pullDetail'
import { GITHUB_PROVIDER } from './githubToken'
import { repoMatches } from './repoMatch'
import type { GithubEmit } from './events'

// The route behind the pull request button the browser extension draws on github.com
// (docs/github-integration/tasks-and-references.md § Browser handoff). The plugin declares the button
// in its entry. The extension matches the page; this route reads the pull request through the same
// mirror the PR pane uses, with each GitHub connection's own credential, and says which projects track
// its repository.

// The pull request body is the author's text. The agent reads it inside the extension's context block,
// which marks it as captured material; this keeps it to a size worth reading in a draft.
const BODY_MAX_BYTES = 8_000

type Pull = NonNullable<PullDetail['pull']>
// One pull request as one connection sees it, with the repository in GitHub's own spelling.
type ReadPull = (request: {
  token: string
  userId: string
  owner: string
  repo: string
  number: number
}) => Promise<RouteResult<{ owner: string; name: string; pull: Pull }>>

export function createBrowserHandoffHandler(dependencies: {
  readPull: ReadPull
  // Every project whose GitHub facet names this repository.
  projectsForRepo(owner: string, name: string): Promise<string[]>
}): PluginFetchHandler {
  return async (request, context) => {
    if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 })
    const body = (await request.json().catch(() => null)) as { captures?: Record<string, unknown> } | null
    const owner = text(body?.captures?.owner)
    const repo = text(body?.captures?.repo)
    const number = Number(body?.captures?.number)
    if (!owner || !repo || !Number.isSafeInteger(number) || number <= 0)
      return refusal(400, 'bad_request', 'That address is not a GitHub pull request.')

    // Each connection reads with its own credential, so two accounts that can both see the pull
    // request answer as two items, and the person picks one.
    const failures: string[] = []
    const answers = await context.providers.withConnections(GITHUB_PROVIDER, async (connection, token) => {
      if (connection.status !== 'connected') return undefined
      const read = await dependencies.readPull({ token, userId: context.userId, owner, repo, number })
      if (read.ok) return { connection, ...read.value }
      failures.push(read.failure.error)
      return undefined
    })
    if (!answers.length)
      return failures.length
        ? refusal(
            404,
            'not_found',
            `GitHub couldn't show ${formatPullRef(owner, repo, number)} to the connected account (${failures[0]}).`,
          )
        : refusal(403, 'provider_not_connected', 'Connect GitHub in Acorn to open pull requests from the browser.')

    const items: BrowserHandoffResolution['items'] = []
    for (const { connection, owner: canonicalOwner, name, pull } of answers) {
      const identifier = formatPullRef(canonicalOwner, name, pull.number)
      const url = `https://github.com/${canonicalOwner}/${name}/pull/${pull.number}`
      const title = pull.title.slice(0, 300) || identifier
      items.push({
        identifier,
        url,
        title,
        connection: { id: connection.id, label: connection.name ?? connection.label },
        projects: await dependencies.projectsForRepo(canonicalOwner, name),
        // The seed the PR list promotes a pull request with: GitHub records a pull on the task row, so
        // the head branch and the number are the link.
        seed: {
          origin: 'github-pr',
          title,
          ...(pull.headRef ? { branch: pull.headRef } : {}),
          pullNumber: pull.number,
        },
        context: {
          label: `GitHub pull request ${identifier}`.slice(0, 200),
          content: pullContext(identifier, url, pull),
        },
      })
    }
    return Response.json({ items } satisfies BrowserHandoffResolution)
  }
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const refusal = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status })

function pullContext(identifier: string, url: string, pull: Pull): string {
  const state = pull.draft ? `${pull.state}, draft` : pull.state
  const lines = [
    `${identifier}: ${pull.title}`,
    url,
    `State: ${state}${pull.author ? ` · opened by @${pull.author}` : ''}`,
  ]
  if (pull.headRef && pull.baseRef) lines.push(`Branches: ${pull.headRef} into ${pull.baseRef}`)
  const description = pull.body?.trim()
  if (description) lines.push('', truncateBytes(description, BODY_MAX_BYTES))
  return lines.join('\n')
}

// The PR pane's composite read, then GitHub's spelling of the repository from the mirror row that read
// filled in, rather than whatever casing the address had.
export const mirroredPullReader =
  (db: PluginDatabase, emit: GithubEmit): ReadPull =>
  async (request) => {
    const read = await readPullDetail(db, request, emit)
    if (!read.ok) return read
    if (!read.value.pull) return { ok: false, failure: { status: 404, error: 'pull_not_found' } }
    const [canonical = { owner: request.owner, name: request.repo }] = await db
      .select({ owner: repos.owner, name: repos.name })
      .from(repos)
      .where(and(eq(repos.userId, request.userId), repoMatches(request.owner, request.repo)))
    return { ok: true, value: { ...canonical, pull: read.value.pull } }
  }

type ProjectRef = { id: string; github: { owner: string; name: string } | null }

// Projects tracking a repository, compared case-insensitively: core stores the facet folded, while
// GitHub and the address keep their own casing. `byGithub` answers only the oldest clone, and a person
// with two checkouts of one repository has to be able to choose, so this reads each project's facet.
export async function projectsTrackingRepo(
  projects: { checkouts(): Promise<{ id: string }[]>; byId(id: string): Promise<ProjectRef | null> },
  owner: string,
  name: string,
): Promise<string[]> {
  const refs = await Promise.all((await projects.checkouts()).map((checkout) => projects.byId(checkout.id)))
  return refs.flatMap((ref) =>
    ref?.github &&
    ref.github.owner.toLowerCase() === owner.toLowerCase() &&
    ref.github.name.toLowerCase() === name.toLowerCase()
      ? [ref.id]
      : [],
  )
}
