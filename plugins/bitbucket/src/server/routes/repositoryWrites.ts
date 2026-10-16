import type { Context } from 'hono'
import { Hono } from 'hono'
import { z } from 'zod'
import { type AppEnv, type PluginDatabase, respondError, type RouteResult } from '@acorn/plugin-api/node'
import {
  bb,
  bbError,
  bbJson,
  bbPages,
  bitbucketMessage,
  repositoryPath,
  send,
  type BitbucketSession,
} from '../bitbucketApi'
import { type BitbucketEmit, NO_EMIT } from '../events'
import { refreshPullRequest, type MirrorKey } from '../mirror/detail'
import { createPullRequest } from '../createPullRequest'
import { login, type BitbucketPullRequest, type BitbucketUser } from '../types'
import { fail, pullRequestKey, repositoryRequest } from './context'
import type { BitbucketAccount } from '../account'

// Everything under /v1/p/bitbucket/repositories that writes. Each verb is one or two Bitbucket calls,
// then a read of the pull request's detail into the mirror, so the reader's next fetch already shows
// what changed.

const text = z.object({ body: z.string().trim().min(1).max(65_536) })
// A comment-only review needs words.
const review = z
  .object({ event: z.enum(['comment', 'approve', 'request-changes']), body: z.string().max(65_536) })
  .refine((input) => input.event !== 'comment' || input.body.trim().length > 0)
const person = z.object({ login: z.string().trim().min(1).max(255) })
const merge = z.object({ method: z.enum(['merge', 'squash', 'fast-forward']).default('merge') })
const resolved = z.object({ resolved: z.boolean() })
const lineComment = text.extend({
  path: z.string().min(1).max(4096),
  oldLine: z.number().int().positive().nullable(),
  newLine: z.number().int().positive().nullable(),
})
const create = z.object({
  title: z.string().trim().min(1).max(255),
  body: z.string().max(65_536).default(''),
  base: z.string().min(1).max(255).optional(),
  head: z.string().min(1).max(255),
  draft: z.boolean().default(false),
})

const MERGE_STRATEGIES: Record<string, string> = {
  merge: 'merge_commit',
  squash: 'squash',
  'fast-forward': 'fast_forward',
}

type Write = (args: {
  session: BitbucketSession
  key: MirrorKey
  base: string
  input: Record<string, unknown>
}) => Promise<RouteResult<unknown>>

const comment = (base: string, session: BitbucketSession, body: Record<string, unknown>) =>
  bbJson(session, `${base}/comments`, send('POST', body))

/** The reviewer list written back whole, as Bitbucket's update takes it, with the title it requires. */
async function setReviewers(
  session: BitbucketSession,
  base: string,
  change: (reviewers: BitbucketUser[]) => BitbucketUser[] | null,
): Promise<RouteResult<unknown>> {
  const pull = await bbJson<BitbucketPullRequest & { reviewers?: BitbucketUser[] }>(session, base)
  if (!pull.ok) return pull
  const reviewers = change(pull.value.reviewers ?? [])
  if (!reviewers) return { ok: false, failure: { error: 'not_found', status: 404 } }
  return bbJson(
    session,
    base,
    send('PUT', { title: pull.value.title, reviewers: reviewers.map((reviewer) => ({ uuid: reviewer.uuid })) }),
  )
}

export const repositoryWrites = (db: PluginDatabase, account: BitbucketAccount, emit: BitbucketEmit = NO_EMIT) => {
  async function run(c: Context<AppEnv>, schema: z.ZodType<Record<string, unknown>> | null, write: Write) {
    const parsed = schema
      ? schema.safeParse(await c.req.json().catch(() => null))
      : { success: true as const, data: {} }
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    const request = await repositoryRequest(c, db, account)
    if (!request.ok) return request.response
    const key = pullRequestKey(c, request.value)
    if (!key) return respondError(c, 400, 'bad_number')
    const base = `${repositoryPath(key.repository)}/pullrequests/${key.number}`
    const result = await write({ session: request.value.session, key, base, input: parsed.data })
    if (!result.ok) return fail(c, result.failure)
    await refreshPullRequest(request.value.session, db, key, emit)
    return c.json({ ok: true })
  }

  return (
    new Hono<AppEnv>()
      .post('/:workspace/:repo/pull-requests', async (c) => {
        const parsed = create.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) return respondError(c, 400, 'bad_request')
        const request = await repositoryRequest(c, db, account)
        if (!request.ok) return request.response
        const created = await createPullRequest(request.value.session, request.value.repository, parsed.data)
        return created.ok ? c.json(created.value) : fail(c, created.failure)
      })
      .post('/:workspace/:repo/pull-requests/:number/comments', (c) =>
        run(c, text, ({ session, base, input }) => comment(base, session, { content: { raw: input.body } })),
      )
      // A review is a comment, a verdict, or both. Bitbucket keeps each person's verdict, so a later one
      // replaces an earlier one.
      .post('/:workspace/:repo/pull-requests/:number/review', (c) =>
        run(c, review, async ({ session, base, input }) => {
          const body = String(input.body).trim()
          if (body) {
            const written = await comment(base, session, { content: { raw: body } })
            if (!written.ok || input.event === 'comment') return written
          }
          return bbJson(session, `${base}/${input.event === 'approve' ? 'approve' : 'request-changes'}`, send('POST'))
        }),
      )
      .post('/:workspace/:repo/pull-requests/:number/merge', (c) =>
        run(c, merge, async ({ session, base, input }) => {
          const response = await bb(
            session,
            `${base}/merge`,
            send('POST', { merge_strategy: MERGE_STRATEGIES[String(input.method)], close_source_branch: false }),
          )
          const failure = bbError(response)
          if (!failure) return { ok: true, value: null }
          if (failure.status !== 502) return { ok: false, failure }
          // Bitbucket says why it won't merge, such as unresolved conflicts or a merge check.
          const message = await bitbucketMessage(response)
          return {
            ok: false,
            failure: { error: 'merge_failed', status: 403, ...(message ? { detail: [message] } : {}) },
          }
        }),
      )
      .post('/:workspace/:repo/pull-requests/:number/close', (c) =>
        run(c, null, ({ session, base }) => bbJson(session, `${base}/decline`, send('POST'))),
      )
      // A reviewer is addressed by uuid. Someone already on the pull request is found there; anyone else
      // in the workspace's people.
      .post('/:workspace/:repo/pull-requests/:number/reviewers', (c) =>
        run(c, person, async ({ session, key, base, input }) => {
          const workspace = key.repository.split('/')[0]!
          const members = await bbPages<{ user: BitbucketUser }>(
            session,
            `/workspaces/${workspace}/members?pagelen=100`,
            5,
          )
          if (!members.ok) return members
          const wanted = members.value.values.map(({ user }) => user).find((user) => login(user) === input.login)
          return setReviewers(session, base, (reviewers) =>
            wanted ? [...reviewers.filter((reviewer) => reviewer.uuid !== wanted.uuid), wanted] : null,
          )
        }),
      )
      .delete('/:workspace/:repo/pull-requests/:number/reviewers', (c) =>
        run(c, person, ({ session, base, input }) =>
          setReviewers(session, base, (reviewers) => reviewers.filter((reviewer) => login(reviewer) !== input.login)),
        ),
      )
      // A new thread on a line. Bitbucket places it by the line in the new file, `to`, or for a deleted
      // line by the line in the old one, `from`.
      .post('/:workspace/:repo/pull-requests/:number/line-comments', (c) =>
        run(c, lineComment, ({ session, base, input }) =>
          comment(base, session, {
            content: { raw: input.body },
            inline:
              input.newLine != null
                ? { path: input.path, to: input.newLine }
                : { path: input.path, from: input.oldLine },
          }),
        ),
      )
      .post('/:workspace/:repo/pull-requests/:number/comments/:commentId/replies', async (c) => {
        const parent = Number(c.req.param('commentId'))
        if (!Number.isSafeInteger(parent) || parent <= 0) return respondError(c, 400, 'bad_request')
        return run(c, text, ({ session, base, input }) =>
          comment(base, session, { content: { raw: input.body }, parent: { id: parent } }),
        )
      })
      // A thread's resolution sits on its first comment, which is the thread's id.
      .post('/:workspace/:repo/pull-requests/:number/threads/:threadId/resolve', async (c) => {
        const thread = Number(c.req.param('threadId'))
        if (!Number.isSafeInteger(thread) || thread <= 0) return respondError(c, 400, 'bad_request')
        return run(c, resolved, ({ session, base, input }) =>
          bbJson(session, `${base}/comments/${thread}/resolve`, send(input.resolved === true ? 'POST' : 'DELETE')),
        )
      })
  )
}
