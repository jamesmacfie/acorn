import type { HttpRequest } from '../shared/model'

// Requests carry a slash path ('auth/login'), not a folder id: grouping is a client-side split.
// A folder therefore exists exactly as long as something is filed in it.
export type Group = { folder: string; requests: HttpRequest[] }

export function groupByFolder(requests: HttpRequest[]): Group[] {
  const byFolder = new Map<string, HttpRequest[]>()
  for (const r of requests) {
    const list = byFolder.get(r.folder) ?? []
    list.push(r)
    byFolder.set(r.folder, list)
  }
  return [...byFolder.entries()]
    .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
    .map(([folder, list]) => ({ folder, requests: list.sort((a, b) => a.name.localeCompare(b.name)) }))
}
