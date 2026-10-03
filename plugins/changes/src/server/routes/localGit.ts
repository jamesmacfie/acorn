import { Hono, type Context } from 'hono'
import { z } from 'zod'
import type { ModelBackend } from '@acorn/protocol/modelProviders.ts'
import type { LocalStatus } from '@acorn/protocol/localGit.ts'
import type {
  CommitMessageRequest, CommitOptions, GeneratedCommitMessage, HeadCommit, LocalDocumentRequest, LocalDocumentResponse, LocalSearchRequest,
  LocalSegmentsRequest, PullOptions, PushOptions,
} from '../../shared/api'
import { MAX_DOCUMENT_FILES, MAX_SEGMENTS_PER_REQUEST, SEARCH_MAX_QUERY, type DiffSearchPage, type DiffSegmentPayload } from '@acorn/diff-document/document'
import {
  type AppEnv,
  BridgeError,
  isProviderOperationError,
  ownerId,
  type Principal,
  respondError,
  routeCapability,
  routeCapabilityFor,
  setRouteTestCapability,
  viaBridge,
} from '@acorn/plugin-api/node'

// The ChangesPane's working-tree status, diff document and blob reads, plus the staging, commit,
// discard and remote actions. Task-scoped HTTP behind the LocalGitBridge (../localGit.ts). Pure Node, so it works
// in dev:node.

export type { LocalScope } from '../../shared/api'
export type GitActionResult = { ok: boolean; reason?: string }
export type LocalGitBridge = {
  /** One read answers the whole panel: the changes, the branch, its upstream, how far each way, and
   *  whether a merge or rebase is mid-flight. */
  status(taskId: string): Promise<LocalStatus>
  /** The stacked files' diff as document descriptors. Throws a `BridgeError` when there is no tree. */
  document(taskId: string, request: LocalDocumentRequest): Promise<LocalDocumentResponse>
  /** Segments by patch digest. A digest the tree no longer produces is a 409 `revision_conflict`. */
  segments(taskId: string, request: LocalSegmentsRequest): Promise<DiffSegmentPayload[]>
  /** One page of find matches over the named files, with the same conflict rule. */
  search(taskId: string, request: LocalSearchRequest): Promise<DiffSearchPage>
  /** The new side of the file's diff, whole, so the pane can fill an expanded gap. */
  newSide(taskId: string, path: string, scope: 'unstaged' | 'staged'): Promise<{ text: string } | { error: string }>
  /** A row's checkbox sends one path, a group's sends many. */
  stage(taskId: string, paths: string[]): Promise<GitActionResult>
  unstage(taskId: string, paths: string[]): Promise<GitActionResult>
  discard(taskId: string, path: string, untracked?: boolean, oldPath?: string): Promise<GitActionResult>
  /** HEAD's hash and message, for the field an amend fills. Null before the branch has a commit. */
  headCommit(taskId: string): Promise<HeadCommit | null>
  commit(taskId: string, message: string, options?: CommitOptions): Promise<GitActionResult>
  stageAll(taskId: string): Promise<GitActionResult>
  unstageAll(taskId: string): Promise<GitActionResult>
  discardAll(taskId: string): Promise<GitActionResult>
  /** The four remote verbs the branch bar drives. `push` covers Publish too: it always carries
   *  `--set-upstream`, so the only difference is the label. */
  fetch(taskId: string): Promise<GitActionResult>
  pull(taskId: string, options?: PullOptions): Promise<GitActionResult>
  push(taskId: string, options?: PushOptions): Promise<GitActionResult>
  /** Undo whichever of a merge or a rebase is mid-flight. Refused when none is. */
  abort(taskId: string): Promise<GitActionResult>
  /** Which backends this owner could generate a message with — a stored key, or an agent CLI
   *  installed on this machine — ids and labels only. */
  modelBackends(userId: string): Promise<ModelBackend[]>
  /** A commit message written from the diff the next commit would take. Throws: a `BridgeError` when
   *  there is nothing to describe, a `ProviderOperationError` when the provider refuses. */
  commitMessage(taskId: string, request: CommitMessageRequest & { userId: string }): Promise<GeneratedCommitMessage>
}

export const LOCAL_GIT = routeCapability<LocalGitBridge>('changes.localGit')
/** @internal test compatibility; production providers use CapabilityRegistry.provide. */
export const setLocalGitBridge = (bridge: LocalGitBridge | null): void => setRouteTestCapability(LOCAL_GIT, bridge)

// Every one of these runs git against the worktree, so each body gets zod validation and a
// malformed-body test.
//
// `pathsBody` is non-empty on purpose: a stage with no paths is a caller bug, and `git add --` with
// nothing after it stages nothing while reporting success, which the pane would draw as a stage that
// did not happen.
const pathsBody = z.object({ paths: z.array(z.string().min(1)).min(1) })
// `oldPath` is a rename's other name, so discarding one row puts both back (../localDiff.ts § discardFile).
const discardBody = z.object({ path: z.string().min(1), untracked: z.boolean().optional(), oldPath: z.string().min(1).optional() })
// Every flag the commit menu can set, each optional and each strictly a boolean: `{ amend: 'yes' }`
// is a caller bug, and coercing it would commit an amend somebody never asked for.
const commitBody = z.object({
  message: z.string(),
  all: z.boolean().optional(),
  amend: z.boolean().optional(),
  signoff: z.boolean().optional(),
  noVerify: z.boolean().optional(),
})
// The two remote verbs that vary. Strictly booleans for the reason the commit flags are: `'yes'`
// coerced would turn a fast-forward pull into a rebase, or an ordinary push into one that replaces a
// commit on the remote.
const pullBody = z.object({ rebase: z.boolean().optional() })
const pushBody = z.object({ force: z.boolean().optional() })
// Which backend the wand spends. `backendId` is required because a route that guessed would spend a
// key nobody chose; `modelId` is optional because a backend that declares no model leaves the choice
// to itself (@acorn/protocol/modelProviders.ts § defaultModelIdFor).
const commitMessageBody = z.object({ backendId: z.string().min(1), modelId: z.string().min(1).optional() })
// The document reads. Paths are validated again in ../localDocument.ts, where they reach git; here the
// shape and the bounds, so a request cannot ask for an unbounded document or batch.
const scope = z.enum(['staged', 'unstaged'])
const patchKey = z.string().regex(/^sha256:[0-9a-f]{64}$/)
// A path no file system accepts, or a status key longer than any git status gives, is not a request.
const path = z.string().min(1).max(4096)
const statusKey = z.string().max(1024)
const documentBody = z.object({
  scope,
  files: z.array(z.object({ path, key: statusKey })).max(MAX_DOCUMENT_FILES),
}) satisfies z.ZodType<LocalDocumentRequest>
const segmentsBody = z.object({
  scope,
  requests: z.array(z.object({ path, patchKey, ordinal: z.number().int().min(0) })).min(1).max(MAX_SEGMENTS_PER_REQUEST),
}) satisfies z.ZodType<LocalSegmentsRequest>
// The query is never logged or counted: it is a piece of somebody's source.
const searchBody = z.object({
  scope,
  query: z.string().min(1).max(SEARCH_MAX_QUERY),
  caseSensitive: z.boolean(),
  cursor: z.string().max(64).nullable(),
  files: z.array(z.object({ path, patchKey })).max(MAX_DOCUMENT_FILES),
}) satisfies z.ZodType<LocalSearchRequest>

const id = (c: { req: { param(k: string): string } }) => c.req.param('id')

// Generating spends the owner's provider key, so a task-scoped agent credential must not reach it: an
// automation caller has no editor to put the text in and no business paying for one.
//
// The host's own rule, restated rather than imported. `canUseProviderCredential` is not on the plugin
// surface, and the database plugin's generate route reads the same two fields for the same reason
// (docs/security/credentials.md § Credential handling).
const mayGenerate = (principal: Principal | null): boolean =>
  !!principal && (principal.kind === 'device' || principal.scope === 'service')

/** The two model routes' shared shape: the owner gate, the bridge, and the error mapping.
 *
 *  `viaBridge` cannot serve these. It turns anything but a `BridgeError` into a 500, and a
 *  `ProviderOperationError` carries the status the reader needs to act on — 401 to reconnect the key,
 *  429 to try again shortly — which is the mapping the database plugin's generate route makes too. */
async function viaModels<T>(c: Context<AppEnv>, fn: (bridge: LocalGitBridge, userId: string) => Promise<T>): Promise<Response> {
  if (!mayGenerate(c.get('principal'))) return respondError(c, 403, 'interactive_user_required')
  const bridge = routeCapabilityFor(c, LOCAL_GIT)
  if (!bridge) return respondError(c, 503, 'bridge-unavailable')
  try {
    return c.json(await fn(bridge, ownerId(c)))
  } catch (error) {
    if (error instanceof BridgeError) return respondError(c, error.status, error.code, error.message ? [error.message] : undefined)
    if (isProviderOperationError(error)) return respondError(c, error.status, error.code)
    // Anything else is flattened, as core does for its own provider calls: an upstream exception
    // message can quote a URL or a response body (docs/integrations/provider-boundaries.md § Provider boundaries).
    return respondError(c, 502, 'provider_unavailable')
  }
}

export const localGit = new Hono<AppEnv>()
  .get('/:id/local/status', (c) => viaBridge(c, LOCAL_GIT, (b) => b.status(id(c))))
  // Reads with a body, so POST: a stack of thousands of paths does not fit in a URL.
  .post('/:id/local/document', async (c) => {
    const p = documentBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, LOCAL_GIT, (b) => b.document(id(c), p.data))
  })
  .post('/:id/local/document/segments', async (c) => {
    const p = segmentsBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, LOCAL_GIT, (b) => b.segments(id(c), p.data))
  })
  .post('/:id/local/document/search', async (c) => {
    const p = searchBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, LOCAL_GIT, (b) => b.search(id(c), p.data))
  })
  .get('/:id/local/new-side', (c) => {
    const path = c.req.query('path')
    if (!path) return respondError(c, 400, 'bad_request')
    return viaBridge(c, LOCAL_GIT, (b) => b.newSide(id(c), path, c.req.query('scope') === 'staged' ? 'staged' : 'unstaged'))
  })
  .post('/:id/local/stage', async (c) => {
    const p = pathsBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, LOCAL_GIT, (b) => b.stage(id(c), p.data.paths))
  })
  .post('/:id/local/unstage', async (c) => {
    const p = pathsBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, LOCAL_GIT, (b) => b.unstage(id(c), p.data.paths))
  })
  .post('/:id/local/discard', async (c) => {
    const p = discardBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, LOCAL_GIT, (b) => b.discard(id(c), p.data.path, p.data.untracked, p.data.oldPath))
  })
  .get('/:id/local/head-commit', (c) => viaBridge(c, LOCAL_GIT, (b) => b.headCommit(id(c))))
  .post('/:id/local/commit', async (c) => {
    const p = commitBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    const { message, ...options } = p.data
    return viaBridge(c, LOCAL_GIT, (b) => b.commit(id(c), message, options))
  })
  .post('/:id/local/stage-all', (c) => viaBridge(c, LOCAL_GIT, (b) => b.stageAll(id(c))))
  .post('/:id/local/unstage-all', (c) => viaBridge(c, LOCAL_GIT, (b) => b.unstageAll(id(c))))
  .post('/:id/local/discard-all', (c) => viaBridge(c, LOCAL_GIT, (b) => b.discardAll(id(c))))
  // Fetch and abort carry no body, so nothing here can be malformed; the two that do are validated
  // like the commit body next door.
  .post('/:id/local/fetch', (c) => viaBridge(c, LOCAL_GIT, (b) => b.fetch(id(c))))
  .post('/:id/local/pull', async (c) => {
    const p = pullBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, LOCAL_GIT, (b) => b.pull(id(c), p.data))
  })
  .post('/:id/local/push', async (c) => {
    const p = pushBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaBridge(c, LOCAL_GIT, (b) => b.push(id(c), p.data))
  })
  .post('/:id/local/abort', (c) => viaBridge(c, LOCAL_GIT, (b) => b.abort(id(c))))
  // Which backends the wand may offer. A bare array, like this plugin's review-note reads, rather
  // than the database plugin's `{ backends }`: there is one thing to answer.
  .get('/:id/local/model-connections', (c) => viaModels(c, (bridge, userId) => bridge.modelBackends(userId)))
  // Write the message from the diff the next commit would take. The answer lands in the editor's
  // draft like typed text and commits through `before-commit` like any other message, so a
  // commit-lint handler sees no difference and should not (../localGit.ts § CHANGES_HOOKS).
  .post('/:id/local/commit-message', async (c) => {
    const p = commitMessageBody.safeParse(await c.req.json().catch(() => null))
    if (!p.success) return respondError(c, 400, 'bad_request')
    return viaModels(c, (bridge, userId) => bridge.commitMessage(id(c), { ...p.data, userId }))
  })
