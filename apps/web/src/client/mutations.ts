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
