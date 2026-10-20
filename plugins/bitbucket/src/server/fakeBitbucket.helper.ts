// A deterministic Bitbucket Cloud API for tests: the REST calls this plugin makes, over repositories and
// pull requests a test builds. Tests stub `fetch` with `fake.fetch` and read back `requests` to see what
// was asked. Its answers follow Bitbucket's documented shapes, the way
// plugins/gitlab/src/server/fakeGitlab.helper.ts follows GitLab's: paginated `values` with an
// absolute `next`, short commit hashes on a pull request, and `{ type: 'error', error: { message } }`
// for a refusal.

const API = 'https://api.bitbucket.org'
/** The basic auth pair the fake accepts. A test empties `credentials` to play a revoked token. */
export const FAKE_AUTH = 'ada@example.com:token'

type FakeComment = {
  id: number
  body: string
  author: string
  createdOn: string
  inline?: { path: string; from?: number; to?: number }
  parentId?: number
  resolved?: boolean
  pending?: boolean
  bot?: boolean
}
type FakeParticipant = {
  nickname: string
  role: 'REVIEWER' | 'PARTICIPANT'
  approved: boolean
  state: 'approved' | 'changes_requested' | null
  participatedOn: string | null
}
type FakeStatus = { key: string; name: string; state: string; commit: string }
export type FakePullRequest = {
  id: number
  title: string
  state: 'OPEN' | 'MERGED' | 'DECLINED'
  draft: boolean
  description: string
  author: string
  sourceBranch: string
  /** A fork's full name, or the repository's own when absent. */
  sourceRepository?: string
  destinationBranch: string
  headSha: string
  baseSha: string
  createdOn: string
  updatedOn: string
  participants: FakeParticipant[]
  comments: FakeComment[]
  commits: { hash: string; message: string; author: string; date: string }[]
  statuses: FakeStatus[]
  /** Bitbucket refuses the merge with this message, as it does for conflicts or a merge check. */
  mergeRefusal?: string
  diffstat: { status: string; old: string | null; new: string | null; added: number; removed: number }[]
  diff: string
}
type FakePipeline = {
  uuid: string
  buildNumber: number
  branch: string
  steps: { uuid: string; name: string; state: string; result?: string }[]
}
export type FakeRepository = {
  path: string
  defaultBranch: string
  pullRequests: FakePullRequest[]
  pipelines?: FakePipeline[]
}

const HEAD = 'a'.repeat(40)

export const makePullRequest = (overrides: Partial<FakePullRequest> = {}): FakePullRequest => ({
  id: 12,
  title: 'Fix the importer',
  state: 'OPEN',
  draft: false,
  description: '<p>Fixes the <a href="https://bitbucket.org/acme/api/issues/3">importer</a>.</p>',
  author: 'ada',
  sourceBranch: 'fix-importer',
  destinationBranch: 'main',
  headSha: HEAD,
  baseSha: 'b'.repeat(40),
  createdOn: '2026-10-15T00:00:00Z',
  updatedOn: '2026-10-16T00:00:00Z',
  participants: [{ nickname: 'grace', role: 'REVIEWER', approved: false, state: null, participatedOn: null }],
  comments: [],
  commits: [{ hash: HEAD, message: 'Fix it\n\nThe long story.', author: 'ada', date: '2026-10-15T00:00:00Z' }],
  statuses: [{ key: 'build', name: 'Build', state: 'SUCCESSFUL', commit: HEAD }],
  diffstat: [{ status: 'modified', old: 'src/app.ts', new: 'src/app.ts', added: 1, removed: 1 }],
  diff: [
    'diff --git a/src/app.ts b/src/app.ts',
    'index 1111111..2222222 100644',
    '--- a/src/app.ts',
    '+++ b/src/app.ts',
    '@@ -1,2 +1,2 @@',
    '-old',
    '+new',
    ' same',
    '',
  ].join('\n'),
  ...overrides,
})

type FakeRequest = { method: string; path: string; query: URLSearchParams; body?: Record<string, unknown> }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const refuse = (status: number, message: string) => json({ type: 'error', error: { message } }, status)

const MEMBERS = ['ada', 'grace', 'linus']

export function makeFakeBitbucket(repositories: FakeRepository[]) {
  const requests: FakeRequest[] = []
  const credentials = new Set([FAKE_AUTH])
  let nextComment = 9000

  const user = (nickname: string, bot = false) => ({
    type: bot ? 'app_user' : 'user',
    uuid: `{${nickname}-uuid}`,
    nickname,
    display_name: nickname[0]!.toUpperCase() + nickname.slice(1),
    links: { avatar: { href: `https://avatar.example/${nickname}.png` } },
  })
  const nicknameOf = (uuid: string) => MEMBERS.find((nickname) => user(nickname).uuid === uuid)

  // A page of `values`, with `next` the same address one page on, as Bitbucket links its pages.
  const page = <T>(url: URL, items: T[], defaultSize = 10) => {
    const size = Number(url.searchParams.get('pagelen') ?? defaultSize)
    const number = Number(url.searchParams.get('page') ?? 1)
    const values = items.slice((number - 1) * size, number * size)
    const more = number * size < items.length
    const next = new URL(url.href)
    next.searchParams.set('page', String(number + 1))
    return json({ pagelen: size, page: number, size: items.length, values, ...(more ? { next: next.href } : {}) })
  }

  const repositoryAnswer = (repository: FakeRepository) => ({
    full_name: repository.path,
    name: repository.path.split('/')[1],
    is_private: true,
    mainbranch: { name: repository.defaultBranch },
    updated_on: '2026-10-16T00:00:00Z',
  })
  const pullAnswer = (repository: FakeRepository, pull: FakePullRequest, full: boolean) => ({
    id: pull.id,
    title: pull.title,
    state: pull.state,
    draft: pull.draft,
    author: user(pull.author),
    source: {
      branch: { name: pull.sourceBranch },
      commit: { hash: pull.headSha.slice(0, 12) },
      repository: { full_name: pull.sourceRepository ?? repository.path },
    },
    destination: {
      branch: { name: pull.destinationBranch },
      commit: { hash: pull.baseSha.slice(0, 12) },
      repository: { full_name: repository.path },
    },
    created_on: pull.createdOn,
    updated_on: pull.updatedOn,
    // A list row is partial: no summary, participants, or reviewers.
    ...(full
      ? {
          summary: { raw: pull.description, html: pull.description },
          reviewers: pull.participants.filter((p) => p.role === 'REVIEWER').map((p) => user(p.nickname)),
          participants: pull.participants.map((p) => ({
            user: user(p.nickname),
            role: p.role,
            approved: p.approved,
            state: p.state,
            participated_on: p.participatedOn,
          })),
        }
      : {}),
  })
  const commentAnswer = (comment: FakeComment) => ({
    id: comment.id,
    content: { raw: comment.body, html: `<p>${comment.body}</p>` },
    user: user(comment.author, comment.bot),
    created_on: comment.createdOn,
    ...(comment.pending ? { pending: true } : {}),
    ...(comment.inline
      ? { inline: { path: comment.inline.path, from: comment.inline.from ?? null, to: comment.inline.to ?? null } }
      : {}),
    ...(comment.parentId ? { parent: { id: comment.parentId } } : {}),
    ...(comment.resolved ? { resolution: { type: 'comment_resolution', user: user('grace') } } : {}),
  })
  const verdict = (pull: FakePullRequest, nickname: string, state: FakeParticipant['state']) => {
    const found = pull.participants.find((p) => p.nickname === nickname)
    const at = '2026-10-16T03:00:00Z'
    if (found) Object.assign(found, { state, approved: state === 'approved', participatedOn: at })
    else
      pull.participants.push({
        nickname,
        role: 'PARTICIPANT',
        approved: state === 'approved',
        state,
        participatedOn: at,
      })
  }

  function pullRoutes(
    method: string,
    url: URL,
    repository: FakeRepository,
    rest: string,
    body?: Record<string, unknown>,
  ) {
    if (rest === '' && method === 'GET') {
      const states = url.searchParams.getAll('state')
      // The one query filter this plugin sends, `updated_on >= <time>`.
      const since = /updated_on >= (\S+)/.exec(url.searchParams.get('q') ?? '')?.[1]
      const listed = repository.pullRequests
        .filter((pull) => (states.length ? states.includes(pull.state) : pull.state === 'OPEN'))
        .filter((pull) => !since || Date.parse(pull.updatedOn) >= Date.parse(since))
        .sort((a, b) => b.updatedOn.localeCompare(a.updatedOn))
        .map((pull) => ({
          ...pullAnswer(repository, pull, false),
          ...(url.searchParams.get('fields') === '+values.reviewers'
            ? { reviewers: pull.participants.filter((p) => p.role === 'REVIEWER').map((p) => user(p.nickname)) }
            : {}),
        }))
      return page(url, listed)
    }
    if (rest === '' && method === 'POST') {
      const id = Math.max(0, ...repository.pullRequests.map((pull) => pull.id)) + 1
      const source = body?.source as { branch: { name: string } }
      const destination = body?.destination as { branch: { name: string } }
      repository.pullRequests.push(
        makePullRequest({
          id,
          title: String(body?.title),
          draft: body?.draft === true,
          sourceBranch: source.branch.name,
          destinationBranch: destination.branch.name,
        }),
      )
      return json({ id }, 201)
    }
    const scoped = /^\/(\d+)(\/.*)?$/.exec(rest)
    const pull = scoped && repository.pullRequests.find((item) => item.id === Number(scoped[1]))
    if (!pull) return refuse(404, 'Pull request not found')
    const child = scoped![2] ?? ''
    if (!child && method === 'GET') return json(pullAnswer(repository, pull, true))
    if (!child && method === 'PUT') {
      if (!body?.title) return refuse(400, 'title: This field is required.')
      const wanted = (body.reviewers as { uuid: string }[]).map((reviewer) => nicknameOf(reviewer.uuid)!)
      for (const participant of pull.participants)
        participant.role = wanted.includes(participant.nickname) ? 'REVIEWER' : 'PARTICIPANT'
      for (const nickname of wanted)
        if (!pull.participants.some((p) => p.nickname === nickname))
          pull.participants.push({ nickname, role: 'REVIEWER', approved: false, state: null, participatedOn: null })
      pull.participants = pull.participants.filter((p) => p.role === 'REVIEWER' || p.state)
      return json(pullAnswer(repository, pull, true))
    }
    if (child === '/comments' && method === 'GET') return page(url, pull.comments.map(commentAnswer))
    if (child === '/comments' && method === 'POST') {
      const content = body?.content as { raw: string }
      const inline = body?.inline as { path: string; from?: number; to?: number } | undefined
      const parent = body?.parent as { id: number } | undefined
      const id = nextComment++
      pull.comments.push({
        id,
        body: content.raw,
        author: 'ada',
        createdOn: '2026-10-16T02:00:00Z',
        ...(inline ? { inline } : {}),
        ...(parent ? { parentId: parent.id } : {}),
      })
      return json(commentAnswer(pull.comments.at(-1)!), 201)
    }
    const resolve = /^\/comments\/(\d+)\/resolve$/.exec(child)
    if (resolve) {
      const comment = pull.comments.find((item) => item.id === Number(resolve[1]))
      if (!comment || comment.parentId) return refuse(400, 'Only a top-level comment can be resolved.')
      comment.resolved = method === 'POST'
      return method === 'POST' ? json({ type: 'comment_resolution' }) : new Response(null, { status: 204 })
    }
    if (child === '/commits')
      return page(
        url,
        pull.commits.map((commit) => ({
          hash: commit.hash,
          message: commit.message,
          date: commit.date,
          author: { raw: `${commit.author} <${commit.author}@example.com>`, user: user(commit.author) },
        })),
      )
    if (child === '/statuses')
      return page(
        url,
        pull.statuses.map((status) => ({
          key: status.key,
          name: status.name,
          state: status.state,
          url: `https://ci.example/${status.key}`,
          commit: { hash: status.commit },
        })),
      )
    if (child === '/diffstat')
      return page(
        url,
        pull.diffstat.map((entry) => ({
          status: entry.status,
          lines_added: entry.added,
          lines_removed: entry.removed,
          old: entry.old ? { path: entry.old } : null,
          new: entry.new ? { path: entry.new } : null,
        })),
        500,
      )
    if (child === '/diff') return new Response(pull.diff, { status: 200, headers: { 'content-type': 'text/plain' } })
    if (child === '/approve' || child === '/request-changes') {
      verdict(pull, 'ada', method === 'DELETE' ? null : child === '/approve' ? 'approved' : 'changes_requested')
      return json({ approved: child === '/approve' })
    }
    if (child === '/merge') {
      if (pull.mergeRefusal) return refuse(400, pull.mergeRefusal)
      pull.state = 'MERGED'
      return json(pullAnswer(repository, pull, true))
    }
    if (child === '/decline') {
      pull.state = 'DECLINED'
      return json(pullAnswer(repository, pull, true))
    }
    return refuse(404, `fake bitbucket has no ${method} ${url.pathname}`)
  }

  function route(method: string, url: URL, body?: Record<string, unknown>): Response {
    const path = url.pathname.replace(/^\/2\.0/, '')
    if (path === '/user') return json(user('ada'))
    if (path === '/repositories' && method === 'GET') {
      const search = /full_name ~ "([^"]*)"/.exec(url.searchParams.get('q') ?? '')?.[1]?.toLowerCase()
      return page(
        url,
        repositories.filter((r) => !search || r.path.toLowerCase().includes(search)).map(repositoryAnswer),
      )
    }
    const members = /^\/workspaces\/([^/]+)\/members$/.exec(path)
    if (members)
      return page(
        url,
        MEMBERS.map((nickname) => ({ user: user(nickname) })),
      )
    const match = /^\/repositories\/([^/]+\/[^/]+)(\/.*)?$/.exec(path)
    const repository = match && repositories.find((r) => r.path.toLowerCase() === match[1]!.toLowerCase())
    if (!repository) return refuse(404, 'Repository not found')
    const rest = match![2] ?? ''
    if (!rest) return json(repositoryAnswer(repository))
    if (rest.startsWith('/pullrequests'))
      return pullRoutes(method, url, repository, rest.slice('/pullrequests'.length), body)
    const file = /^\/src\/([0-9a-f]+)\/(.+)$/.exec(rest)
    if (file) return new Response(`text of ${decodeURIComponent(file[2]!)} at ${file[1]}\n`, { status: 200 })
    if (rest === '/pipelines/')
      return page(
        url,
        (repository.pipelines ?? []).map((pipeline) => ({
          uuid: pipeline.uuid,
          build_number: pipeline.buildNumber,
          state: { name: 'COMPLETED' },
          target: { ref_name: pipeline.branch },
          created_on: '2026-10-16T00:00:00Z',
        })),
      )
    const steps = /^\/pipelines\/([^/]+)\/steps\/$/.exec(rest)
    const pipeline = steps && repository.pipelines?.find((item) => item.uuid === decodeURIComponent(steps[1]!))
    if (pipeline)
      return page(
        url,
        pipeline.steps.map((step) => ({
          uuid: step.uuid,
          name: step.name,
          state: { name: step.state, ...(step.result ? { result: { name: step.result } } : {}) },
          started_on: '2026-10-16T00:00:00Z',
          completed_on: step.result ? '2026-10-16T00:01:00Z' : null,
          duration_in_seconds: step.result ? 60 : null,
        })),
      )
    return refuse(404, `fake bitbucket has no ${method} ${path}`)
  }

  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const method = (init.method ?? 'GET').toUpperCase()
    const raw = typeof init.body === 'string' ? init.body : undefined
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined
    if (url.origin !== API) return json({ error: `fake bitbucket is at ${API}, not ${url.origin}` }, 404)
    requests.push({
      method,
      path: url.pathname.replace(/^\/2\.0/, ''),
      query: url.searchParams,
      ...(body ? { body } : {}),
    })
    const authorization = new Headers(init.headers).get('authorization') ?? ''
    const pair = authorization.startsWith('Basic ') ? Buffer.from(authorization.slice(6), 'base64').toString() : ''
    if (!credentials.has(pair)) return refuse(401, 'Invalid credentials. Check your email and API token.')
    return route(method, url, body)
  }

  return { fetch, requests, credentials, repositories }
}
