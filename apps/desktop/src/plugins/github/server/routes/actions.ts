import { Hono } from 'hono'
import { gh, ghError } from '..'
import type { AppEnv } from '../../../../core/server/middleware/auth'
import { getUser } from '../../../../core/server/middleware/requireUser'
import { respondError } from '../../../../core/server/respond'
import type { RunJobs } from '../../../../core/shared/api'

// Read-only Actions endpoints for the checks side panel. Writes (rerun) live in prActions.ts.
// Deliberately uncached on the server — no mirror table, no BLOBS entry: the client query cache
// (IndexedDB-persisted) already covers reuse on this machine, and job/log payloads go stale fast.

type GhJob = {
  id: number
  name: string
  status: string | null
  conclusion: string | null
  steps?: { number: number; name: string; status: string | null; conclusion: string | null }[]
}

export const actions = new Hono<AppEnv>()
  // A workflow run's jobs + their steps. One cheap call; the panel filters to the clicked job.
  .get('/:owner/:repo/actions/runs/:runId/jobs', async (c) => {
    const user = getUser(c)
    const owner = c.req.param('owner')
    const repo = c.req.param('repo')
    const runId = c.req.param('runId')
    const res = await gh(user.token, `/repos/${owner}/${repo}/actions/runs/${runId}/jobs?per_page=100`)
    const err = ghError(res)
    if (err) return respondError(c, err.status, err.error)
    const json = (await res.json()) as { jobs?: GhJob[] }
    const body: RunJobs = {
      jobs: (json.jobs ?? []).map((j) => ({
        id: j.id,
        name: j.name,
        status: j.status,
        conclusion: j.conclusion,
        steps: (j.steps ?? []).map((s) => ({ number: s.number, name: s.name, status: s.status, conclusion: s.conclusion })),
      })),
    }
    return c.json(body)
  })
  // Full plaintext log for one job. GitHub 302-redirects to signed blob storage; follow it
  // manually and re-fetch WITHOUT the auth header (the target rejects/leaks the token otherwise).
  .get('/:owner/:repo/actions/jobs/:jobId/logs', async (c) => {
    const user = getUser(c)
    const owner = c.req.param('owner')
    const repo = c.req.param('repo')
    const jobId = c.req.param('jobId')
    const res = await gh(user.token, `/repos/${owner}/${repo}/actions/jobs/${jobId}/logs`, { redirect: 'manual' })
    const location = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && location) {
      const blob = await fetch(location)
      if (!blob.ok) return respondError(c, 502, 'github_unavailable')
      return c.json({ text: await blob.text() })
    }
    const err = ghError(res)
    if (err) return respondError(c, err.status, err.error)
    // No redirect (e.g. logs not yet available): return whatever body we got as text.
    return c.json({ text: await res.text() })
  })
