// A deterministic GitLab server for tests, gitlab.com unless a test names another origin: the REST and
// GraphQL calls this plugin makes, over projects and merge requests a test builds. Tests stub `fetch`
// with `fake.fetch` and read back `requests` to see what was asked. Its answers follow GitLab's documented shapes, the way
// plugins/github/src/server/routes/mirror/fakeGithub.helper.ts follows GitHub's.

type FakeNote = {
  id: number
  body: string
  author: string
  createdAt: string
  system?: boolean
  bot?: boolean
  position?: { path: string; newLine?: number; oldLine?: number; headSha: string }
}
export type FakeDiscussion = { id: string; resolved: boolean; notes: FakeNote[] }
type FakeJob = { id: number; name: string; status: string; stage?: string; allowFailure?: boolean }
export type FakeMergeRequest = {
  iid: number
  title: string
  state: 'opened' | 'closed' | 'merged'
  draft: boolean
  description: string
  author: string
  sourceBranch: string
  targetBranch: string
  updatedAt: string
  conflicts: boolean
  baseSha: string
  startSha: string
  headSha: string
  labels: { title: string; color: string }[]
  reviewers: string[]
  approvedBy: string[]
  pipeline: { sha: string; jobs: FakeJob[] } | null
  commits: { sha: string; title: string; author: string; date: string }[]
  discussions: FakeDiscussion[]
  diffs: {
    old_path: string
    new_path: string
    new_file?: boolean
    deleted_file?: boolean
    renamed_file?: boolean
    diff: string
  }[]
}
export type FakeProject = { id: number; path: string; defaultBranch: string; mergeRequests: FakeMergeRequest[] }

export const makeMergeRequest = (overrides: Partial<FakeMergeRequest> = {}): FakeMergeRequest => ({
  iid: 12,
  title: 'Fix the importer',
  state: 'opened',
  draft: false,
  description:
    '<p>Uses <a href="/group/sub/api/-/issues/3">#3</a> and <img data-src="/uploads/a.png" src="data:image/gif;base64,R0">.</p>',
  author: 'ada',
  sourceBranch: 'fix-importer',
  targetBranch: 'main',
  updatedAt: '2026-10-16T00:00:00Z',
  conflicts: false,
  baseSha: 'b'.repeat(40),
  startSha: 's'.repeat(40),
  headSha: 'a'.repeat(40),
  labels: [{ title: 'bug', color: '#dc143c' }],
  reviewers: ['grace'],
  approvedBy: [],
  pipeline: { sha: 'a'.repeat(40), jobs: [{ id: 501, name: 'test', status: 'SUCCESS', stage: 'test' }] },
  commits: [{ sha: 'c'.repeat(40), title: 'Fix it', author: 'ada', date: '2026-10-15T00:00:00Z' }],
  discussions: [],
  diffs: [{ old_path: 'src/app.ts', new_path: 'src/app.ts', diff: '@@ -1,2 +1,2 @@\n-old\n+new\n same\n' }],
  ...overrides,
})

type FakeRequest = {
  method: string
  path: string
  body?: unknown
  operation?: string
  authorization?: string | null
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export function makeFakeGitlab(projects: FakeProject[], origin = 'https://gitlab.com') {
  const requests: FakeRequest[] = []
  // Tokens the fake accepts. A test drops one to play a revoked or expired token.
  const tokens = new Set(['token'])
  const refreshTokens = new Map<string, number>()
  let issued = 0
  const user = (username: string) => ({
    username,
    avatarUrl: `/uploads/-/system/user/avatar/${username}.png`,
    bot: false,
  })

  const projectFor = (ref: string) => {
    const path = decodeURIComponent(ref)
    return projects.find((project) => String(project.id) === path || project.path.toLowerCase() === path.toLowerCase())
  }
  const mergeRequestFor = (project: FakeProject | undefined, iid: string | number) =>
    project?.mergeRequests.find((mr) => mr.iid === Number(iid))

  const listNode = (mr: FakeMergeRequest) => ({
    iid: String(mr.iid),
    title: mr.title,
    state: mr.state,
    draft: mr.draft,
    sourceBranch: mr.sourceBranch,
    targetBranch: mr.targetBranch,
    updatedAt: mr.updatedAt,
    author: user(mr.author),
    headPipeline: mr.pipeline ? { status: 'RUNNING' } : null,
  })
  const discussionNode = (mr: FakeMergeRequest, discussion: FakeDiscussion) => ({
    id: `gid://gitlab/Discussion/${discussion.id}`,
    resolved: discussion.resolved,
    notes: {
      nodes: discussion.notes.map((note) => ({
        id: `gid://gitlab/${note.position ? 'DiffNote' : 'Note'}/${note.id}`,
        body: note.body,
        bodyHtml: `<p>${note.body}</p>`,
        system: note.system === true,
        createdAt: note.createdAt,
        author: { ...user(note.author), bot: note.bot === true },
        position: note.position
          ? {
              filePath: note.position.path,
              newLine: note.position.newLine ?? null,
              oldLine: note.position.oldLine ?? null,
              diffRefs: { headSha: note.position.headSha },
            }
          : null,
      })),
    },
  })
  const page = <T>(items: T[], first: number, after: string | null) => {
    const start = after ? Number(after) : 0
    const nodes = items.slice(start, start + first)
    const next = start + nodes.length
    return {
      pageInfo: { hasNextPage: next < items.length, endCursor: next < items.length ? String(next) : null },
      nodes,
    }
  }

  function graphQL(query: string, variables: Record<string, unknown>): Response {
    const project = projectFor(String(variables.path ?? variables.projectPath ?? ''))
    if (query.includes('mutation SetDraft')) {
      const mr = mergeRequestFor(project, String(variables.iid))
      if (mr) mr.draft = variables.draft === true
      return json({ data: { mergeRequestSetDraft: { errors: mr ? [] : ['not found'] } } })
    }
    if (query.includes('mutation SetReviewers')) {
      const mr = mergeRequestFor(project, String(variables.iid))
      const logins = variables.logins as string[]
      if (mr)
        mr.reviewers =
          variables.mode === 'REMOVE'
            ? mr.reviewers.filter((login) => !logins.includes(login))
            : [...new Set([...mr.reviewers, ...logins])]
      return json({ data: { mergeRequestSetReviewers: { errors: [] } } })
    }
    if (!project) return json({ data: { project: null } })
    if (query.includes('query MergeRequests(')) {
      const listed = project.mergeRequests
        .filter((mr) => mr.state === variables.state)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(listNode)
      return json({
        data: {
          project: { mergeRequests: page(listed, Number(variables.first), (variables.after as string) ?? null) },
        },
      })
    }
    const mr = mergeRequestFor(project, String(variables.iid))
    if (!mr) return json({ data: { project: { mergeRequest: null } } })
    const discussions = mr.discussions.map((discussion) => discussionNode(mr, discussion))
    if (query.includes('query MergeRequestDiscussions('))
      return json({
        data: {
          project: { mergeRequest: { discussions: page(discussions, 100, (variables.after as string) ?? null) } },
        },
      })
    return json({
      data: {
        project: {
          mergeRequest: {
            iid: String(mr.iid),
            title: mr.title,
            state: mr.state,
            draft: mr.draft,
            descriptionHtml: mr.description,
            sourceBranch: mr.sourceBranch,
            targetBranch: mr.targetBranch,
            updatedAt: mr.updatedAt,
            conflicts: mr.conflicts,
            diffRefs: { baseSha: mr.baseSha, headSha: mr.headSha, startSha: mr.startSha },
            author: user(mr.author),
            labels: { nodes: mr.labels },
            reviewers: { nodes: mr.reviewers.map(user) },
            approvedBy: { nodes: mr.approvedBy.map(user) },
            headPipeline: mr.pipeline && {
              sha: mr.pipeline.sha,
              jobs: {
                nodes: mr.pipeline.jobs.map((job) => ({
                  id: `gid://gitlab/Ci::Build/${job.id}`,
                  name: job.name,
                  status: job.status,
                  allowFailure: job.allowFailure === true,
                  stage: { name: job.stage ?? 'test' },
                  webPath: `/${project.path}/-/jobs/${job.id}`,
                })),
              },
            },
            commits: {
              nodes: mr.commits.map((commit) => ({
                sha: commit.sha,
                title: commit.title,
                authoredDate: commit.date,
                authorName: commit.author,
                author: { username: commit.author },
              })),
            },
            discussions: page(discussions, 100, null),
          },
        },
      },
    })
  }

  function rest(
    method: string,
    path: string,
    query: URLSearchParams,
    body: Record<string, unknown> | undefined,
  ): Response {
    if (path === '/user') return json({ username: 'ada', name: 'Ada' })
    if (path === '/projects' && method === 'GET') {
      const perPage = Number(query.get('per_page') ?? 20)
      const pageNumber = Number(query.get('page') ?? 1)
      const search = query.get('search')?.toLowerCase()
      const rows = projects
        .filter((project) => !search || project.path.toLowerCase().includes(search))
        .slice((pageNumber - 1) * perPage, pageNumber * perPage)
        .map((project) => ({
          id: project.id,
          path_with_namespace: project.path,
          name: project.path.split('/').pop(),
          default_branch: project.defaultBranch,
          visibility: 'private',
          last_activity_at: '2026-10-16T00:00:00Z',
        }))
      return json(rows)
    }
    const match = /^\/projects\/([^/]+)(\/.*)?$/.exec(path)
    const project = match ? projectFor(match[1]!) : undefined
    if (!project) return json({ message: '404 Project Not Found' }, 404)
    const rest = match![2] ?? ''
    if (!rest)
      return json({
        id: project.id,
        path_with_namespace: project.path,
        name: project.path.split('/').pop(),
        default_branch: project.defaultBranch,
        visibility: 'private',
        last_activity_at: '2026-10-16T00:00:00Z',
      })
    if (rest === '/labels')
      return json([
        { name: 'backend', color: '#dc143c' },
        { name: 'docs', color: '#428bca' },
      ])
    if (rest === '/members/all')
      return json([
        { username: 'ada', avatar_url: null },
        { username: 'grace', avatar_url: null },
      ])
    if (rest === '/merge_requests' && method === 'POST') {
      const iid = Math.max(0, ...project.mergeRequests.map((mr) => mr.iid)) + 1
      project.mergeRequests.push(
        makeMergeRequest({
          iid,
          title: String(body?.title),
          sourceBranch: String(body?.source_branch),
          targetBranch: String(body?.target_branch),
          draft: /^draft:/i.test(String(body?.title)),
        }),
      )
      return json({ iid }, 201)
    }
    if (rest === '/merge_requests' && method === 'GET')
      return json(
        project.mergeRequests.map((mr) => ({
          iid: mr.iid,
          title: mr.title,
          state: mr.state,
          draft: mr.draft,
          author: { username: mr.author },
          source_branch: mr.sourceBranch,
          target_branch: mr.targetBranch,
          labels: mr.labels.map((label) => label.title),
          reviewers: mr.reviewers.map((username) => ({ username })),
          created_at: mr.updatedAt,
          updated_at: mr.updatedAt,
          web_url: `${origin}/${project.path}/-/merge_requests/${mr.iid}`,
        })),
      )
    const job = /^\/jobs\/(\d+)(\/trace|\/retry)?$/.exec(rest)
    if (job) {
      const found = project.mergeRequests
        .flatMap((mr) => mr.pipeline?.jobs ?? [])
        .find((item) => item.id === Number(job[1]))
      if (!found) return json({ message: '404 Not found' }, 404)
      if (job[2] === '/trace')
        return new Response(`section_start:1:build\r\u001b[0Krunning ${found.name}\nok\n`, { status: 200 })
      if (job[2] === '/retry') {
        found.status = 'PENDING'
        return json({ id: found.id + 1000, status: 'pending' }, 201)
      }
      return json({ id: found.id, name: found.name, status: found.status.toLowerCase() })
    }
    if (rest === '/jobs')
      return json(
        project.mergeRequests.flatMap((mr) =>
          (mr.pipeline?.jobs ?? []).map((item) => ({
            id: item.id,
            name: item.name,
            stage: item.stage ?? 'test',
            status: item.status.toLowerCase(),
            ref: mr.sourceBranch,
            created_at: mr.updatedAt,
            finished_at: null,
            duration: null,
            web_url: `${origin}/${project.path}/-/jobs/${item.id}`,
            pipeline: { id: 900 },
          })),
        ),
      )
    const file = /^\/repository\/files\/([^/]+)\/raw$/.exec(rest)
    if (file) return new Response(`text of ${decodeURIComponent(file[1]!)} at ${query.get('ref')}\n`, { status: 200 })
    const scoped = /^\/merge_requests\/(\d+)(\/.*)?$/.exec(rest)
    const mr = scoped ? mergeRequestFor(project, scoped[1]!) : undefined
    if (!mr) return json({ message: '404 Not found' }, 404)
    const child = scoped![2] ?? ''
    if (!child && method === 'GET')
      return json({ iid: mr.iid, diff_refs: { base_sha: mr.baseSha, head_sha: mr.headSha, start_sha: mr.startSha } })
    if (!child && method === 'PUT') {
      if (body?.state_event === 'close') mr.state = 'closed'
      if (body?.state_event === 'reopen') mr.state = 'opened'
      if (typeof body?.add_labels === 'string') mr.labels.push({ title: body.add_labels, color: '#000000' })
      if (typeof body?.remove_labels === 'string')
        mr.labels = mr.labels.filter((label) => label.title !== body.remove_labels)
      return json({ iid: mr.iid })
    }
    if (child === '/diffs') {
      const perPage = Number(query.get('per_page') ?? 20)
      const pageNumber = Number(query.get('page') ?? 1)
      return json(
        mr.diffs.slice((pageNumber - 1) * perPage, pageNumber * perPage).map((diff) => ({
          new_file: false,
          deleted_file: false,
          renamed_file: false,
          ...diff,
        })),
      )
    }
    if (child === '/notes' && method === 'POST') {
      mr.discussions.push({
        id: `d${mr.discussions.length + 1}`,
        resolved: false,
        notes: [
          {
            id: 9000 + mr.discussions.length,
            body: String(body?.body),
            author: 'ada',
            createdAt: '2026-10-16T01:00:00Z',
          },
        ],
      })
      return json({ id: 9000 }, 201)
    }
    if (child === '/approve') {
      if (!mr.approvedBy.includes('ada')) mr.approvedBy.push('ada')
      return json({}, 201)
    }
    if (child === '/merge') {
      if (mr.conflicts) return json({ message: 'Branch cannot be merged' }, 406)
      mr.state = 'merged'
      return json({ iid: mr.iid })
    }
    if (child === '/discussions' && method === 'POST') {
      const position = body?.position as Record<string, unknown>
      mr.discussions.push({
        id: `d${mr.discussions.length + 1}`,
        resolved: false,
        notes: [
          {
            id: 9100 + mr.discussions.length,
            body: String(body?.body),
            author: 'ada',
            createdAt: '2026-10-16T01:00:00Z',
            position: {
              path: String(position.new_path),
              ...(position.new_line != null ? { newLine: Number(position.new_line) } : {}),
              ...(position.old_line != null ? { oldLine: Number(position.old_line) } : {}),
              headSha: String(position.head_sha),
            },
          },
        ],
      })
      return json({ id: `d${mr.discussions.length}` }, 201)
    }
    const discussion = /^\/discussions\/([^/]+)(\/notes)?$/.exec(child)
    const found = discussion && mr.discussions.find((item) => item.id === discussion[1])
    if (found && discussion![2] && method === 'POST') {
      found.notes.push({
        id: 9200 + found.notes.length,
        body: String(body?.body),
        author: 'ada',
        createdAt: '2026-10-16T02:00:00Z',
      })
      return json({ id: 9200 }, 201)
    }
    if (found && method === 'PUT') {
      found.resolved = query.get('resolved') === 'true'
      return json({ id: found.id })
    }
    return json({ message: `fake gitlab has no ${method} ${path}` }, 404)
  }

  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const method = (init.method ?? 'GET').toUpperCase()
    const headers = new Headers(init.headers)
    const raw = typeof init.body === 'string' ? init.body : undefined
    const form =
      headers.get('content-type')?.includes('form-urlencoded') && raw
        ? Object.fromEntries(new URLSearchParams(raw))
        : undefined
    const body = form ?? (raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined)
    // A call meant for another server never reaches this one.
    if (url.origin !== origin) return json({ message: `fake gitlab is at ${origin}, not ${url.origin}` }, 404)

    if (url.pathname === '/oauth/authorize_device') {
      requests.push({ method, path: url.pathname, body })
      return json({
        device_code: 'device-1',
        user_code: 'ABCD-EFGH',
        verification_uri: `${origin}/oauth/device`,
        expires_in: 300,
        interval: 5,
      })
    }
    if (url.pathname === '/oauth/token') {
      requests.push({ method, path: url.pathname, body })
      const grant = body?.grant_type
      if (grant === 'refresh_token' && !refreshTokens.has(String(body?.refresh_token)))
        return json({ error: 'invalid_grant' }, 400)
      if (grant === 'refresh_token') refreshTokens.delete(String(body?.refresh_token))
      issued += 1
      const access = `access-${issued}`
      const refresh = `refresh-${issued}`
      tokens.add(access)
      refreshTokens.set(refresh, issued)
      return json({
        access_token: access,
        refresh_token: refresh,
        expires_in: 7200,
        created_at: Math.floor(Date.now() / 1000),
        token_type: 'Bearer',
      })
    }

    const authorization = headers.get('authorization')
    const token = authorization?.replace(/^Bearer /, '')
    const isGraphQL = url.pathname === '/api/graphql'
    const operation = isGraphQL ? /(?:query|mutation) (\w+)/.exec(String(body?.query))?.[1] : undefined
    requests.push({
      method,
      path: isGraphQL ? url.pathname : url.pathname.replace(/^\/api\/v4/, ''),
      body,
      operation,
      authorization,
    })
    if (!token || !tokens.has(token)) return json({ message: '401 Unauthorized' }, 401)
    if (isGraphQL) return graphQL(String(body?.query), (body?.variables ?? {}) as Record<string, unknown>)
    // GitLab's path has its own encoding: a project path is one encoded segment.
    const path = url.pathname.replace(/^\/api\/v4/, '')
    return rest(method, path, url.searchParams, body)
  }

  return {
    fetch,
    requests,
    tokens,
    /** A refresh token the fake will honour once, as if a device sign-in had issued it. */
    grantRefreshToken: (refreshToken: string) => refreshTokens.set(refreshToken, 0),
    projects,
  }
}
