import type { Task } from '@acorn/protocol/api.ts'
import type { NoteSummary } from '@acorn/protocol/notes.ts'

// One task and three notes, as the node would answer them. Shared by the smoke test and the capture
// script (`pnpm --filter @acorn/tui capture`), which is how this package gets a screenshot on a machine
// with no TTY: the same tree, the same cells, printed instead of asserted.

export const TASK: Task = {
  id: 'task-1',
  title: 'fix-login',
  projectId: 'project-1',
  branch: 'fix-login',
  origin: 'local',
  icon: null,
  status: 'active',
  // Not decoration. `activateTaskSignals` asks the sources which pane a task opens on, and that
  // walks `links`; a fixture without one takes the shell's own activation effect down.
  links: [],
  // A repo and a pull request, so the panes that are only offered on a task that has one are offered
  // here: the PR pane asks `task.pullNumber != null`, and the changes pane wants a worktree to be
  // reviewing. The pane sweep needs every row of the roster reachable from one task
  // (docs/tui.md).
  github: { owner: 'runn-fast', name: 'acorn' },
  worktreePath: '/tmp/acorn-fixture/fix-login',
  pullNumber: 42,
  parentId: null,
  sort: 0,
}

export const TASK_NOTES: NoteSummary[] = [
  { slug: 'scratchpad', title: 'Scratchpad', author: 'user', kind: 'scratch', included: true, originTaskId: null, updatedAt: 0 },
  { slug: 'repro-steps', title: 'Repro steps', author: 'user', kind: 'finding', included: true, originTaskId: null, updatedAt: 0 },
  { slug: 'what-the-agent-found', title: 'What the agent found', author: 'agent', kind: 'finding', included: false, originTaskId: null, updatedAt: 0 },
]

export const WORKSPACE_NOTES: NoteSummary[] = [
  { slug: 'conventions', title: 'Conventions', author: 'user', kind: 'finding', included: true, originTaskId: null, updatedAt: 0 },
]

const BODY = '# Repro steps\n\n1. Sign in as a new account.\n2. Change the password.\n3. Sign in again — the old one still works.\n'


// ── Per-pane fixtures ──────────────────────────────────────────────────────────────────────────────
// Kept beside the transport rather than in each test, so every pane's snapshot is of the same node.

/** A second project, and one that is not the first.
 *
 *  A workspace with one project cannot show the shell reading the path wrongly: "keep the path on a
 *  project this workspace has" is a no-op when there is only one to keep it on. With two, a path the
 *  router could not match reads as no project at all and the shell navigates to the first — off
 *  whatever the reader had chosen (./chrome/routing.ts § routedProjectId).
 *
 *  Second, so the shell still opens on the repository the other tests browse; and with no GitHub
 *  remote, so a test can tell which project the shell ended up on by what the Browse panel says. */
const OTHER_PROJECT = {
  id: 'project-2',
  name: 'sibling',
  path: '/tmp/acorn-sibling',
  workspaceId: 'ws-1',
  sort: 0,
  hidden: false,
  color: null,
  vcs: 'git' as const,
  defaultBranch: 'main',
  remoteUrl: 'git@example.com:someone/sibling.git',
}

const PROJECT = {
  id: 'project-1',
  name: 'acorn',
  path: '/tmp/acorn-fixture',
  workspaceId: 'ws-1',
  sort: 0,
  hidden: false,
  color: null,
  vcs: 'git' as const,
  defaultBranch: 'main',
  remoteUrl: 'git@github.com:runn-fast/acorn.git',
  github: { owner: 'runn-fast', name: 'acorn', repoId: 1 },
}

/** Opt-in second workspace for focus handoff tests. Kept out of the default fixture so screenshots
 *  and tests that intentionally describe its one-workspace shell do not gain unrelated choices. */
const SECOND_PROJECT = {
  id: 'project-3',
  name: 'second-project',
  path: '/tmp/acorn-second',
  workspaceId: 'ws-2',
  sort: 0,
  hidden: false,
  color: null,
  vcs: 'git' as const,
  defaultBranch: 'main',
  remoteUrl: 'git@github.com:runn-fast/second.git',
  github: { owner: 'runn-fast', name: 'second', repoId: 2 },
}

const AGENT_PROVIDERS = [{
  id: 'claude',
  profileId: 'claude',
  label: 'Claude Code',
  driverKind: 'acp' as const,
  driverVersion: '1',
  installed: true,
  authenticated: true,
  statusAuthority: 'driver',
  capabilities: [],
  configOptions: [],
  commands: [],
  skills: [],
  diagnostics: [],
}]

const AGENT_SESSIONS = [{
  id: 'session-1',
  taskId: TASK.id,
  providerId: 'claude',
  profileId: 'claude',
  kind: 'managed',
  driverKind: 'acp',
  driverVersion: '1',
  providerSessionRef: null,
  controller: 'acorn',
  runtimeState: 'idle',
  attention: 'none',
  statusAuthority: 'driver',
  title: 'Find why the old password still works',
  model: 'claude-opus-5',
  config: {},
  parentSessionId: null,
  parentTurnId: null,
  subagents: [],
  lastEventSeq: 2,
  lastReadSeq: 2,
  archivedAt: null,
  createdAt: 0,
  updatedAt: 0,
}]

// One turn, a prompt, an answer, a tool card and an approval still waiting: the four things the sweep
// has to see on the agents transcript (docs/tui.md).
const AGENT_TURN = {
  id: 'turn-1',
  sessionId: 'session-1',
  ordinal: 1,
  source: 'user',
  status: 'completed',
  input: [{ type: 'text', text: 'Why does the old password still work after a reset?' }],
  effectivePolicy: {},
  providerTurnRef: null,
  stopReason: 'end_turn',
  usage: null,
  error: null,
  attempt: 1,
  createdAt: 0,
  updatedAt: 0,
}

const event = (seq: number, value: unknown) => ({
  id: `event-${seq}`,
  sessionId: 'session-1',
  turnId: 'turn-1',
  seq,
  schemaVersion: 1,
  event: value,
  searchText: null,
  createdAt: 0,
})

// A transcript longer than any pane is tall, so a case can ask whether the viewport stayed on the
// newest turn and kept the composer under it (../kit/scrolling.tsx § followViewport). Behind a flag
// because every other agents case reads a screen it can hold in its head, and thirty turns of filler
// would make each of those assert against a scroll position instead of against a pane.
// A function rather than a constant: a test sets the flag inside its own body, which is long after
// this module was evaluated (./workspaceFocus.test.tsx does the same with its own flag).
const agentFiller = () => (process.env.ACORN_FIXTURE_LONG_TRANSCRIPT
  ? Array.from({ length: 30 }, (_, index) =>
    event(100 + index, { type: 'assistant_message', text: `Filler turn ${index + 1}.` }))
  : [])

const agentSnapshot = () => ({
  session: AGENT_SESSIONS[0],
  turns: [AGENT_TURN],
  events: [
    ...agentFiller(),
    event(1, { type: 'user_message', text: 'Why does the old password still work after a reset?' }),
    event(2, { type: 'tool', tool: { id: 'tool-1', title: 'Read src/login.ts', status: 'completed', output: 'export async function signIn(' } }),
    event(3, { type: 'assistant_message', text: 'The reset writes a new hash but `signIn` still checks the one it was passed.' }),
    event(4, { type: 'request', requestId: 'request-1', kind: 'permission', title: 'Write src/login.ts', detail: 'Replace the password check', options: [{ id: 'allow', label: 'Allow' }, { id: 'deny', label: 'Deny' }] }),
  ],
  requests: [{
    id: 'request-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    providerRequestId: 'request-1',
    kind: 'permission',
    status: 'pending',
    title: 'Write src/login.ts',
    detail: 'Replace the password check',
    payload: { options: [{ id: 'allow', label: 'Allow' }, { id: 'deny', label: 'Deny' }] },
    resolution: null,
    expiresAt: null,
    createdAt: 0,
    resolvedAt: null,
  }],
})

const LOCAL_CHANGES = [
  { path: 'src/login.ts', status: 'modified', staged: false, additions: 12, deletions: 3 },
  { path: 'src/session.ts', status: 'modified', staged: true, additions: 4, deletions: 0 },
  { path: 'src/reset.test.ts', status: 'added', staged: false, additions: 40, deletions: 0 },
]

const PATCH = [
  'diff --git a/src/login.ts b/src/login.ts',
  '--- a/src/login.ts',
  '+++ b/src/login.ts',
  '@@ -1,4 +1,5 @@',
  ' export async function signIn(email: string, password: string) {',
  '-  return check(email, password)',
  '+  const account = await load(email)',
  '+  return check(account.passwordHash, password)',
  ' }',
].join('\n')

const TASK_CONTEXT = {
  task: { id: TASK.id, title: TASK.title, projectId: TASK.projectId, branch: TASK.branch, worktreePath: TASK.worktreePath, pullNumber: TASK.pullNumber },
  sections: [{
    id: 'notes',
    label: 'Notes',
    defaultIncluded: true,
    budget: {},
    items: [{ id: 'repro-steps', kind: 'note', label: 'Repro steps' }],
    compact: '1 note',
    omitted: 0,
  }, {
    id: 'changes',
    label: 'Working tree',
    defaultIncluded: true,
    budget: {},
    items: [{ id: 'src/login.ts', kind: 'file', label: 'src/login.ts', details: ['+12 -3'] }],
    compact: '3 files',
    omitted: 0,
  }],
  issues: [],
  notes: [],
  memory: [],
}

const PULL_REF = { owner: 'runn-fast', repo: 'acorn', number: 42 }

/** How many pull requests the browse list answers with. One, unless a test asks for more: a list
 *  longer than the panel it draws in is its own case — the window, the scrollbar, and the panels
 *  below it staying on the screen (./panel.tsx, ./kit/showing.tsx § Rows). */
const pulls = () => {
  const count = Number(process.env.ACORN_FIXTURE_PULLS ?? 1)
  return count > 1
    ? [PULL, ...Array.from({ length: count - 1 }, (_unused, at) => ({ ...PULL, number: 100 + at, title: `Older pull ${100 + at}` }))]
    : [PULL]
}

const PULL = {
  number: 42,
  title: 'Invalidate the old password on reset',
  state: 'open',
  draft: false,
  author: 'jamesmacfie',
  headRef: 'fix-login',
  baseRef: 'main',
  updatedAt: 0,
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  autoMergeEnabled: false,
}

const PULL_DETAIL = {
  pull: { ...PULL, body: 'Loads the account first so the stored hash is the one being checked.', headSha: 'abc123' },
  labels: [],
  reviews: [],
  requestedReviewers: [],
  comments: [],
  commits: [{ sha: 'abc123', message: 'Invalidate the old password on reset', author: 'James Macfie', authorLogin: 'jamesmacfie', committedAt: 0 }],
  checks: [{ name: 'lint', status: 'success', url: null, runId: 1 }, { name: 'test', status: 'success', url: null, runId: 2 }],
  threads: [],
}

/** A patch as long as a test asks for, in place of the short one below.
 *
 *  A diff longer than the panel it draws in is its own case, and it is the case the terminal diff
 *  shipped broken: a column of rows that does not fit is shrunk rather than scrolled, so four hundred
 *  lines were drawn into thirty rows on top of each other (./diffLong.test.tsx). The lines are long
 *  as well as many, because the other half of the same bug is horizontal. */
const longPatch = (): string | null => {
  const lines = Number(process.env.ACORN_FIXTURE_PATCH_LINES ?? 0)
  if (!lines) return null
  const mark = (at: number) => (at % 3 === 0 ? '+' : at % 3 === 1 ? '-' : ' ')
  return [`@@ -1,${lines} +1,${lines} @@`, ...Array.from({ length: lines }, (_unused, at) =>
    `${mark(at)}  const somethingRatherLongIndeed${at} = await loadAccountByEmailAddress(email.toLowerCase().trim(), ${at})`)].join('\n')
}

/** A real patch body on one of the two changed files, so the diff column has something to draw.
 *
 *  Both files answered `patch: null` before, which is the legitimate shape for a binary or an
 *  over-large file — and it meant every test that opened a pull was asserting on "no changes". */
const LOGIN_PATCH = [
  '@@ -1,4 +1,5 @@',
  ' export async function signIn(email: string, password: string) {',
  '-  const account = await loadAccountByEmailAddressWithoutAnyCaching(email.toLowerCase().trim())',
  '+  const account = await loadAccountByEmailAddressWithTheSessionCacheInFront(email.toLowerCase().trim())',
  '+  if (!account) throw new AuthenticationError("no account for that email address", { email })',
  '   return check(account.passwordHash, password)',
  ' }',
].join('\n')

const pullFiles = () => {
  const long = longPatch()
  return long ? [{ ...PULL_FILES[0], patch: long }, PULL_FILES[1]] : PULL_FILES
}

const PULL_FILES = [
  { path: 'src/login.ts', status: 'modified', additions: 12, deletions: 3, sha: 'a', viewed: false, patch: LOGIN_PATCH },
  { path: 'src/session.ts', status: 'modified', additions: 4, deletions: 0, sha: 'b', viewed: false, patch: null },
]

const EDITOR_ENTRIES = [
  { name: 'src', dir: true },
  { name: 'package.json', dir: false },
  { name: 'README.md', dir: false },
]

const FILE_TEXT = 'export async function signIn(email: string, password: string) {\n  const account = await load(email)\n  return check(account.passwordHash, password)\n}\n'

// Every request the fixture was asked for, in order, so a test can assert that a control acted rather
// than only that it drew. A control's whole job is to make one of these; the answer it gets back is
// the route's business and mostly a 404 here, which is the right shape for "the press left the
// building" (docs/tui.md § Keys and focus).
const recorded: { path: string; method: string }[] = []

/** What the fixture has been asked for since the last reset. */
export const recordedRequests = (): readonly { path: string; method: string }[] => recorded

/** Test seam: the list is module state, so a suite must not inherit the previous test's traffic. */
export const _resetRequests = (): void => { recorded.length = 0 }

/** A transport that answers the routes the panes ask for and 404s the rest, so a route the pane
 *  starts asking for shows up as an empty region rather than as a silent pass. */
export function stubTransport(): { fetch: (nodeId: string, request: { path: string; method?: string }) => Promise<{ status: number; headers: Record<string, string>; body: Uint8Array }> } {
  // Connected, with the one capability the pull list asks for. `providers` stays empty beside it, which
// is what switches off the "does this workspace link a project of its?" gate — that gate only applies
// to a provider that enumerates projects, and nothing here says GitHub does.
const GITHUB_INTEGRATION = {
  id: 'github',
  providerId: 'github' as const,
  label: 'GitHub',
  status: 'connected' as const,
  authKind: 'token' as const,
  account: null,
  scopes: [],
  capabilities: {},
  createdAt: 0,
  updatedAt: 0,
}

const json = (value: unknown) => ({
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: new TextEncoder().encode(JSON.stringify(value)),
  })
  return {
    fetch: async (_nodeId, request) => {
      // A transport that answers in a microtask can never hold a `Suspense` open past the tick that
      // destroys its subtree, so the failure the real app lives with — content removed, destroyed,
      // then handed back dead — was unreachable from a
      // test. The delay is opt-in per test, like ACORN_FIXTURE_PULLS above.
      const delay = Number(process.env.ACORN_FIXTURE_DELAY_MS ?? 0)
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
      const path = request.path
      recorded.push({ path, method: request.method ?? 'GET' })
      // The shell asks for these on mount. Answering them keeps a suite's output free of query
      // errors that say nothing about what is under test.
      //
      // One integration, and it is GitHub, because the rail gates a browse source on the integration
      // behind it being connected (features/tabs/railSources.ts) — with none, the Menu holds only the
      // sources that need no provider and the Browse panel has nothing to draw. The pull routes below
      // were always answered here; this is the row that lets a reader reach them.
      if (path === '/v2/core/prefs') return json({})
      if (path === '/v2/core/integrations') return json({ integrations: [GITHUB_INTEGRATION], providers: [] })
      if (path === '/v2/core/workspaces') return json([
        { id: 'ws-1', name: 'acorn', projects: [{ id: 'project-1', name: 'acorn' }, { id: 'project-2', name: 'sibling' }] },
        ...(process.env.ACORN_FIXTURE_SECOND_WORKSPACE
          ? [{ id: 'ws-2', name: 'second', projects: [{ id: SECOND_PROJECT.id, name: SECOND_PROJECT.name }] }]
          : []),
      ])
      if (path === '/v2/core/workspaces/ws-1/external-projects') return json({ projects: [] })
      if (path === '/v2/core/workspaces/ws-2/external-projects') return json({ projects: [] })
      if (path === '/v2/core/tasks') return json([TASK])
      // A descriptor source's items, for the one test that drives a `SourcePanel` list rather than a
      // first-party source's own regions (./sourceFilter.test.tsx). Three titles, two of which share a
      // word, so a filter can be shown to keep some rows and drop others.
      if (path === '/v2/p/probe/items') return json({ items: [
        { id: 'reset', title: 'Invalidate the old password on reset' },
        { id: 'rotate', title: 'Rotate the signing key' },
        { id: 'copy', title: 'Password reset copy' },
      ] })
      if (path === '/v2/core/projects') return json({
        projects: [PROJECT, OTHER_PROJECT, ...(process.env.ACORN_FIXTURE_SECOND_WORKSPACE ? [SECOND_PROJECT] : [])],
      })
      if (path === `/v2/p/notes/tasks/${TASK.id}/notes`) return json(TASK_NOTES)
      if (path === '/v2/p/notes/workspaces/ws-1/notes') return json(WORKSPACE_NOTES)
      if (path === '/v2/p/notes/workspaces/global/notes') return json([])
      if (path.endsWith('/repro-steps')) return json({ slug: 'repro-steps', title: 'Repro steps', body: BODY, included: true })
      if (path.endsWith('/scratchpad')) return json({ slug: 'scratchpad', title: 'Scratchpad', body: 'Whatever is in hand.\n', included: true })
      // ── One answer per pane in the roster ─────────────────────────────────────────────────────
      // Enough for each pane to draw its own shape rather than an error, because the sweep is about
      // whether a reader can find the thing the pane is for in 24 rows — and a pane showing one
      // `Alert` reads the same however unreadable the real thing is.
      if (path === '/v2/p/agents/providers') return json(AGENT_PROVIDERS)
      if (path.startsWith('/v2/p/agents/sessions?')) return json({ sessions: AGENT_SESSIONS, nextCursor: null })
      // Before the snapshot line, which is `/sessions/:id?…` and would otherwise claim this: `search`
      // reads as a session id, and the caller would get a snapshot object where it expects an array
      // and throw inside `found.map` (plugins/agents/src/client/commands.ts § agents.sessions.find).
      if (path.startsWith('/v2/p/agents/sessions/search?')) return json(AGENT_SESSIONS)
      if (/^\/v2\/p\/agents\/sessions\/[^/]+\?/.test(path)) return json(agentSnapshot())
      if (path.startsWith('/v2/p/agents/sessions/') && path.includes('/events')) return json({ events: [], nextCursor: null })
      if (path === `/v2/p/changes/tasks/${TASK.id}/local/changes`) return json(LOCAL_CHANGES)
      if (path === `/v2/p/changes/tasks/${TASK.id}/review-notes`) return json([])
      if (path.startsWith(`/v2/p/changes/tasks/${TASK.id}/local/diff`)) return json({ patch: PATCH })
      if (path.startsWith(`/v2/core/tasks/${TASK.id}/context`)) return json(TASK_CONTEXT)
      if (path === `/v2/p/workflows/tasks/${TASK.id}/workflows/runs`) return json([])
      if (path === `/v2/p/editor/tasks/${TASK.id}/editor/root`) return json({ root: TASK.worktreePath })
      if (path.startsWith(`/v2/p/editor/tasks/${TASK.id}/editor/list`)) return json(EDITOR_ENTRIES)
      if (path === `/v2/p/editor/tasks/${TASK.id}/editor/files`) return json(['src/login.ts', 'src/session.ts'])
      if (path.startsWith(`/v2/p/editor/tasks/${TASK.id}/editor/read`)) return json({ text: FILE_TEXT })
      if (path === `/v2/p/github/tasks/${TASK.id}/pulls`) return json({ pulls: [{ pull: PULL_REF, role: 'primary', provenance: 'agent', sessionId: 'session-1' }] })
      // Any number, not only 42, so a test that walks a long list gets a loaded detail on every row
      // rather than "Not found" on all but the first.
      if (/^\/v2\/p\/github\/repos\/runn-fast\/acorn\/pulls\/\d+$/.test(path)) return json(PULL_DETAIL)
      if (/^\/v2\/p\/github\/repos\/runn-fast\/acorn\/pulls\/\d+\/files/.test(path)) return json(pullFiles())
      if (path.startsWith('/v2/p/github/repos/runn-fast/acorn/pulls?')) return json(pulls())
      if (path === '/v2/p/github/repos/runn-fast/acorn/labels') return json([])
      if (path === '/v2/p/github/repos/runn-fast/acorn/mentions') return json([])
      // `ACORN_FIXTURE_LOG=1` prints what went unanswered. A pane that starts asking for a new route
      // otherwise shows up as an empty region, and finding out which route it wanted is the difference
      // between a minute and an afternoon.
      if (process.env.ACORN_FIXTURE_LOG) process.stderr.write(`MISS ${request.method ?? 'GET'} ${path}\n`)
      return { status: 404, headers: {}, body: new Uint8Array() }
    },
  }
}
