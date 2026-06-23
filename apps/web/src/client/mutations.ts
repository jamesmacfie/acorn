// PR write actions. Same-origin POST (cookie auth; the Worker's csrf() checks Origin). Throws the
// structured error code on failure so callers can branch (e.g. merge_failed, reauth).
const post = async <T>(url: string, body?: unknown): Promise<T> => {
  const res = await fetch(url, {
    method: 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(err.error ?? `${res.status}`)
  }
  return res.json()
}

const base = (o: string, r: string, n: string | number) => `/api/repos/${o}/${r}/pulls/${n}`

export const mergePr = (o: string, r: string, n: string, method: string) => post(`${base(o, r, n)}/merge`, { method })
export const closePr = (o: string, r: string, n: string) => post(`${base(o, r, n)}/close`)
export const reopenPr = (o: string, r: string, n: string) => post(`${base(o, r, n)}/reopen`)
export const setDraft = (o: string, r: string, n: string, draft: boolean) => post(`${base(o, r, n)}/draft`, { draft })
export const addComment = (o: string, r: string, n: string, body: string) =>
  post<{ id: string }>(`${base(o, r, n)}/comments`, { body })

export const addLabel = (o: string, r: string, n: string, name: string) => post(`${base(o, r, n)}/labels`, { name })
export const removeLabel = async (o: string, r: string, n: string, name: string) => {
  const res = await fetch(`${base(o, r, n)}/labels`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `${res.status}`)
  return res.json()
}

// Inline review threads.
export const addReviewComment = (o: string, r: string, n: string, body: string, path: string, line: number, side: string) =>
  post(`${base(o, r, n)}/review-comments`, { body, path, line, side })
export const replyReview = (o: string, r: string, n: string, commentDatabaseId: number, body: string) =>
  post(`${base(o, r, n)}/review-comments/${commentDatabaseId}/replies`, { body })
export const resolveThread = (o: string, r: string, n: string, threadId: string, resolved: boolean) =>
  post(`${base(o, r, n)}/threads/${encodeURIComponent(threadId)}/resolve`, { resolved })

export const setViewed = (o: string, r: string, n: string, path: string, viewed: boolean) =>
  post(`${base(o, r, n)}/viewed`, { path, viewed })

// Rerun a check's failed Actions jobs. Repo-scoped (keyed by the workflow run id, not the PR).
export const rerunFailed = (o: string, r: string, runId: number) => post(`/api/repos/${o}/${r}/actions/${runId}/rerun`)

export const setPin = async (repoId: number, pinned: boolean) => {
  const res = await fetch('/api/pins', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoId, pinned }),
  })
  if (!res.ok) throw new Error(`pins ${res.status}`)
  return res.json() as Promise<{ repoId: number; pinned: boolean }>
}

export const setPref = async (key: string, value: string) => {
  const res = await fetch('/api/prefs', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  })
  if (!res.ok) throw new Error(`prefs ${res.status}`)
  return res.json() as Promise<{ key: string; value: string }>
}
